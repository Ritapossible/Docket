import type {ReactNode} from "react";

export function Eyebrow({children, muted}: {children: ReactNode; muted?: boolean}) {
  return <p className={muted ? "eyebrow muted" : "eyebrow"}>{children}</p>;
}

export function Panel({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Stat({label, value, mono}: {label: string; value: ReactNode; mono?: boolean}) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className={mono ? "v mono" : "v"}>{value}</div>
    </div>
  );
}

export function Row({
  index,
  label,
  sub,
  meta,
  variant,
}: {
  index: string;
  label: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  variant?: "dark" | "highlight";
}) {
  const className =
    variant === "highlight" ? "row highlight" : variant === "dark" ? "row on-dark" : "row";
  return (
    <div className={className}>
      <span className="badge">{index}</span>
      <div>
        <div className="row-label">{label}</div>
        {sub ? <div className="row-sub">{sub}</div> : null}
      </div>
      {meta ? <div className="row-meta">{meta}</div> : null}
    </div>
  );
}
