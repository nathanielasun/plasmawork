"""Phase 3A — ``BaseTool`` abstract base class.

Every internal tool subclasses ``BaseTool`` and implements
``validate_inputs`` + ``run`` (plan §9.4). ``BaseTool.execute`` wraps the
two so callers (registry, UI, agents) get a consistent surface that
runs validation first, then ``run``, then validates the declared outputs
are present.

The metadata + lifecycle live alongside the class so ``BaseTool``
subclasses can be registered without a separate config object:

    class AbsorptionSpectrumDiagnostic(BaseTool):
        name = "absorption_spectrum_diagnostic"
        version = "0.1.0"
        ...
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from .io import ToolInput, ToolOutput


class BaseTool(ABC):
    """Abstract base for internal tools.

    Subclasses MUST set ``name`` and ``version`` as class attributes (the
    registry's ``tool.yaml`` validation cross-references them) and MUST
    implement ``validate_inputs`` + ``run``.

    The default ``execute`` is the production entry-point: it builds a
    ``ToolInput`` from the kwargs, validates, runs, and returns the
    ``ToolOutput``. The registry also calls ``execute`` so the wrapping
    behavior is uniform for every tool.
    """

    name: str = ""
    version: str = "0.0.0"

    # ------------------------------------------------------------------
    # Subclass interface
    # ------------------------------------------------------------------

    @abstractmethod
    def validate_inputs(self, inputs: ToolInput) -> None:
        """Raise ``ToolIOError`` if the inputs are not acceptable.

        Subclasses use ``inputs.require_array(...)`` / ``inputs.require(...)``
        helpers to declare what they need.
        """

    @abstractmethod
    def run(self, inputs: ToolInput) -> ToolOutput:
        """Execute the tool. Returns a ``ToolOutput``."""

    # ------------------------------------------------------------------
    # Public driver — used by the registry and UI.
    # ------------------------------------------------------------------

    def execute(self, **kwargs: Any) -> ToolOutput:
        """Validate, run, and return the tool's output.

        Equivalent to::

            inputs = ToolInput(kwargs)
            self.validate_inputs(inputs)
            return self.run(inputs)
        """
        inputs = ToolInput(kwargs)
        self.validate_inputs(inputs)
        result = self.run(inputs)
        if not isinstance(result, ToolOutput):
            raise TypeError(
                f"Tool {self.name!r} returned {type(result).__name__} from "
                "run(); expected ToolOutput."
            )
        return result


__all__ = ["BaseTool"]
