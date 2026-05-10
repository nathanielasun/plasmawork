"""ODE-solver implementation template.

Uses scipy.solve_ivp rather than a hand-rolled timestep loop. Replace the
right-hand side and validation contract with the model your tool owns.
"""

from __future__ import annotations

from simworkbench.tools import BaseTool, ToolInput, ToolOutput


class {{TOOL_CLASS}}(BaseTool):
    name = "{{TOOL_NAME}}"
    version = "{{TOOL_VERSION}}"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("time", units="s")

    def run(self, inputs: ToolInput) -> ToolOutput:
        import numpy as np
        from scipy.integrate import solve_ivp

        time = inputs["time"].to("s").magnitude
        t0 = float(np.min(time))
        t1 = float(np.max(time))
        if t1 <= t0:
            raise ValueError("time input must span a positive interval")

        def rhs(_t: float, y: list[float]) -> list[float]:
            return [-2.0 * y[0]]

        solution = solve_ivp(rhs, (t0, t1), [1.0], t_eval=time, rtol=1e-8, atol=1e-10)
        if not solution.success:
            raise RuntimeError(solution.message)

        rows = [
            {"time_s": float(t), "state": float(y)}
            for t, y in zip(solution.t, solution.y[0], strict=True)
        ]
        return ToolOutput({"summary": rows, "solution": rows})


__all__ = ["{{TOOL_CLASS}}"]
