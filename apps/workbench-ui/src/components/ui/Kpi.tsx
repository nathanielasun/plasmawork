/**
 * Kpi — small metric card (label + value).
 *
 * Compose a row of KPIs by wrapping in a `<div className="kpi-strip">`,
 * which uses an auto-fit grid so the cards reflow at narrow viewports.
 */
import type { ReactNode } from "react";

export interface KpiProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function Kpi({ label, value, className }: KpiProps) {
  return (
    <div className={className ? `kpi ${className}` : "kpi"}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
    </div>
  );
}

export default Kpi;
