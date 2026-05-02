# basic_species

Basic species wrapper. Phase 1D `candidate` module.

## Use

```python
from simworkbench.units import Q
from packages.physics_modules.species.basic.src import BasicSpecies, electron, ion

e = electron(initial_density=Q("1.0e18 1/m^3"))
Kr = BasicSpecies(name="Kr", mass=Q("83.798 amu"), charge=0,
                  initial_density=Q("1.0e22 1/m^3"))
KrPlus = ion(name="Kr+", mass=Q("83.798 amu"), charge=1,
             initial_density=Q("0 1/m^3"))
```

## Inputs / outputs

| Field | Units |
|---|---|
| `name` | dimensionless string |
| `mass` | mass (kg or amu) |
| `charge` | dimensionless integer multiple of e |
| `initial_density` | 1/m^3 |

Returns a frozen dataclass `BasicSpecies` with validated unit-aware fields.

## Validity

Non-relativistic only. Charge is an integer multiple of the elementary charge.

## Status

`candidate` (Phase 1D). The full ModelSpec ``Species`` schema lives in
``simworkbench.model_spec.types``; this module is a small constructor sugar
on top of that schema for code that builds species programmatically.
