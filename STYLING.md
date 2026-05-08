# Workbench UI Styling Guide

**Last updated: 2026-05-07**

This document is the source of truth for how the workbench UI is styled
and how that styling should evolve. Companion to `LIMITATIONS.md` (which
tracks capability) and `AGENTS.md` (which tracks rules); together those
three top-level documents define how the workbench is built and
maintained.

If you are about to add or change a UI component, read this file first
and update it in the same commit if your change introduces new visual
language. The convention checker pins this document's existence and the
maintenance protocol section.

---

## TL;DR

- **One stylesheet:** `apps/workbench-ui/src/styles.css`. No per-component
  CSS files, no CSS-in-JS, no Tailwind. Bare CSS with custom properties.
- **Two semantic palettes encoded as tokens:**
  - **Node kind** (paper / model / solver / diagnostic / validation /
    export). Reinforces the typed-graph mental model the plan hammers on.
  - **Trust state** (draft / candidate / validated / trusted / deprecated /
    exploratory / warning). Surfaces lifecycle status at a glance.
- **Three reusable primitives:** `Card`, `Pill`, `Kpi`, all in
  `apps/workbench-ui/src/components/ui/`. New panels compose these
  rather than re-inventing visual shapes.
- **One layout shell:** sidebar (collapsible) + main content. Hero
  header → cards → optional KPI strip is the per-panel pattern.
- **Functional dashboard layouts:** use the shared grid/list/detail
  classes in `styles.css` for dense operator, registry, and contract
  panels. These classes exist to prevent overflow, clipped controls, and
  accidental static mockups.
- **Per-panel adoption is gradual.** Older panels keep their existing
  element-level styling until they're naturally refactored. Don't do
  a one-shot port of every panel — each refactor is a chance to slip
  a regression and the visual ROI is bounded.

---

## Tokens (CSS custom properties)

All tokens live in `:root` at the top of `apps/workbench-ui/src/styles.css`.
Components must reference them through `var(--name)`, never hard-code the
value. Adding a token is one source-of-truth edit; using a literal hex
in a component fragments the system.

### Surfaces (depth without heavy shadow)

| Token | Default | Use |
|---|---|---|
| `--surface-page` | `#f4f4f6` | Page background (body) |
| `--surface-card` | `#ffffff` | Cards, sidebar |
| `--surface-nested` | `#f7f7f9` | Cards inside cards, hover fills, segments |
| `--surface-emphasis` | `#ffffff` | Active/selected emphasis |

### Foreground + accent

| Token | Default | Use |
|---|---|---|
| `--fg` | `#1a1a1a` | Primary text, primary buttons |
| `--muted` | `#6b6b6b` | Secondary text, captions, eyebrows |
| `--accent` | `#2b6cb0` | Links, focus borders, primary CTAs (legacy) |
| `--border` | `#e0e0e0` | Default border |
| `--code-bg` | `#f0f0f0` | Inline `<code>` background |

### Elevation

| Token | Use |
|---|---|
| `--shadow-sm` | Cards, hero headers, kpis (default elevation) |
| `--shadow-md` | Hover lift on interactive cards |

### Radius scale

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `6px` | Small chips, code blocks, segment buttons |
| `--radius-md` | `10px` | **Subtle rounding** — info boxes, dark code blocks, segment containers |
| `--radius-lg` | `14px` | Kpi cards, node cards |
| `--radius-xl` | `20px` | Top-level Cards, Hero headers |

**Rule of thumb:** if it's a chip / pill, use `999px` for full rounding.
For everything else, prefer `--radius-md` or `--radius-lg`. **Never** use
`999px` on a multi-line content box — pill rounding only reads correctly
on small inline elements.

### Spacing scale

`--space-1` through `--space-6` (0.25rem → 1.5rem). Use these for
margins/gaps; raw `rem` values are acceptable for one-off tuning.

### Node-kind palette

Six triples (`fill / border / fg`), one per typed-graph node kind. Each
is encoded both as Tailwind-style direct color (`#ddd6fe`) and exposed
through `.pill-{kind}` and `.node-{kind}` classes.

