# Lambert-Beer Absorption (validated)

Homogeneous absorbing medium with linear absorption: ``I(z) = I0 * exp(-alpha z)``.
This is the canonical Phase-7 laser-domain reference module — small, exactly
solvable, and useful as a sanity check for any code path that produces an
intensity profile.

## Usage

```python
from simworkbench.units import Q
from packages.physics_modules.laser.absorption_lambert_beer.src import LambertBeerAbsorber

abs = LambertBeerAbsorber(
    incident_intensity=Q(1e10, "watt / meter ** 2"),
    absorption_coefficient=Q(50.0, "1 / meter"),
)
print(abs.transmission(Q(1e-2, "meter")))            # T(z=1cm)
print(abs.transmitted_intensity(Q(1e-2, "meter")))   # I(z=1cm) in W/m^2
print(abs.path_length_for_transmission(0.1))         # path length for T=10%
```

## Validity domain

- Homogeneous, linear absorber. No saturation, no nonlinear effects, no
  dispersion. See `validity_domain.md` for the full list of caveats and
  the regimes in which this module **does not** apply.

## Validation

`benchmarks/closed_form_transmission.py` exercises the closed-form analytic
solution at multiple `(alpha, z)` pairs and asserts agreement to within
`1e-12` relative error. The matching pytest in
`tests/test_benchmarks.py` is the gate for the `validated` lifecycle status.

## References

- Beer-Lambert law (Wikipedia): <https://en.wikipedia.org/wiki/Beer-Lambert_law>
- Born & Wolf, *Principles of Optics*, §1.6 (absorbing media).
