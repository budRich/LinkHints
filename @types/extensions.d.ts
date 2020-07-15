declare global {
  interface Window {
    wrappedJSObject?: Window;
    Boolean: typeof Boolean;
    Element: typeof Element;
    Event: typeof Event;
    EventTarget: typeof EventTarget;
    Function: typeof Function;
    HTMLElement: typeof HTMLElement;
    Object: typeof Object;
    String: typeof String;
  }

  interface HTMLElement {
    scrollLeftMax: number;
    scrollTopMax: number;
  }
}

export {};