| Kind | Fill | Use |
|---|---|---|
| `paper` | violet (`#f5f3ff`) | Paper sources, ingestion artifacts |
| `model` | blue (`#eff6ff`) | ModelSpec, schemas, structured data |
| `solver` | slate (`#ffffff`) | Solver backends, runtime engines |
| `diagnostic` | cyan (`#ecfeff`) | Diagnostics, observability |
| `validation` | amber (`#fffbeb`) | Validation reports, reviews |
| `export` | emerald (`#ecfdf5`) | Capsules, archives, exporters |

The intent is that a glance at any panel that uses these colors tells
the user **what kind of typed-graph element this is** without reading
text. Treat the palette as semantic, not decorative — using "paper
violet" on something that isn't a paper-derived artifact dilutes the
signal.

### Trust-state palette

Seven triples for lifecycle states. Aligned with `simworkbench.modules`,
`simworkbench.tools`, `simworkbench.backends`, and the autonomy layer's
`capsule_status_for_plan()` rule.

| State | Fill | Meaning |
|---|---|---|
| `draft` | slate (`#f1f5f9`) | Just exists, not exercised |
| `candidate` | amber (`#fef3c7`) | Under review, partial validation |
| `validated` | blue (`#dbeafe`) | Tested against truth (analytic limit, paper figure) |
| `trusted` | green (`#d1fae5`) | Promoted with human approval |
| `deprecated` | red (`#fee2e2`) | Don't use; superseded |
| `exploratory` | amber (`#fef3c7`) | Plan §22 — placeholder coefficients present |
| `warning` | orange (`#fff7ed`) | Generic alert / unstable / overclaim |

**Color = meaning.** A reviewer reading the UI should never have to
guess whether a green pill means "trusted" or "validated". Don't repaint
a state for visual variety — promote it through the lifecycle if it
deserves a different color.

---

## Components (TSX primitives)

All in `apps/workbench-ui/src/components/ui/`. Imported via
`import { Card, Pill, Kpi, FolderBrowser } from "../ui"`. Each is a
small, focused component; do not extend them with kitchen-sink props.

### `<Card>`

Rounded panel with `title`, optional `subtitle`, optional `action` (top-
right slot), optional `nested` flag for inset variant. Default styling:
`--surface-card` background, `--border` border, `--radius-xl` corners,
`--shadow-sm` elevation, 1.25rem padding.

```tsx
<Card title="Sweep" subtitle="Bounded over the parameter grid." action={<Pill kind="trusted">healthy</Pill>}>
  {/* content */}
</Card>
```

Use `nested` for sub-cards inside an outer Card; uses `--surface-nested`
fill and `--radius-md` for the subtler inset look.

### `<Pill>`

Rounded chip for trust state, node kind, or eyebrow tags. Single `kind`
prop covers all 13 variants from the two semantic palettes.

```tsx
<Pill kind="exploratory">{capsule.status}</Pill>
<Pill kind="diagnostic">density_A</Pill>
<Pill kind="warning">3 instability flags</Pill>
```

Use the kind that matches the *meaning*, not the desired color.

### `<Kpi>`

Small metric card (eyebrow label + big value). Compose in a `<div className="kpi-strip">` for an auto-fit grid.

```tsx
<div className="kpi-strip">
  <Kpi label="Completed" value={5} />
  <Kpi label="Failed" value={0} />
  <Kpi label="Failure ratio" value="0.0%" />
</div>
```

### `<FolderBrowser>`

Read-only tree picker over the workbench-managed roots. Used by panels
that need a path-picker (RunControls, AutonomyPanel). Server-side
allow-listed; refuses path traversal.

---

## Layout patterns

### App shell

`apps/workbench-ui/src/App.tsx` defines the global shell:

- Sticky **collapsible sidebar** (260px expanded, 56px collapsed),
  header with title + toggle, nav list of NavLinks, phase tag at the
  bottom (hidden when collapsed). Persisted via localStorage under
  `workbench:sidebar-collapsed`.
- **Main content area** scrolls independently, padded `1.5rem 2rem`.

Routes are mounted inside `<main>`. Each routed panel is responsible
for its own internal layout.

### Per-panel pattern

