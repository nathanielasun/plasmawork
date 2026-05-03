# Absorption-spectrum diagnostic

Reference implementation of an internal tool. Cited by plan §9.4. Used as
the canonical example by the Tool UI walkthrough and by the registry
integration test.

## Inputs

| Name | Type | Units | Description |
|---|---|---|---|
| `frequency` | array | Hz | 1-D frequency axis, monotonic. |
| `intensity` | array | dimensionless | 1-D intensity values aligned to the frequency axis. |

## Outputs

| Name | Type | Description |
|---|---|---|
| `peaks` | table | One row per detected local maximum: `{frequency_hz, intensity}`. |
| `peak_count` | scalar | Number of peaks the diagnostic returned. |

## Method

Local-maximum finder: index `i` is a peak iff `intensity[i] > intensity[i-1]`
and `intensity[i] > intensity[i+1]`. Endpoints are excluded because peaks at
the boundary aren't well-defined for a discrete spectrum.

## Limitations

- No noise filtering; for noisy signals run a smoother first.
- Plateau peaks (multi-sample maxima at the same height) are not detected —
  the strict-greater comparison rejects them.

## Status

`candidate`. Promotion to `validated` requires an independent benchmark
case (e.g. a Lorentzian with known peak count) to be added to
`validation.reference_cases` in `tool.yaml`.

## Run the tests

```bash
.venv/bin/pytest packages/internal_tools/registry/absorption_spectrum_diagnostic/tests/
```
