// @flow strict-local

import {
  type ElementReport,
  type ElementType,
  type ElementTypes,
  type VisibleElement,
} from "../shared/hints";
import {
  type KeyboardMapping,
  type KeyboardModeWorker,
  type KeyTranslations,
  isModifierKey,
  keyboardEventToKeypress,
  normalizeKeypress,
} from "../shared/keyboard";
import {
  type Box,
  addEventListener,
  addListener,
  bind,
  CONTAINER_ID,
  getTextRects,
  getViewport,
  log,
  Resets,
  unreachable,
} from "../shared/main";
import type {
  FromBackground,
  FromWorker,
  ToBackground,
} from "../shared/messages";
import { TimeTracker } from "../shared/perf";
import { type FrameMessage, decodeFrameMessage } from "./decoders";
import ElementManager from "./ElementManager";

type CurrentElements = {|
  elements: Array<VisibleElement>,
  frames: Array<HTMLIFrameElement | HTMLFrameElement>,
  viewports: Array<Box>,
  types: ElementTypes,
  indexes: Array<number>,
  words: Array<string>,
|};

export default class WorkerProgram {
  keyboardShortcuts: Array<KeyboardMapping> = [];
  keyboardMode: KeyboardModeWorker = "Normal";
  keyTranslations: KeyTranslations = {};
  current: ?CurrentElements = undefined;
  oneTimeWindowMessageToken: ?string = undefined;
  mac: boolean = false;
  suppressNextKeyup: ?{| key: string, code: string |} = undefined;
  resets: Resets = new Resets();
  elementManager: ElementManager = new ElementManager();
  mutationObserver: MutationObserver = new MutationObserver(
    this.onMutation.bind(this)
  );

  constructor() {
    bind(this, [
      [this.onBlur, { catch: true }],
      [this.onKeydown, { catch: true }],
      [this.onKeyup, { catch: true }],
      [this.onMessage, { catch: true }],
      [this.onWindowMessage, { catch: true }],
      [this.onPagehide, { catch: true }],
      [this.reportVisibleElements, { catch: true }],
      [this.sendMessage, { catch: true }],
      [this.start, { catch: true }],
      [this.stop, { log: true, catch: true }],
    ]);
  }

  async start() {
    this.resets.add(
      addListener(browser.runtime.onMessage, this.onMessage),
      addEventListener(window, "blur", this.onBlur),
      addEventListener(window, "keydown", this.onKeydown, { passive: false }),
      addEventListener(window, "keyup", this.onKeyup, { passive: false }),
      addEventListener(window, "message", this.onWindowMessage),
      addEventListener(window, "pagehide", this.onPagehide)
    );
    await this.elementManager.start();

    this.markTutorial();

    // See `RendererProgram#start`.
    try {
      await browser.runtime.sendMessage(
        wrapMessage({ type: "WorkerScriptAdded" })
      );
    } catch {
      return;
    }
    browser.runtime.connect().onDisconnect.addListener(() => {
      this.stop();
    });
  }

  stop() {
    this.resets.reset();
    this.elementManager.stop();
    this.mutationObserver.disconnect();
    this.oneTimeWindowMessageToken = undefined;
    this.suppressNextKeyup = undefined;
  }

  async sendMessage(message: FromWorker) {
    log("log", "WorkerProgram#sendMessage", message.type, message);
    await browser.runtime.sendMessage(wrapMessage(message));
  }

