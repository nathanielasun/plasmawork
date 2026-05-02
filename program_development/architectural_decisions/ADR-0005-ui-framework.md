# ADR-0005: Workbench UI framework — Vite + React

## Status
Accepted

## Date
2026-05-02

## Context
Phase 1 / Workstream 1F (plan §Phase 1) ships a TypeScript UI workbench with simulation list, run controls, code/docs viewers, diagnostics & plot panels, and a capsule explorer. Plan §3 places the UI under `apps/workbench-ui/`. The `docs_site/` documentation app already uses Vite + React + React Router (per the `docs_site/` skeleton landed during Phase 0). The workbench UI's docs viewer must load pages directly from `docs_site/src/content/*.tsx` per AGENTS.md ("Maintain program documentation inside `docs_site/`... do not duplicate documentation strings into the UI source — load from the canonical docs"), so the framework choice is constrained: it must be able to import TSX modules from `docs_site/`.

The candidates considered:

- **Vite + React** — same toolchain `docs_site/` uses, SPA-flavored, fast dev server, native TypeScript and JSX, easy to share components with `docs_site/` via path alias, smallest dep footprint.
- **Next.js** — heavier, file-system routing, SSR/SSG capabilities the workbench doesn't need (it's an offline desktop UI), pulls in a bigger dep tree.
- **Astro** — content-site flavored, can island components, but the workbench is interactive-heavy and benefits less from Astro's static-first model.
- **SvelteKit / Solid / others** — preclude reusing `docs_site/`'s React content tree without a wrapper.

## Decision

The workbench UI uses **Vite + React + React Router**, with TypeScript (`strict: true`). Specifically:

- `vite` ≥ 5 with `@vitejs/plugin-react` for HMR and JSX.
- `react` 18 + `react-dom` 18.
- `react-router-dom` 6 for client-side routing across panels.
- `vitest` + `@testing-library/react` + `jsdom` for component tests.
- A Vite path alias `@docs` → `<repo>/docs_site/src/content` so `DocsViewer.tsx` loads the canonical docs without duplication.

This matches `docs_site/`'s stack so the same toolchain skills apply across both apps; it keeps the dep footprint modest; and it makes cross-app component reuse straightforward.

## Alternatives considered

- **Next.js**: rejected for Phase 1. Heavier, file-system routing imposes a directory shape the plan doesn't demand, and SSR/SSG is irrelevant to a local interactive workbench. Could be reconsidered later if the workbench grows a remote-served deployment mode (Phase 8+), but that would be a separate ADR superseding this one.
- **Astro**: rejected. Static-first model is a poor fit for the runtime-heavy run controls, plot panel, and capsule explorer.
- **Non-React frameworks (Svelte, Solid)**: rejected because `docs_site/`'s content modules are React components; a non-React UI would need a wrapper layer that defeats the no-duplication rule.

## Consequences

**Positive**
- Toolchain parity with `docs_site/` — one stack to learn, one set of lint/type rules.
- Vite's dev server is fast; HMR is well-suited to UI iteration on a runtime-driven app.
- `DocsViewer.tsx` can directly import `docs_site/src/content/<page>.tsx` modules via the `@docs/*` alias — zero duplication.

**Negative**
- React 18 SSR features remain unused; that's fine because the workbench is offline-first.
- Two Vite apps in the repo (`docs_site/` and `apps/workbench-ui/`). They share the same kind of toolchain but have separate `package.json`s and `node_modules`. Acceptable — the alternative (one monolithic app) would couple them more than the AGENTS.md packaging-boundary rule allows.

**Neutral**
- Phase 8+ may revisit the framework if a server-rendered workbench mode becomes a goal. Until then this ADR stands.

## Implementation notes

- `apps/workbench-ui/package.json` declares the deps listed above and replaces the Phase-0 placeholder language.
- `apps/workbench-ui/vite.config.ts` adds the `@docs` alias plus a dev server port matching `configs/default.yaml`'s `ui.port` (5173).
- `scripts/dev/run_ui.sh` and `scripts/build/ui.sh` flip from Phase-0 stubs to real `npm` invocations in the same commit.

## References

- Plan §Phase 1 / Workstream 1F.
- AGENTS.md "Repository Architecture Rules" (packaging boundary, docs duplication forbidden).
- ADR-0001 (project scope).
- `docs_site/` (Phase 0 skeleton — same Vite + React stack).
