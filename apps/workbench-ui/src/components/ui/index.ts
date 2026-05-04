/**
 * Shared UI primitives — Card, Pill, Kpi.
 *
 * Adoption is gradual per `LIMITATIONS.md` — new panels (and panels touched
 * during feature work) opt in to these primitives; older panels keep their
 * legacy element-level styling until naturally refactored.
 */
export { Card } from "./Card";
export type { CardProps } from "./Card";
export { Pill } from "./Pill";
export type { PillKind, PillProps } from "./Pill";
export { Kpi } from "./Kpi";
export type { KpiProps } from "./Kpi";
