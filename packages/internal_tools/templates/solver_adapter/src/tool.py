"""Solver-adapter template.

Wraps a numerical solver (stiff ODE wrapper, PIC adapter, finite-volume
solver, ...) behind the ``BaseTool`` surface. Per AGENTS.md: prefer
validated library calls (e.g. ``scipy.integrate.solve_ivp``) over
hand-rolled timestep loops.
"""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput
from simworkbench.units import magnitude


class SolverAdapterTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require("rhs")
        inputs.require_array("t_span", units="s")
        inputs.require_array("y0")

    def run(self, inputs: ToolInput) -> ToolOutput:
        from scipy.integrate import solve_ivp

        rhs = inputs["rhs"]
        t_span = magnitude(inputs["t_span"], "s")
        y0 = inputs["y0"].magnitude
        result = solve_ivp(rhs, (float(t_span[0]), float(t_span[-1])), y0, method="LSODA")
        return ToolOutput(
            {
                "trajectory": {
                    "t": result.t.tolist(),
                    "y": result.y.tolist(),
                    "success": bool(result.success),
                }
            }
        )


__all__ = ["SolverAdapterTemplate"]
