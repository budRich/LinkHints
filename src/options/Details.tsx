import * as React from "preact";

import { classlist } from "../shared/main";

export default function Details({
  summary,
  open,
  onChange,
  children,
}: {
  summary: React.VNode;
  open: boolean;
  onChange: (boolean) => void;
  children: React.VNode;
}) {
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
