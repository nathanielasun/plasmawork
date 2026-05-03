"""Phase 3A — Tool I/O contracts.

``ToolInput`` and ``ToolOutput`` are the contract a tool author writes
``validate_inputs`` and ``run`` against (plan §9.4). They are dict-like
wrappers that enforce two scientific-correctness rules:

1. Numeric arrays that cross a tool boundary carry units. ``require_array
   (..., units=...)`` rejects bare floats / ndarrays without a pint
   ``Quantity`` wrapping. This is the same rule scientific boundaries
   already enforce in ``simworkbench.model_spec`` (plan §22).
2. Required keys raise ``KeyError`` immediately rather than letting a
   tool silently default to ``None`` or fabricate a placeholder.

The classes are deliberately small. Each tool gets its own subclass-free
instance per ``run`` invocation; state lives on the tool itself.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from simworkbench.units.registry import get_registry


class ToolIOError(ValueError):
    """Raised when a tool's I/O contract is violated at runtime."""


class ToolInput(Mapping[str, Any]):
    """Read-only mapping of a tool's input arguments.

    Use::

        def validate_inputs(self, inputs: ToolInput) -> None:
            inputs.require_array("frequency", units="Hz")
            inputs.require_array("intensity")  # units optional
    """

    def __init__(self, data: Mapping[str, Any] | None = None) -> None:
        self._data: dict[str, Any] = dict(data or {})

    def __getitem__(self, key: str) -> Any:
        if key not in self._data:
            raise KeyError(
                f"Tool input is missing required key {key!r}. "
                "Tool inputs raise rather than defaulting (plan §22 — "
                "no silent fabrication at scientific boundaries)."
            )
        return self._data[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    # ------------------------------------------------------------------
    # Validation helpers — used by ``BaseTool.validate_inputs`` impls.
    # ------------------------------------------------------------------

    def require(self, key: str) -> Any:
        """Raise ``ToolIOError`` if ``key`` is missing; return its value."""
        if key not in self._data:
            raise ToolIOError(f"Required tool input missing: {key!r}")
        return self._data[key]

    def require_array(
        self,
        key: str,
        *,
        units: str | None = None,
    ) -> Any:
        """Require that ``inputs[key]`` is a unit-aware array.

        ``units`` (if given) must be dimensionally compatible with the
        input's units; mismatched units raise ``ToolIOError``. Bare floats
        / ints / lists / numpy arrays without a ``Quantity`` wrapping are
        refused — units cross every tool boundary by design.
        """
        value = self.require(key)
        registry = get_registry()
        if not isinstance(value, registry.Quantity):
            raise ToolIOError(
                f"Tool input {key!r} must be a unit-aware Quantity, got "
                f"{type(value).__name__}. Wrap raw arrays with "
                "`simworkbench.units.Q(values, '<unit>')` before passing them in."
            )
        if units is not None:
            expected = registry.parse_units(units)
            if value.dimensionality != expected.dimensionality:
                raise ToolIOError(
                    f"Tool input {key!r} has units {value.units!s} but the "
                    f"tool requires dimensionality of {units!s} "
                    f"({expected.dimensionality})."
                )
        return value


class ToolOutput(Mapping[str, Any]):
    """Result of a tool's ``run``. Read-only at the call site.

    Constructed with a dict; the keys named in ``tool.yaml`` ``outputs``
    are validated by the registry against this output (so a tool that
    declares ``peaks`` and ``figure`` but returns only ``peaks`` fails
    fast at run time).
    """

    def __init__(self, data: Mapping[str, Any] | None = None) -> None:
        self._data: dict[str, Any] = dict(data or {})

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def to_dict(self) -> dict[str, Any]:
        """Return a shallow copy of the output dict."""
        return dict(self._data)


__all__ = ["ToolIOError", "ToolInput", "ToolOutput"]
