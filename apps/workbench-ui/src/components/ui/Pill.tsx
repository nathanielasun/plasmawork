/**
 * Pill — rounded chip for status, kind, or eyebrow tags.
 *
 * Two semantic groups, both encoded as CSS variables in styles.css:
 *   - Trust state: draft / candidate / validated / trusted / deprecated /
 *     exploratory / warning. Used to surface lifecycle state and the
 *     Plan §22 capsule-status invariant (placeholders → exploratory).
 *   - Node kind: paper / model / solver / diagnostic / validation / export.
 *     Reinforces the typed-graph mental model the plan hammers on.
 */
import type { PropsWithChildren } from "react";

export type PillKind =
  | "draft"
  | "candidate"
  | "validated"
  | "trusted"
  | "deprecated"
  | "exploratory"
  | "warning"
  | "paper"
  | "model"
  | "solver"
  | "diagnostic"
  | "validation"
  | "export";

export interface PillProps {
  kind?: PillKind;
  className?: string;
}

export function Pill({
  kind,
  className,
  children,
}: PropsWithChildren<PillProps>) {
  const classes = ["pill"];
  if (kind) classes.push(`pill-${kind}`);
  if (className) classes.push(className);
  return <span className={classes.join(" ")}>{children}</span>;
}

export default Pill;
