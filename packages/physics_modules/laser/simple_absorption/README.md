# simple_absorption

Linear Beer-Lambert absorption. Phase 1D `candidate` module.

## Equation

$I(z) = I_0 \exp(-\alpha z)$, where $\alpha = \sigma n$ (cross-section × density).

## Use

```python
from simworkbench.units import Q
from packages.physics_modules.laser.simple_absorption.src import absorb

result = absorb(
    incident_intensity=Q("1.0e10 W/m^2"),
    absorber_density=Q("1.0e22 1/m^3"),
    cross_section=Q("1.0e-22 m^2"),
    path_length=Q("0.1 m"),
)
print(result["transmitted_intensity"])
print(result["absorbed_fraction"])
```

## Validity

Linear regime, no saturation. No scattering. Uniform absorber density.
