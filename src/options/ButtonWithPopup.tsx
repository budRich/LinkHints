import { ComponentChildren, h, VNode } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { addEventListener, classlist, Resets } from "../shared/main";

type OnOpenChange = (open: boolean) => void;

export default function ButtonWithPopup({
  open: openProp,
  buttonContent,
  popupContent,
  onOpenChange,
  className = "",
  ...restProps
}: h.JSX.HTMLAttributes<HTMLButtonElement> & {
  buttonContent: ComponentChildren;
  popupContent: (actions: { close: () => void }) => VNode;
  open?: boolean;
  onOpenChange?: OnOpenChange;
  className?: string;
}): VNode {
  const onOpenChangeRef = useRef<OnOpenChange | undefined>();
  onOpenChangeRef.current = onOpenChange;

  const [openState, setOpenState] = useState<boolean>(false);

  const open = openProp != null ? openProp : openState;

  const rootRef = useRef<HTMLDivElement>();

  const setOpen = useCallback(
    (newOpen: boolean) => {
      if (openProp == null) {
        setOpenState(newOpen);
      }
      if (onOpenChangeRef.current != null) {
        onOpenChangeRef.current(newOpen);
      }
    },
    [openProp]
  );

  useEffect(() => {
    if (open) {
      const closeIfOutside = (event: Event) => {
        const root = rootRef.current;
        const { target } = event;

        if (
          root != null &&
          target instanceof Node &&
          !root.contains(target) &&
          target !== document
        ) {
          setOpen(false);
        }
      };

      const resets = new Resets();
      resets.add(
        addEventListener(window, "focus", closeIfOutside),
        addEventListener(window, "click", closeIfOutside)
      );

      return () => {
        resets.reset();
      };
    }

    return undefined;
  }, [open, setOpen]);

  return (
    <div
      className={classlist("ButtonWithPopup", { "is-open": open })}
      ref={rootRef}
    >
      <button
        {...restProps}
        type="button"
        className={classlist("ButtonWithPopup-button", className)}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {buttonContent}
      </button>

      {open && (
        <div className="ButtonWithPopup-popup">
          {popupContent({
            close: () => {
              setOpen(false);
            },
          })}
        </div>
      )}
    </div>
  );
}
