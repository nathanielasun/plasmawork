# simple_emission

Spontaneous emission with explicit lifetime. Phase 1D `candidate` module.

## Equation

$\dfrac{d n^*}{dt} = -\dfrac{n^*}{\tau}$ ⇒ $n^*(t) = n^*_0 \exp(-t/\tau)$

Photon emission rate per unit volume: $R(t) = n^*(t) / \tau$.

## Use

```python
import numpy as np
from simworkbench.units import Q
from packages.physics_modules.laser.simple_emission.src import decay

ts = np.linspace(0, 30e-9, 200)
result = decay(
    initial_excited_density=Q("1e18 1/m^3"),
    lifetime=Q("10 ns"),
    time_grid=Q(ts, "second"),
)
print(result["excited_density_trajectory"][-1])  # ≈ 1e18 * exp(-3) ≈ 5e16
```

## Validity

Single radiative channel; no quenching, no reabsorption, no re-pumping
during the decay window.