  onMessage(wrappedMessage: FromBackground) {
    // See `RendererProgram#onMessage`.
    if (wrappedMessage.type === "FirefoxWorkaround") {
      this.sendMessage({ type: "WorkerScriptAdded" });
      return;
    }

    if (wrappedMessage.type !== "ToWorker") {
      return;
    }

    const { message } = wrappedMessage;

    log("log", "WorkerProgram#onMessage", message.type, message);

    switch (message.type) {
      case "StateSync":
        log.level = message.logLevel;
        this.keyboardShortcuts = message.keyboardShortcuts;
        this.keyboardMode = message.keyboardMode;
        this.keyTranslations = message.keyTranslations;
        this.oneTimeWindowMessageToken = message.oneTimeWindowMessageToken;
        this.mac = message.mac;

        if (message.clearElements) {
          this.current = undefined;
          this.mutationObserver.disconnect();
        }
        break;

      case "StartFindElements": {
        const { oneTimeWindowMessageToken } = this;
        if (oneTimeWindowMessageToken == null) {
          log("error", "missing oneTimeWindowMessageToken", message);
          break;
        }
        const viewport = getViewport();
        this.reportVisibleElements(
          message.types,
          [viewport],
          oneTimeWindowMessageToken
        );
        break;
      }

      case "UpdateElements": {
        const { current, oneTimeWindowMessageToken } = this;
        if (current == null) {
          return;
        }

        current.viewports = [getViewport()];

        this.updateVisibleElements({
          current,
          oneTimeWindowMessageToken,
        });
        break;
      }

      case "GetTextRects": {
        const { current } = this;
        if (current == null) {
          return;
        }

        const { indexes, words } = message;
        current.indexes = indexes;
        current.words = words;

        const elements = current.elements.filter((_elementData, index) =>
          indexes.includes(index)
        );
        const wordsSet = new Set(words);
        const rects = elements.flatMap(elementData =>
          getTextRects({
            element: elementData.element,
            viewports: current.viewports,
            words: wordsSet,
          })
        );

        this.sendMessage({
          type: "ReportTextRects",
          rects,
        });

        break;
      }

      case "FocusElement": {
        const elementData = this.getElement(message.index);
        if (elementData == null) {
          log("error", "FocusElement: Missing element", message, this.current);
          return;
        }

        const { element } = elementData;
        const { activeElement } = document;
        const textInputIsFocused =
          activeElement != null && isTextInput(activeElement);

        // Allow opening links in new tabs without losing focus from a text
        // input.
        if (!textInputIsFocused) {
          element.focus();
        }

        break;
      }

      case "ClickElement": {
        const elementData = this.getElement(message.index);

        if (elementData == null) {
          log("error", "ClickElement: Missing element", message, this.current);
          return;
        }

        log("log", "WorkerProgram: ClickElement", elementData);

        const { element } = elementData;

        const defaultNotPrevented = clickElement(element);

        if (defaultNotPrevented && elementData.type === "link") {
          this.sendMessage({ type: "ClickedLinkNavigatingToOtherPage" });
        }

        break;
      }

      case "SelectElement": {
        const elementData = this.getElement(message.index);
        if (elementData == null) {
          log("error", "SelectElement: Missing element", message, this.current);
          return;
        }

        log("log", "WorkerProgram: SelectElement", elementData);

        const { element } = elementData;

        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          // Focus and, if possible, select the text inside. There are two cases
          // here: "Text input" (`<textarea>`, `<input type="text">`, `<input
          // type="search">`, `<input type="unknown">`, etc) style elements
          // technically only need `.select()`, but it doesn't hurt calling
          // `.focus()` first. For all other types (`<input type="checkbox">`,
          // `<input type="color">`, etc) `.select()` seems to be a no-op, so
          // `.focus()` is strictly needed but calling `.select()` also doesn't
          // hurt.
          element.focus();
          element.select();
        } else if (
          // Text inside `<button>` elements can be selected and copied just
          // fine in Chrome, but not in Firefox. In Firefox,
          // `document.elementFromPoint(x, y)` returns the `<button>` for
          // elements nested inside, causing them not to get hints either.
          (BROWSER === "firefox" && element instanceof HTMLButtonElement) ||
          // `<select>` elements _can_ be selected, but you seem to get the
          // empty string when trying to copy them.
          element instanceof HTMLSelectElement ||
          // Frame elements can be selected in Chrome, but that just looks
          // weird. The reason to focus a frame element is to allow the arrow
          // keys to scroll them.
          element instanceof HTMLIFrameElement ||
          element instanceof HTMLFrameElement
        ) {
          element.focus();
        } else {
          // Focus the element, even if it isn't usually focusable.
          focusElement(element);

          // Try to select the text of the element, or the element itself.
          const selection: Selection | null = window.getSelection();
          if (selection != null) {
            const range = document.createRange();
            if (element.childNodes.length === 0) {
              range.selectNode(element);
            } else {
              range.selectNodeContents(element);
            }
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }

        break;
      }

      // Used instead of `browser.tabs.create` in Chrome, to have the opened tab
      // end up in the same position as if you'd clicked a link with the mouse.
      // This technique does not seem to work in Firefox, but it's not needed
      // there anyway (see background/Program.js).
      case "OpenNewTab": {
        const { url, foreground } = message;
        const link = document.createElement("a");
        link.href = url;
        link.dispatchEvent(
          new MouseEvent("click", {
            ctrlKey: true,
            metaKey: true,
            shiftKey: foreground,
          })
        );
        break;
      }

      case "Escape": {
        if (document.activeElement != null) {
          document.activeElement.blur();
        }
        const selection: Selection | null = window.getSelection();
        if (selection != null) {
          selection.removeAllRanges();
        }
        break;
      }

      case "ReverseSelection": {
        const selection: Selection | null = window.getSelection();
        if (selection != null) {
          reverseSelection(selection);
        }
        break;
      }

      case "ClickFocusedElement": {
        const { activeElement } = document;
        if (activeElement != null) {
          clickElement(activeElement);
        }
        break;
      }

      default:
        unreachable(message.type, message);
    }
  }

