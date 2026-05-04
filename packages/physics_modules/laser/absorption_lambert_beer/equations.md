# Equations

## Differential form

For a parallel beam propagating through a homogeneous absorbing medium:

    dI/dz = -alpha * I

with boundary condition `I(z=0) = I_0`, where:

- `I(z)` = intensity at path-length `z` (W/m^2),
- `alpha` = absorption coefficient (1/m, real, non-negative),
- `z` = path length through the medium (m).

## Closed-form solution

    I(z) = I_0 * exp(-alpha * z)

Equivalently, the **transmission** `T = I/I_0` satisfies

    T(z) = exp(-alpha * z),

and the **optical depth** `tau = alpha * z` satisfies

    T = exp(-tau).

## Path length for a target transmission

Solving for `z` given `T_target`:

    z_target = -ln(T_target) / alpha

valid for `0 < T_target <= 1` and `alpha > 0`.

## Numerical implementation

The module evaluates the closed forms directly with `math.exp` and
`math.log`. No integrator is involved, so accuracy is limited only by
the underlying double-precision floating-point representation.
