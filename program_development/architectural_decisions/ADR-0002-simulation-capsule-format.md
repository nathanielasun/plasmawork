# ADR-0002: Simulation Capsule Format

## Status
Accepted

## Date
2026-05-02 (Proposed)
2026-05-02 (Accepted with HDF5 chosen for bulk data — see Implementation notes below)

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

**Format choices — finalized 2026-05-02 in Phase 2A:**

1. **`manifest.toml`** — TOML, schema lives in `packages/core/src/simworkbench/serialization/manifest.py` (Pydantic model + TOML reader/writer). Fields per plan §7.2.
2. **`model/model_spec.yaml`** — YAML for human-readable structured spec. JSON-schema-validated by `simworkbench.model_spec` from Phase 1A.
3. **Bulk numerical data** — primary format **HDF5** (h5py-based). Reasons:
   - Single-file containers fit cleanly inside `.lxp/` (one `.h5` file per array group, vs. Zarr's directory-of-directories shape that nests inside the capsule directory).
   - h5py is a single mature dependency with broad scientific-Python tooling support (`h5dump`, hdfview, the matplotlib + xarray + pandas readers).
   - For Phase 1's small 0D rate-equation diagnostics and Phase 2's single-machine inspection workflow, HDF5's read/write throughput is more than adequate.
   - **Zarr is explicitly deferred to Phase 8** if HPC parallel-write parity becomes the constraint. The bulk-data writer is wrapped behind `simworkbench.serialization.bulk_data` so a future ADR can swap implementations without breaking call sites.
   - Capsules may carry a JSON sidecar of the same data for tooling that doesn't read HDF5 (Phase 1 minimal capsule already does this for `results/diagnostics.json`).
4. **Tabular diagnostics** — Parquet (Phase 8 onwards if needed; Phase 2 keeps everything in HDF5 for one-format simplicity).
5. **Plots** — PNG + SVG (PNG for UI thumbnails; SVG for publication exports). Plots generated in `<capsule>/results/plots/` by the export system (2C).
6. **Provenance lock** — **TOML**. Phase 1's minimal capsule already writes `provenance/provenance.lock` as TOML; Phase 2 keeps the format. JSON considered and rejected: TOML is more human-readable for the flat-ish lock structure, and it matches `manifest.toml`'s format choice.
7. **Archive form** — `.lxp.zip` (deflate) for export. The directory form is canonical; the archive is a transport format. Implementation in `simworkbench.serialization.exporters.archive` (2C).

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
