# KrF excimer — exploratory 0D kinetics

A simplified 4-species rate-equation model of a KrF excimer laser
under 248 nm pumping. Plan §18.1 names KrF as the canonical
autonomous-pipeline target; this example exercises the spec / runner
/ capsule path against the real `python_cpu` rate-equation backend.

## What this is

- **4 species:** Kr (ground), Kr\* (excited), F (atom), KrF (excimer).
- **1 field:** a 248 nm KrF laser pulse, `1.0e10 W/m²` peak intensity,
  `20 ns` duration.
- **4 interactions** (each at most 2 species participants per Phase 1's
  `python_cpu` constraint):
  1. `kr_photoexcitation` — Kr → Kr\* driven by the laser field.
  2. `kr_star_quench` — Kr\* → Kr (lumped collisional + radiative).
  3. `krf_formation` — F → KrF (placeholder for the real
     three-body harpooning Kr\* + F₂ + buffer → KrF\* + F).
  4. `krf_relaxation` — KrF → Kr (excimer spontaneous emission).

## What this is NOT

Per [`LIMITATIONS.md`](../../LIMITATIONS.md):

- **Every rate coefficient is a placeholder.** Each interaction's
  `coefficient_sources` entry begins with `"placeholder:"` so the
  runtime treats the run as exploratory (Plan §22) and the capsule
  status comes out as `exploratory`, never `validated`.
- **`krf_formation` is not a real harpooning reaction.** The real
  reaction is three-body (Kr\* + F₂ + buffer); Phase 1 supports at
  most two species participants per interaction, so we decompose
  pairwise. The dynamics are directionally correct (KrF rises while
  the laser pumps; KrF decays after the pulse) but the coefficients
  are not calibrated.
- **Kr atoms are not strictly conserved.** The pairwise approximation
  drops the Kr\* + F₂ → KrF\* + F coupling.

The substrate (loader, runner, capsule writer, provenance trace)
works end-to-end on this model. The science would land via Phase 4
paper ingestion supplying real cross-section + lifetime values, at
which point the capsule could be promoted from `exploratory`.

## Running

```bash
python examples/krf_excimer/run.py
# or with custom parameters:
python examples/krf_excimer/run.py --max-steps 400 --end-time "100 ns"
```

The run writes:
- A JSON summary to `temp_runs/<run_id>/summary.json` (species
  trajectories + placeholder list).
- A simulation capsule to `simulation_capsules/krf_excimer-<hash>.lxp/`
  with status `exploratory` (unless `--no-capsule`).

## Reading the output

After the run finishes, the terminal prints the initial and final
density of every species. Expected qualitative behaviour:
- **Kr** decreases slightly during the pulse, then partially recovers.
- **Kr\*** rises during the pulse and decays via quenching after.
- **F** decreases monotonically as the placeholder formation channel
  drains it.
- **KrF** rises while the F → KrF channel is active, then decays.

The capsule's `provenance/agent_trace.md` records which agents (if any)
touched the run. The capsule's `manifest.toml` carries the
`exploratory` status that Plan §22 enforces while placeholders exist.
