import { ComponentChildren, h, VNode } from "preact";

import { classlist } from "../shared/main";

export default function Details({
  summary,
  open,
  onChange,
  children,
}: {
  summary: ComponentChildren;
  open: boolean;
  onChange: (open: boolean) => void;
  children: ComponentChildren;
}): VNode {
  return (
    <div>
      <button
        type="button"
        className={classlist("Details-button Toggle", { "is-open": open })}
        onClick={() => {
          onChange(!open);
        }}
      >
        {summary}
      </button>
      {open && children}
    </div>
  );
}
