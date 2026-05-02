# ADR-0004: Units library — `pint`

## Status
Accepted

## Date
2026-05-02

## Context
The workbench treats physical units as first-class. Plan §8.3 requires unit conversion, dimensional consistency checks, symbolic unit checks for equations, runtime validation of user input, and display-unit conversion for plots and UI. Phase 0 left this open in `configs/default.yaml` with `units.library: pending`. Phase 1 / Workstream 1B cannot proceed without a choice.

The candidates are:

- **`pint`** — Python units library by hgrecco. Mature (10+ years). BSD-3 licensed. NumPy / Pandas / xarray integration. Project-defined unit registries. Wide adoption in scientific Python (e.g. used by xarray's `pint-xarray`, by metpy, by openmm). Active maintenance.
- **`astropy.units`** — astrophysics-driven. Excellent dimensional analysis. Heavyweight: pulls in the full astropy dependency tree (FITS readers, time scales, cosmology models) that we don't need.
- **`unyt`** — units library born from `yt` (astrophysical visualization). Strong NumPy story, physics-friendly. Smaller user base than `pint`. Closer to a NumPy `ndarray` subclass philosophically.
- **Custom wrapper** — write our own. Maximum control, weeks of effort, zero unique value over the established options.

## Decision

Use **`pint`** as the unit library, wrapped behind `simworkbench.units` so that the wrapper is the public API and `pint` is a swappable implementation detail.

Specifically:

- `simworkbench.units` exposes `Q` (quantity factory), a workbench-specific `UnitRegistry` instance, and dimensional-consistency validators.
- The `UnitRegistry` is initialized with `pint`'s default registry plus workbench-specific definitions (e.g. `electron_volt = 1.602176634e-19 * J = eV`, ensuring SI-derived consistency for fields the workbench will commonly use: laser intensity, photon energy, plasma density).
- Public APIs (`ModelSpec`, modules, runtime, diagnostics) take and return `simworkbench.units.Q` quantities — never raw floats — at boundaries.
- ModelSpec YAML uses `pint`-compatible string forms (e.g. `"1.0e18 1/m^3"`, `"248 nm"`), parsed by the loader into `Q`.
- `pint` is pinned to a tested major version in `packages/core/pyproject.toml`.

## Alternatives considered

- **`astropy.units`** — rejected. Dependency footprint too large for the workbench's needs and intermixing astropy's `Quantity` with non-astropy code occasionally produces friction.
- **`unyt`** — strong second choice but smaller ecosystem than `pint`. Could be reconsidered later via the wrapper if a specific need arises (e.g. better NumPy ufunc behavior for HPC backends).
- **Custom** — rejected for the obvious reason: NIH, no value, and we would inevitably re-derive `pint`'s edge cases poorly.

## Consequences

**Positive**
- Mature, license-friendly, widely-used dimensional analysis from day one.
- Integrates with NumPy / Pandas / xarray, all of which Phase 1+ will rely on.
- Project-specific unit registry lets us add the unitful constants the laser-physics domain needs without polluting `pint`'s defaults.
- Wrapping `pint` behind `simworkbench.units` means the choice is reversible — the wrapper is the public API, the library can be swapped if `pint` ever stops fitting.

**Negative**
- One more runtime dependency. (Acceptable: the alternative is no units, which is forbidden by §22 of the plan.)
- `pint` has a few NumPy interop quirks (e.g. with `numpy.einsum` and certain ufuncs). The wrapper covers them with tests.
- Some libraries we may later use (e.g. `scipy`) do not natively understand `pint` quantities and require unwrap-then-rewrap idioms. The wrapper exposes helpers for this.

**Neutral**
- Display-unit conversion for plots and UI is `pint`-native (`.to(unit_string)`). The visualization subsystem uses the wrapper, not `pint` directly.

## Implementation notes

- Phase 1 / Workstream 1B implements the wrapper, the workbench registry, and dimensional validators. Tests cover: definition load, conversion, dimensional consistency, NumPy interop, ModelSpec round-trip.
- ModelSpec YAML strings are parsed by the wrapper's `parse_quantity()` helper, which raises a typed error on dimensional mismatch.
- Any future ADR proposing to swap `pint` for another library must (1) preserve the `simworkbench.units` public API and (2) document the migration path for in-flight capsules whose `provenance.lock` records `pint` as the active library.

## References

- Plan §2.1 (scientific inspectability requires explicit units), §8.3 (units subsystem), §22 (scientific accuracy policy).
- ADR-0003 (ModelSpec IR — every physical quantity carries units; raw floats rejected at the ModelSpec boundary).