Most panels follow:

1. **Hero header** (`.hero` + `.hero-eyebrow` / `-title` / `-subtitle`)
   stating what the panel does, with optional eyebrow Pill on the right.
   Skip this for panels that are dense data tables (e.g. Diagnostics
   uses a smaller Card-based summary instead).
2. **Form / inputs** in a Card.
3. **Results** as Cards (with nested Cards for grouped sub-data) and
   KPI strips for at-a-glance numbers.
4. **Errors** as `<p className="error" role="alert">`.

### Dashboard / registry pattern

Dense operational pages use a stronger layout scaffold:

- `.page-stack` wraps the route and provides consistent vertical rhythm.
- `.dashboard-grid`, `.dashboard-grid-2`, and `.dashboard-grid-3` provide
  bounded responsive grids where every child gets `min-width: 0`.
- `.tools-layout` gives tool-construction pages a wide primary workbench
  column and a compact sticky side rail. The rail is a navigator, not a
  registry dump: show active/frequent tools and capped feature groups, then
  use search for exact lookup.
- `.tool-workspace-tabs` is the primary decluttering affordance for the
  Tools page. Keep Run, Build, and Contract as mutually exclusive workspace
  modes instead of stacking all three large panels in one viewport.
- `.tools-overview-collapse` and `.tool-collapse-card` are for secondary
  metrics and less-common actions such as external imports. They should keep
  summary text visible while moving full controls behind native disclosure.
- `.tool-authoring-*` classes define the controlled tool-draft builder:
  Start/Edit/Check tabs, bounded file list/editor, and checker/register
  controls. This panel is a package authoring workflow, not a general
  filesystem browser.
- `.list-row` is the full-width selectable row pattern for registry
  objects; it keeps status pills visible while truncating long names.
- `.detail-grid` is the label/value contract view for server-derived
  objects, manifests, session state, and route metadata.
- `.table-wrap` is mandatory around wide tables in Cards so the table
  scrolls internally rather than widening the entire app shell.

Use these classes for security dashboards, tool registries, workspace
lists, approval queues, and any route-readiness or contract table. Do
not rebuild the same grid/list/detail pattern with inline styles.

### Secure UI surfaces

Security UI has two extra rules:

- Live backend data is preferred; if a local dev panel uses fixtures, it
  must label fixture mode visibly.
- Fail-closed or deployment-gated routes render as disabled controls with
  the route id and reason. Hiding stubs makes readiness ambiguous and
  encourages accidental enablement.

### Docs page

`.docs-page` wraps the documentation browser. It uses an attached two-column
manual layout: a searchable, collapsible secondary `.docs-sidebar` flush
against the primary app sidebar and a scrollable reading column in
`.docs-main`. The docs sidebar is not a floating card/island. Do not restore
the old horizontal row of 20+ page buttons; long documentation sets need
categorized dropdown sections similar to Blender/Python/TensorFlow
documentation. The standalone `docs_site` mirrors the same pattern through
`docs_site/src/components/Sidebar.tsx`.

Collapsed side rails are icon/mark-only: no visible label text such as
`Docs`, `Run`, or `Sim`. Use `aria-label`, `title`, and semantic link/button
labels for accessibility while keeping the visual rail zen. The documentation
rail collapse marker is a small outlined document mark; avoid gradient bars or
smudges in collapsed navigation.

`DocsViewer.tsx` owns documentation navigation metadata:

- `DOC_PAGE_META` gives each page a user-facing title, summary, and search
  keywords.
- `DOC_SECTIONS` groups pages into sidebar dropdowns.
- New docs pages must be added to the appropriate section in the same change
  that adds `docs_site/src/content/<slug>.tsx`.

Pages themselves stay in `docs_site/src/content/<slug>.tsx` as plain HTML; the
wrapper styling does the layout and typography work. Documentation content is
for users and developers, not just implementation agents: prefer current
capability, workflow, guarantees, and operational guidance over phase/workstream
completion prose.

`.page-status` is the per-page current-capability note: subtle `--radius-md`
rounding, `validated`-blue fill, block layout. It is **not** a pill; the
multi-line content needs proper info-box treatment.

---

