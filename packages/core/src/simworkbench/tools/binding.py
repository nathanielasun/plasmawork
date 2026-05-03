"""Phase 3 — Apply Experiment.tool_refs against a run's diagnostics.

The Phase 3 gate verb "use it in an experiment" lands here: an Experiment
declares ``tool_refs: list[ToolReference]``; after the runtime finishes,
``apply_tools(experiment, run_result)`` walks the references, resolves
each tool from the registry, builds the kwargs (pulling from
``run_result.diagnostics`` for ``"diagnostic:<key>"`` lookups), and runs
``RegisteredTool.execute`` (which validates inputs AND outputs).

The helper is small and read-only with respect to the registry; mutating
the registry from inside an experiment apply step is a separate flow.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from simworkbench.units import Q

from .registry import RegisteredTool, ToolRegistry, ToolRegistryError

if TYPE_CHECKING:
    from simworkbench.experiment import Experiment, ToolReference


class ToolBindingError(RuntimeError):
    """Raised when an Experiment's tool_refs cannot be resolved or run."""


def _resolve_tool(registry: ToolRegistry, ref: ToolReference) -> RegisteredTool:
    try:
        entry = registry.get(ref.name)
    except ToolRegistryError as exc:
        raise ToolBindingError(
            f"Experiment tool_ref {ref.name!r} not found in registry"
        ) from exc
    if ref.version and entry.metadata.version != ref.version:
        raise ToolBindingError(
            f"Experiment tool_ref {ref.name!r} pinned to version "
            f"{ref.version!r} but registry has {entry.metadata.version!r}"
        )
    return entry


def _resolve_input(value: Any, diagnostics: dict[str, Any], unit: str | None) -> Any:
    if isinstance(value, str) and value.startswith("diagnostic:"):
        key = value[len("diagnostic:") :]
        if key not in diagnostics:
            raise ToolBindingError(
                f"Tool input references diagnostic {key!r} which is not in "
                f"the run's diagnostics. Known keys: {sorted(diagnostics)}."
            )
        magnitude = diagnostics[key]
    else:
        magnitude = value
    if unit is not None:
        return Q(magnitude, unit)
    return magnitude


def apply_tools(
    experiment: Experiment,
    diagnostics: dict[str, Any],
    *,
    registry: ToolRegistry | None = None,
) -> dict[str, dict[str, Any]]:
    """Run every tool in ``experiment.tool_refs`` against ``diagnostics``.

    Returns ``{tool_name: tool_output_dict}``. The output dict mirrors the
    keys declared in the tool's ``tool.yaml`` ``outputs:`` (validated by
    ``RegisteredTool.execute``). Numeric output values keep their pint
    Quantity wrapping for downstream callers.
    """
    if not experiment.tool_refs:
        return {}
    if registry is None:
        registry = ToolRegistry()
        registry.refresh()
    results: dict[str, dict[str, Any]] = {}
    for ref in experiment.tool_refs:
        entry = _resolve_tool(registry, ref)
        kwargs: dict[str, Any] = {}
        for port, value in ref.inputs_from.items():
            kwargs[port] = _resolve_input(value, diagnostics, ref.units.get(port))
        output = entry.execute(**kwargs)
        results[ref.name] = output.to_dict()
    return results


__all__ = ["ToolBindingError", "apply_tools"]
