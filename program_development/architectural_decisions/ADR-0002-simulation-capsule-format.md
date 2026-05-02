# ADR-0002: Simulation Capsule Format

## Status
Proposed (formalized in Phase 2)

## Date
2026-05-02

## Context
The simulation capsule is the central project artifact (plan §7). It bundles the scientific, computational, and provenance state of a single experiment so it can be inspected, exported, reloaded, forked, and reproduced.

The capsule format must be decided early because every other subsystem (runtime, codegen, registry, validation, UI) writes into or reads from it.

## Decision

A simulation capsule is a **directory** with the suffix `.lxp` and the layout in plan §7.1:

```text
<name>.lxp/
  manifest.toml
  paper_sources/
  model/
  src/
    generated/
    user_edits/
    kernels/
  configs/
  data/
  results/
  validation/
  notebooks/
  provenance/
  README.md
```

**Format choices to be finalized in Phase 2:**

1. **`manifest.toml`** — TOML, frozen schema in `packages/core/src/simworkbench/serialization/manifest_schema.py`. Fields per plan §7.2.
2. **`model/model_spec.yaml`** — YAML for human-readable structured spec. JSON-schema-validated.
3. **Bulk numerical data** — primary format **HDF5** for portability and tooling support; **Zarr** considered for chunked / cloud-friendly use. The decision is deferred until Phase 2 with a benchmark of:
   - file size,
   - read/write throughput on the canonical KrF capsule,
   - support across the Python scientific stack and the UI viewer,
   - chunk-friendliness for 2D/3D field data later.
   The chosen primary format is set in stone in a follow-up ADR. Capsules may carry secondary data in the alternative format if both are well-supported.
4. **Tabular diagnostics** — Parquet.
5. **Plots** — PNG + SVG (PNG for UI thumbnails; SVG for publication exports).
6. **Provenance lock** — TOML or JSON (decision deferred to Phase 2; lean toward TOML for human readability since locks are small).
7. **Archive form** — `.lxp.zip` (deflate) for export. The directory form is canonical; the archive is a transport format.

**Capsule lifecycle**

- Capsules under `temp_runs/` are *in-flight*. They become real capsules when promoted to `simulation_capsules/`.
- `provenance/` is append-only after capsule creation.
- `src/user_edits/` is owned by the user — agents write only to `src/generated/`.
- Forking a capsule copies everything except `provenance/` (the fork starts a new provenance chain referencing the parent's hash).

## Alternatives considered

- **Single binary capsule (HDF5 with everything inside)**: rejected. Loses inspectability — users and agents need to read source code, manifests, and assumptions without HDF5 tooling.
- **Tarball-only (no canonical directory form)**: rejected. Slower to inspect, harder to diff, harder to pause-resume.
- **JSON-only manifest**: rejected. TOML is more human-readable for the manifest's flat-ish structure. JSON is fine for `provenance.lock` if a single-format-everywhere style emerges, but that is a future decision.

## Consequences

**Positive**
- Capsules are inspectable with regular file tools.
- Each subsystem owns its subdirectory cleanly.
- Forking and diffing capsules are well-defined.

**Negative**
- More small files than a single-binary format; copy and archive operations are slightly slower.
- Format diversity (TOML + YAML + HDF5/Zarr + Parquet + PNG/SVG + JSON) means more parsers to keep working.

**Neutral**
- Phase 2 will lock the bulk-data format (HDF5 vs Zarr) before any capsule begins shipping in `validated` examples.

## Implementation notes
- Phase 2 / Workstream 2A produces the capsule schema, validator, and a benchmark to choose HDF5 vs Zarr.
- Phase 2 / Workstream 2B produces the provenance system that writes `provenance/`.
- Phase 2 / Workstream 2C produces export, fork, and archive operations.