  onWindowMessage(event: MessageEvent) {
    const { oneTimeWindowMessageToken } = this;

    if (
      oneTimeWindowMessageToken != null &&
      event.data != null &&
      typeof event.data === "object" &&
      !Array.isArray(event.data) &&
      event.data.token === oneTimeWindowMessageToken &&
      typeof event.data.type === "string"
    ) {
      let message = undefined;
      try {
        message = decodeFrameMessage(event.data);
      } catch (error) {
        log(
          "warn",
          "Ignoring bad window message",
          oneTimeWindowMessageToken,
          event,
          error
        );
        return;
      }

      this.oneTimeWindowMessageToken = undefined;
      log("log", "WorkerProgram#onWindowMessage", message);

      switch (message.type) {
        case "FindElements":
          this.sendMessage({ type: "ReportVisibleFrame" });
          this.reportVisibleElements(
            message.types,
            message.viewports,
            oneTimeWindowMessageToken
          );
          break;

        case "UpdateElements": {
          const { current } = this;
          if (current == null) {
            return;
          }

          current.viewports = message.viewports;
          this.updateVisibleElements({
            current,
            oneTimeWindowMessageToken,
          });
          break;
        }

        default:
          unreachable(message.type, message);
      }
    }
  }

  // This is run in the capture phase of the keydown event, overriding any site
  // shortcuts. The initial idea was to run in the bubble phase (mostly) and let
  // sites use `event.preventDefault()` to override the extension shortcuts
  // (just like any other browser shortcut). However, duckduckgo.com has "j/k"
  // shortcuts for navigation, but don't check for the alt key and don't call
  // `event.preventDefault()`, making it impossible to use alt-j as an extension
  // shortcut without causing side-effects. This feels like a common thing, so
  // (at least for now) the extension shortcuts always do their thing (making it
  // impossible to trigger a site shortcut using the same keys).
  onKeydown(event: KeyboardEvent) {
    const prefix = "WorkerProgram#onKeydown";

    if (!event.isTrusted) {
      log("log", prefix, "ignoring untrusted event", event);
      return;
    }

    const keypress = normalizeKeypress({
      keypress: keyboardEventToKeypress(event),
      keyTranslations: this.keyTranslations,
    });

    const match = this.keyboardShortcuts.find(mapping => {
      const { shortcut } = mapping;
      return (
        keypress.key === shortcut.key &&
        keypress.alt === shortcut.alt &&
        keypress.cmd === shortcut.cmd &&
        keypress.ctrl === shortcut.ctrl &&
        (keypress.shift == null || keypress.shift === shortcut.shift)
      );
    });

    const suppress =
      // If we matched one of our keyboard shortcuts, always suppress.
      match != null ||
      // Just after activating a hint, suppress everything for a short while.
      this.keyboardMode === "PreventOverTyping" ||
      // When capturing keypresses in the Options UI, always suppress.
      this.keyboardMode === "Capture" ||
      // Allow ctrl and cmd system shortcuts in hints mode (but always suppress
      // pressing modifier keys _themselves_ in case the page does unwanted
      // things when holding down alt for example). ctrl and cmd can't safely be
      // combined with hint chars anyway, due to some keyboard shortcuts not
      // being suppressable (such as ctrl+n, ctrl+q, ctrl+t, ctrl+w) (and
      // ctrl+alt+t opens a terminal by default in Ubuntu).
      // This always uses `event.key` since we are looking for _actual_ modifier
      // keypresses (keys may be rebound).
      // Note: On mac, alt/option is used to type special characters, while most
      // (if not all) ctrl shortcuts are up for grabs by extensions, so on mac
      // ctrl is used to activate hints in a new tab instead of alt.
      // In Hints mode…
      (this.keyboardMode === "Hints" &&
        // …suppress lone modifier keypresses (as mentioned above)…
        (isModifierKey(event.key) ||
          // …or any other keypress really, with a few exceptions:
          (this.mac
            ? // On mac, allow cmd shortcuts (option is not used for shortcuts
              // but for typing special characters, and ctrl is used to
              // activate hints in new tabs):
              !event.metaKey
            : // On Windows and Linux, allow ctrl and win/super system shortcuts
              // (alt is used to activate hints in new tabs):
              !event.ctrlKey && !event.metaKey)));

    if (suppress) {
      suppressEvent(event);
      // `keypress` events are automatically suppressed when suppressing
      // `keydown`, but `keyup` needs to be manually suppressed. Note that if a
      // keyboard shortcut is alt+j it's possible to either release the alt key
      // first or the J key first, so we have to store _which_ key we want to
      // suppress the `keyup` event for.
      this.suppressNextKeyup = {
        key: event.key,
        code: event.code,
      };
      log("log", prefix, "suppressing event", {
        key: event.key,
        code: event.code,
        event,
        match,
        keyboardMode: this.keyboardMode,
        suppressNextKeyup: this.suppressNextKeyup,
      });
    }

    // The "keydown" event fires at an interval while it is pressed. We're only
    // interested in the event where the key was actually pressed down. Ignore
    // the rest. Don't log this since it results in a _lot_ of logs. This is
    // done _after_ suppression – we still want to consistenly suppress the key,
    // but don't want it to trigger more actions.
    if (event.repeat) {
      return;
    }

    if (this.keyboardMode === "Capture") {
      if (!isModifierKey(event.key)) {
        this.sendMessage({
          type: "KeypressCaptured",
          keypress,
        });
      }
    } else if (match != null) {
      this.sendMessage({
        type: "KeyboardShortcutMatched",
        action: match.action,
        timestamp: Date.now(),
      });
    } else if (this.keyboardMode === "Hints" && suppress) {
      this.sendMessage({
        type: "NonKeyboardShortcutKeypress",
        keypress,
        timestamp: Date.now(),
      });
    }
  }

