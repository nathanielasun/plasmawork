# Solver-adapter template

Starting point for a solver-adapter tool — wraps a numerical solver
(ODE, PDE, PIC, ...) behind the `BaseTool` surface.

The default uses `scipy.integrate.solve_ivp` with LSODA (matches
`simworkbench.runtime`'s default for stiff problems). Per AGENTS.md
"Code Style and Module Boundaries", **never hand-roll timestep loops**;
use a validated library call.
