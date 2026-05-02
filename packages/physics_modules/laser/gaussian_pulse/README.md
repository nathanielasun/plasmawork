# gaussian_pulse

Gaussian temporal laser pulse. Phase 1D `candidate` module per ADR-0001 (laser focus).

## Use

```python
from simworkbench.units import Q
from packages.physics_modules.laser.gaussian_pulse.src import GaussianPulse

pulse = GaussianPulse(
    peak_intensity=Q("1.0e10 W/m^2"),
    center_time=Q("0 s"),
    fwhm_duration=Q("25 ns"),
)
print(pulse.intensity_at(Q("0 s")))     # peak intensity
print(pulse.intensity_at(Q("12.5 ns"))) # half-peak intensity
```

## Inputs / outputs

| Name | Units |
|---|---|
| `peak_intensity` | W/m^2 |
| `center_time` | s |
| `fwhm_duration` | s |
| `intensity_at_time` (returned) | W/m^2 |

## Equation

$I(t) = I_0 \exp\left(-\dfrac{(t - t_0)^2}{2 \sigma^2}\right)$, with $\sigma = \mathrm{FWHM} / (2 \sqrt{2 \ln 2})$.

## Validity

Strictly temporal. No spatial profile. No chirp. The FWHM must be sampled at
least four times by the consuming runner's output dt or the pulse is
undersampled.

## Status

`candidate` (Phase 1D). Promotion to `validated` requires plan §14.3
criteria (benchmark or limiting-case validation, regression tests).