  onKeyup(event: KeyboardEvent) {
    const prefix = "WorkerProgram#onKeyup";

    if (!event.isTrusted) {
      log("log", prefix, "ignoring untrusted event", event);
      return;
    }

    if (this.suppressNextKeyup != null) {
      const { key, code } = this.suppressNextKeyup;
      if (event.key === key && event.code === code) {
        log("log", prefix, "suppressing event", {
          event,
          keyboardMode: this.keyboardMode,
          suppressNextKeyup: this.suppressNextKeyup,
        });
        suppressEvent(event);
        this.suppressNextKeyup = undefined;
      }
    }
  }

  onBlur(event: FocusEvent) {
    if (!event.isTrusted) {
      log("log", "WorkerProgram#onBlur", "ignoring untrusted event", event);
      return;
    }

    if (event.target === window) {
      this.sendMessage({ type: "WindowBlur" });
    }
  }

  onMutation(records: Array<MutationRecord>) {
    const { current } = this;
    if (current == null) {
      return;
    }

    const newElements = getAllNewElements(records);
    updateElementsWithEqualOnes(current, newElements);

    // In addition to the "UpdateElements" polling, update as soon as possible
    // when elements are removed/added/changed for better UX. For example, if a
    // modal closes it looks nicer if the hints for elements in the modal
    // disappear immediately rather than after a small delay.
    // Just after entering Hints mode a mutation _always_ happens – inserting
    // the div with the hints. Don’t let that trigger an update.
    if (!(newElements.length === 1 && newElements[0].id === CONTAINER_ID)) {
      this.updateVisibleElements({
        current,
        // Skip updating child frames since we only know that things changed in
        // _this_ frame. Child frames will be updated during the next poll.
        oneTimeWindowMessageToken: undefined,
      });
    }
  }

  onPagehide(event: Event) {
    if (!event.isTrusted) {
      log("log", "WorkerProgram#onPagehide", "ignoring untrusted event", event);
      return;
    }

    if (window.top === window) {
      this.sendMessage({ type: "PageLeave" });
    }
  }

