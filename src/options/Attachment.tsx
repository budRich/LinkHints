import * as React from "preact";

import { classlist } from "../shared/main";

export default function Attachment({
  label,
  content,
  children,
  ...restProps
}: {
  label?: React.VNode;
  content?: React.VNode;
  children: React.VNode;
}) {
  const Tag = label != null ? "label" : "span";
  return (
    <Tag {...restProps} className="Attachment">
      <span
        className={classlist("Attachment-content", {
          TinyLabel: label != null,
        })}
      >
        {label != null ? label : content}
      </span>
      {children}
    </Tag>
  );
}
