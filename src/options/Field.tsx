import { ComponentChildren, h, VNode } from "preact";

import { classlist } from "../shared/main";

export default function Field({
  id,
  connected = false,
  fullWidth = false,
  label,
  span = false,
  description,
  changed,
  changedRight = false,
  render,
  onReset,
}: {
  id: string;
  connected?: boolean;
  fullWidth?: boolean;
  label: ComponentChildren;
  span?: boolean;
  description?: ComponentChildren;
  changed: boolean;
  changedRight?: boolean;
  render: (data: { id: string }) => VNode;
  onReset?: () => void;
}): VNode {
  const reset =
    onReset != null && changed ? (
      <button
        type="button"
        className="Field-resetButton TextSmall"
        onClick={onReset}
      >
        Reset
      </button>
    ) : undefined;

  return (
    <div
      className={classlist("Field", "SpacedVertical", {
        "is-connected": connected,
        "is-fullWidth": fullWidth,
        "is-changed": changed,
        "is-changedRight": changedRight,
      })}
    >
      <div>
        {span ? (
          <span className="Field-label">
            {label}
            {reset}
          </span>
        ) : (
          <span className="Field-label">
            <label htmlFor={id}>{label}</label>
            {reset}
          </span>
        )}

        {render({ id })}
      </div>

      {description != null && (
        <div className="Field-description TextSmall">{description}</div>
      )}
    </div>
  );
}