  getElement(index: number): ?VisibleElement {
    return this.current == null ? undefined : this.current.elements[index];
  }

  reportVisibleElements(
    types: ElementTypes,
    viewports: Array<Box>,
    oneTimeWindowMessageToken: string
  ) {
    const time = new TimeTracker();

    const elementsWithNulls: Array<?VisibleElement> = this.elementManager.getVisibleElements(
      types,
      viewports,
      time
    );
    const elements = elementsWithNulls.filter(Boolean);

    time.start("frames");
    const frames = this.elementManager.getVisibleFrames(viewports);
    for (const frame of frames) {
      const message: FrameMessage = {
        type: "FindElements",
        token: oneTimeWindowMessageToken,
        types,
        viewports: viewports.concat(getFrameViewport(frame)),
      };
      frame.contentWindow.postMessage(message, "*");
    }

    time.start("report");
    this.sendMessage({
      type: "ReportVisibleElements",
      elements: elements.map(visibleElementToElementReport),
      numFrames: frames.length,
      stats: this.elementManager.makeStats(time.export()),
    });

    this.current = {
      elements,
      frames,
      viewports,
      types,
      indexes: [],
      words: [],
    };

    const { documentElement } = document;
    if (documentElement != null) {
      this.mutationObserver.observe(documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }
  }

  updateVisibleElements({
    current,
    oneTimeWindowMessageToken,
  }: {|
    current: CurrentElements,
    oneTimeWindowMessageToken: ?string,
  |}) {
    const elements: Array<?VisibleElement> = this.elementManager.getVisibleElements(
      current.types,
      current.viewports,
      new TimeTracker(),
      current.elements.map(({ element }) => element)
    );

    const { words } = current;

    if (oneTimeWindowMessageToken != null) {
      for (const frame of current.frames) {
        // Removing an iframe from the DOM nukes its page (this will be detected
        // by the port disconnecting). Re-inserting it causes the page to be
        // loaded anew.
        if (frame.contentWindow != null) {
          const message: FrameMessage = {
            type: "UpdateElements",
            token: oneTimeWindowMessageToken,
            viewports: current.viewports.concat(getFrameViewport(frame)),
          };
          frame.contentWindow.postMessage(message, "*");
        }
      }
    }

    const wordsSet = new Set(words);
    const rects =
      words.length === 0
        ? []
        : elements
            .filter((_elementData, index) => current.indexes.includes(index))
            .filter(Boolean)
            .flatMap(({ element }) =>
              getTextRects({
                element,
                viewports: current.viewports,
                words: wordsSet,
              })
            );

    this.sendMessage({
      type: "ReportUpdatedElements",
      elements: elements
        // Doing `.filter(Boolean)` _after_ the `.map()` makes sure that the
        // indexes stay the same.
        .map((elementData, index) => {
          return elementData == null
            ? undefined
            : visibleElementToElementReport(elementData, index);
        })
        .filter(Boolean),
      rects,
    });
  }

  // Let the tutorial page know that Link Hints is installed, so it can toggle
  // some content.
  markTutorial() {
    if (
      window.location.origin + window.location.pathname === META_TUTORIAL ||
      (!PROD && document.querySelector(`.${META_SLUG}Tutorial`) != null)
    ) {
      const { documentElement } = document;
      if (documentElement != null) {
        documentElement.classList.add("is-installed");
      }
    }
  }
}

function wrapMessage(message: FromWorker): ToBackground {
  return {
    type: "FromWorker",
    message,
  };
}

function getFrameViewport(frame: HTMLIFrameElement | HTMLFrameElement): Box {
  const rect = frame.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(frame);
  const border = {
    left: parseFloat(computedStyle.getPropertyValue("border-left-width")),
    right: parseFloat(computedStyle.getPropertyValue("border-right-width")),
    top: parseFloat(computedStyle.getPropertyValue("border-top-width")),
    bottom: parseFloat(computedStyle.getPropertyValue("border-bottom-width")),
  };
  const padding = {
    left: parseFloat(computedStyle.getPropertyValue("padding-left")),
    right: parseFloat(computedStyle.getPropertyValue("padding-right")),
    top: parseFloat(computedStyle.getPropertyValue("padding-top")),
    bottom: parseFloat(computedStyle.getPropertyValue("padding-bottom")),
  };
  return {
    x: rect.left + border.left + padding.left,
    y: rect.top + border.top + padding.top,
    width:
      rect.width - border.left - border.right - padding.left - padding.right,
    height:
      rect.height - border.top - border.bottom - padding.top - padding.bottom,
  };
}

// Focus any element. Temporarily alter tabindex if needed, and properly
// restore it again when blurring.
function focusElement(element: HTMLElement) {
  if (element === document.activeElement) {
    return;
  }

  const focusable = isFocusable(element);
  const tabIndexAttr = element.getAttribute("tabindex");

  if (!focusable) {
    element.setAttribute("tabindex", "-1");
  }

  element.focus();

  const { documentElement } = document;

  if (!focusable && documentElement != null) {
    const onBlur = () => {
      if (tabIndexAttr == null) {
        element.removeAttribute("tabindex");
      } else {
        element.setAttribute("tabindex", tabIndexAttr);
      }
      stop();
    };

    const options = { capture: true, passive: true };
    element.addEventListener("blur", onBlur, options);

    const mutationObserver = new MutationObserver(records => {
      const removed = !documentElement.contains(element);
      const tabindexChanged = records.some(
        record => record.type === "attributes"
      );
      if (removed || tabindexChanged) {
        stop();
      }
    });

    const stop = () => {
      element.removeEventListener("blur", onBlur, options);
      mutationObserver.disconnect();
    };

    mutationObserver.observe(element, {
      attributes: true,
      attributeFilter: ["tabindex"],
    });
    mutationObserver.observe(documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-integers
const TABINDEX = /^\s*([+-]\d+)\s*$/;

// Returns whether `element.focus()` will do anything or not.
function isFocusable(element: HTMLElement): boolean {
  const propValue = element.tabIndex;

  // `<a>`, `<button>`, etc. are natively focusable (`.tabIndex === 0`).
  // `.tabIndex` can also be set if the HTML contains a valid `tabindex`
  // attribute.
  // `-1` means either that the element isn't focusable, or that
  // `tabindex="-1"` was set, so we have to use `.getAttribute` to
  // disambiguate.
  if (propValue !== -1) {
    return true;
  }

  // Contenteditable elements are always focusable.
  if (element.isContentEditable) {
    return true;
  }

  const attrValue = element.getAttribute("tabindex");

  if (attrValue == null) {
    return false;
  }

  // In Firefox, elements are focusable if they have the tabindex attribute,
  // regardless of whether it is valid or not.
  if (BROWSER === "firefox") {
    return true;
  }

  return TABINDEX.test(attrValue);
}

function isTextInput(element: HTMLElement): boolean {
  return (
    element.isContentEditable ||
    element instanceof HTMLTextAreaElement ||
    // `.selectionStart` is set to a number for all `<input>` types that you can
    // type regular text into (`<input type="text">`, `<input type="search">`,
    // `<input type="unknown">`, etc), but not for `<input type="email">` and
    // `<input type="number">` for some reason.
    (element instanceof HTMLInputElement &&
      (element.selectionStart != null ||
        element.type === "email" ||
        element.type === "number"))
  );
}

function reverseSelection(selection: Selection) {
  const direction = getSelectionDirection(selection);

  if (direction == null) {
    return;
  }

  const range = selection.getRangeAt(0);
  const [edgeNode, edgeOffset] = direction
    ? [range.startContainer, range.startOffset]
    : [range.endContainer, range.endOffset];

  range.collapse(!direction);
  selection.removeAllRanges();
  selection.addRange(range);
  selection.extend(edgeNode, edgeOffset);
}

// true → forward, false → backward, undefined → unknown
function getSelectionDirection(selection: Selection): ?boolean {
  if (selection.isCollapsed) {
    return undefined;
  }

  const { anchorNode, focusNode } = selection;

  if (anchorNode == null || focusNode == null) {
    return undefined;
  }

  const range = document.createRange();
  range.setStart(anchorNode, selection.anchorOffset);
  range.setEnd(focusNode, selection.focusOffset);
  return !range.collapsed;
}

function getTextWeight(text: string, weight: number): number {
  // The weight used for hints after filtering by text is the number of
  // non-whitespace characters, plus a tiny bit of the regular hint weight in
  // case of ties.
  return Math.max(1, text.replace(/\s/g, "").length + Math.log10(weight));
}

function suppressEvent(event: Event) {
  event.preventDefault();
  // `event.stopPropagation()` prevents the event from propagating further
  // up and down the DOM tree. `event.stopImmediatePropagation()` also
  // prevents additional listeners on the same node (`window` in this case)
  // from being called.
  event.stopImmediatePropagation();
}

function visibleElementToElementReport(
  { element, type, measurements, hasClickListener }: VisibleElement,
  index: number
): ElementReport {
  const text = extractText(element, type);
  return {
    type,
    index,
    url:
      type === "link" && element instanceof HTMLAnchorElement
        ? element.href
        : undefined,
    text,
    textWeight: getTextWeight(text, measurements.weight),
    isTextInput: isTextInput(element),
    hasClickListener,
    hintMeasurements: measurements,
  };
}

function extractText(element: HTMLElement, type: ElementType): string {
  // Scrollable elements do have `.textContent`, but it’s not intuitive to
  // filter them by text (especially since the matching text might be scrolled
  // away). Treat them more like frames (where you can’t look inside).
  // `<textarea>` elements have `.textContent` they have default text in the
  // HTML, but that is not updated as the user types. `<select>` also has
  // `.textContent`, but most `<option>`s are not visible. To be consistent with
  // `<input>`, ignore the text of `<textarea>` and `<select>` as well. Finally,
  // also ignore fallback content inside `<canvas>`.
  return type === "scrollable" ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLCanvasElement
    ? ""
    : element.textContent;
}

function clickElement(element: HTMLElement): boolean {
  if (element instanceof HTMLMediaElement) {
    element.focus();
    if (element.paused) {
      element.play();
    } else {
      element.pause();
    }
    return false;
  }

  // Programmatically clicking on an `<a href="..." target="_blank">` causes the
  // popup blocker to block the new tab/window from opening. That's really
  // annoying, so temporarily remove the `target`. The user can use the commands
  // for opening links in new tabs instead if they want a new tab.
  let target = undefined;
  if (
    element instanceof HTMLAnchorElement &&
    element.target.toLowerCase() === "_blank"
  ) {
    ({ target } = element);
    element.target = "";
  }

  const rect = element.getBoundingClientRect();
  const options = {
    // Mimic real events as closely as possible.
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: 1,
    view: window,
    // These seem to automatically set `x`, `y`, `pageX` and `pageY` as well.
    // There’s also `screenX` and `screenY`, but we can’t know those.
    clientX: Math.round(rect.left),
    clientY: Math.round(rect.top + rect.height / 2),
  };

  // When clicking a link for real the focus happens between the mousedown and
  // the mouseup, but moving this line between those two `.dispatchEvent` calls
  // below causes dropdowns in gmail not to be triggered anymore.
  element.focus();

  // Just calling `.click()` isn’t enough to open dropdowns in gmail. That
  // requires the full mousedown+mouseup+click event sequence.
  element.dispatchEvent(
    new MouseEvent("mousedown", { ...options, buttons: 1 })
  );
  element.dispatchEvent(new MouseEvent("mouseup", options));
  const defaultNotPrevented = element.dispatchEvent(
    new MouseEvent("click", options)
  );

  if (element instanceof HTMLAnchorElement && target != null) {
    element.target = target;
  }

  return defaultNotPrevented;
}

function getAllNewElements(records: Array<MutationRecord>): Array<HTMLElement> {
  const elements: Set<HTMLElement> = new Set();

  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement && !elements.has(node)) {
        elements.add(node);
        const children = node.getElementsByTagName("*");
        for (const child of children) {
          elements.add(child);
        }
      }
    }
  }

  return Array.from(elements);
}

function updateElementsWithEqualOnes(
  current: CurrentElements,
  newElements: Array<HTMLElement>
) {
  const { documentElement } = document;
  if (documentElement == null || newElements.length === 0) {
    return;
  }

  for (const item of current.elements) {
    // If an element with a hint has been removed, try to find a new element
    // that seems to be equal. If only one is found – go for it and use the new
    // one. Some sites, like Gmail and GitHub, replace elements with new,
    // identical ones shortly after things load. That caused hints to disappear
    // for seemingly no reason (one cannot tell with one’s eyes that the hint’s
    // element had _technically_ been removed). This is an attempt to give such
    // hints new elements.
    if (!documentElement.contains(item.element)) {
      const equalElements = newElements.filter(element =>
        item.element.isEqualNode(element)
      );
      if (equalElements.length === 1) {
        item.element = equalElements[0];
      }
    }
  }
}