## Conventions and constraints

### Do

- Use design tokens (`var(--name)`) for color, radius, shadow, spacing.
- Compose new panels from `Card` / `Pill` / `Kpi` / `FolderBrowser`.
- Keep semantic colors aligned with their meaning (`validated` is blue
  because it's tested against truth; `trusted` is green because it's
  human-approved).
- Use `--radius-md` for subtly rounded info boxes; `--radius-xl` only
  for top-level Cards/Hero.
- Add `min-width: 0` to flex children when their content can be wide
  (long URLs, `<pre>` blocks). Prevents overflow pushing parents past
  the viewport.
- Add `overflow-x: auto` on `<pre>` so long code blocks scroll inside
  their container instead of breaking layout.

### Don't

- **No Tailwind, no PostCSS, no CSS-in-JS.** The bare-CSS choice is
  deliberate per `LIMITATIONS.md` — visual polish is bounded to what
  the substrate's stage of development justifies.
- **No per-component CSS files.** All styling lives in `styles.css`
  organized by concern (tokens → layout → components → utilities).
- **No `999px` border-radius on multi-line boxes.** Pill rounding is
  for chips. Anything wider than ~200px or taller than one line gets
  `--radius-md` or larger.
- **No inline color hex literals.** If the color you want isn't a
  token, propose a token (and update this doc) rather than ad-hoc.
- **No `!important`.** If specificity isn't enough, restructure.
- **No new top-level CSS classes without a home in this guide.**
  Either fold them under an existing pattern or document a new one
  in the same commit.

### Typography (docs-content)

The docs pages are plain HTML markup; `.docs-content` provides the
typography reset:

- Body: 0.95rem, 1.65 line-height
- h1: 1.7rem, weight 800, letter-spacing tight
- h2: 1.15rem, weight 700, with bottom border
- h3 / h4: 1.02rem / 0.95rem, weight 700
- `<pre>`: dark slate fill (`#0f172a`), light text, `--radius-md`,
  `overflow-x: auto`, no auto-wrap inside `code`

Add a new pattern (e.g. callouts, admonitions) by extending
`.docs-content` rather than inlining into the docs pages themselves —
docs stay author-friendly that way.

---

## Maintenance protocol

`STYLING.md` is part of the durable repo memory. Update it on:

1. **New design token added** — color, radius, shadow, spacing. Add
   a row to the appropriate table here in the same commit.
2. **New shared primitive added** — anything in `components/ui/`.
   Add a section here with usage example.
3. **New layout pattern adopted by a panel** — if you invent a
   structural shape that another panel could use, document it.
4. **Visual contract change** — if `validated` ever moves from blue
   to a different color, update the trust-state table here and
   audit every consumer.

Do **not** update for:

- Routine bug fixes that don't change the visual language.
- Per-panel tweaks that don't introduce a new token or component.
- Test additions confirming an already-documented pattern.

The convention checker pins this file's existence and the
"Maintenance protocol" section. Removing a documented token without
updating this doc breaks the gate.

### Cross-references

- `LIMITATIONS.md` — capability map, including the styling stack's
  rationale (bare CSS, no Tailwind).
- `AGENTS.md` — durable rules; the canonical-source rule for docs
  ("docs come from `docs_site/`, not the UI bundle").
- `CLAUDE.md` — operational playbook; phase-close workflow.
- `program_development/architectural_decisions/ADR-0005-ui-framework.md`
  — the original UI framework decision (Vite + React).
- `apps/workbench-ui/src/styles.css` — the implementation. This
  document describes intent; the stylesheet is the source of truth
  for current values.

---

## Quick checklist before committing UI changes

1. Did you use `var(--token)` for every color / radius / shadow?
2. Did you compose `Card` / `Pill` / `Kpi` rather than recreating their shapes?
3. Did the new component use the semantic kind that matches its
   meaning (not just the color you wanted)?
4. Are flex children that contain potentially-wide content given
   `min-width: 0`?
5. Are `<pre>` blocks given `overflow-x: auto`?
6. Did you add a new pattern? If so, is it documented here?
7. Did UI tests + typecheck pass (`scripts/test/ui.sh`)?
