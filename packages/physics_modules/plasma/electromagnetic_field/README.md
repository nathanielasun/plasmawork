# Plasma — Electromagnetic Field (candidate)

Candidate interface for an electromagnetic-field representation used by
particle pushers and PIC adapters. This module ships the data shape + unit
contract; numerical FDTD/FFT evolution requires a validated field
solver/backend.

```python
from simworkbench.units import Q
from packages.physics_modules.plasma.electromagnetic_field.src import ElectromagneticField

em = ElectromagneticField.zeros(
    domain_extent=Q([0.1, 0.1, 0.1], "meter"),
    grid_resolution=Q([0.01, 0.01, 0.01], "meter"),
)
em.grid_shape  # (10, 10, 10)
em.E.shape     # (10, 10, 10, 3)
```
