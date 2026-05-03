"""Core experiment model for Phase 1A.

The classes here describe a manually configured experiment before the Phase 1C
runtime executes it. They intentionally do not run simulations; they bind a
validated `ModelSpec` to run, backend, and diagnostic configuration and provide
a stable serialization boundary.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from simworkbench.model_spec import ModelSpec, to_dict
from simworkbench.model_spec import from_dict as model_spec_from_dict
from simworkbench.model_spec.types import KNOWN_BACKENDS, Quantity
from simworkbench.units import UnitsError


class ExperimentError(ValueError):
    """Raised when an experiment cannot be validated or serialized."""


class BackendConfig(BaseModel):
    """Backend selection for an experiment.

    Purpose: identify which solver backend should execute the experiment.
    Inputs: `name` is a backend identifier with no units; `options` are
    backend-specific metadata that must not contain physical raw floats.
    Outputs: a validated backend configuration object.
    Assumptions: Phase 1A only validates names and metadata shape; execution
    capability checks land in Phase 1C/8.
    References: plan Phase 1A, Phase 8; ADR-0001.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = "python_cpu"
    options: dict[str, str | bool | int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_backend_name(self) -> BackendConfig:
        if self.name not in KNOWN_BACKENDS:
            raise ValueError(
                f"Unknown backend {self.name!r}. Known backends: {sorted(KNOWN_BACKENDS)}."
            )
        return self


class DiagnosticConfig(BaseModel):
    """Runtime diagnostic configuration.

    Purpose: configure which ModelSpec diagnostic is emitted and how often.
    Inputs: `quantity` names a ModelSpec species, field, or equation id; cadence
    is a dimensionless positive integer step count.
    Outputs: validated diagnostic configuration.
    Assumptions: quantity existence is checked by `Experiment`, where the
    ModelSpec is available.
    References: plan Phase 1A/1E.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    quantity: str
    output_format: str = "parquet"
    visualization: str | None = None
    enabled: bool = True
    cadence_steps: int = 1

    @model_validator(mode="after")
    def _check_cadence(self) -> DiagnosticConfig:
        if self.cadence_steps <= 0:
            raise ValueError("Diagnostic cadence_steps must be positive.")
        return self


class RunConfig(BaseModel):
    """Run-level settings that are independent of backend implementation.

    Purpose: hold deterministic seed, run window, and checkpoint cadence.
    Inputs: `start_time` and `end_time` carry units of time; step/checkpoint
    values are dimensionless counts.
    Outputs: validated run configuration.
    Assumptions: Phase 1A validates configuration only. Runtime semantics for
    pause/resume/checkpoint are implemented in Phase 1C.
    References: plan Phase 1A/1C.
    """

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="forbid",
        validate_default=True,
    )

    start_time: Quantity = "0 s"
    end_time: Quantity = "1 s"
    max_steps: int | None = None
    checkpoint_interval_steps: int | None = 1000
    deterministic: bool = True
    seed: int = 0

    @model_validator(mode="after")
    def _check_run_window(self) -> RunConfig:
        try:
            end_in_start_units = self.end_time.to(self.start_time.units)
        except Exception as exc:  # pragma: no cover - pint provides exact exception type.
            raise UnitsError("RunConfig start_time and end_time must share time units.") from exc
        if end_in_start_units.magnitude <= self.start_time.magnitude:
            raise ValueError("RunConfig end_time must be greater than start_time.")
        if self.max_steps is not None and self.max_steps <= 0:
            raise ValueError("RunConfig max_steps must be positive when provided.")
        if (
            self.checkpoint_interval_steps is not None
            and self.checkpoint_interval_steps <= 0
        ):
            raise ValueError(
                "RunConfig checkpoint_interval_steps must be positive when provided."
            )
        return self


class ToolReference(BaseModel):
    """Phase 3 — declarative reference to a registered internal tool.

    Lets an experiment declare "after the run, apply tool X to the
    diagnostics" without hard-coding which tool. Resolved at apply time
    by ``simworkbench.tools.ToolRegistry``.

    ``inputs_from`` maps each tool input port name to either:
      * ``"diagnostic:<key>"`` — pull from ``RunResult.diagnostics``;
      * a literal value (number, string, list).

    Numeric ports declared in the tool's ``tool.yaml`` MUST also have an
    entry in ``units`` so the apply step can wrap the magnitude with
    ``simworkbench.units.Q``. Without ``units`` the tool's
    ``require_array(units=...)`` would refuse the bare value.
    """

    model_config = ConfigDict(extra="forbid")

    name: str  # tool name as it appears in the registry
    version: str | None = None  # optional pin; loose-match if None
    inputs_from: dict[str, Any] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)


class Experiment(BaseModel):
    """User-created experiment assembled from a ModelSpec and configurations.

    Purpose: represent the Phase 1A core experiment model before execution.
    Inputs: a validated `ModelSpec`, unit-aware `RunConfig`, backend selection,
    and diagnostic configs. Metadata strings have no physical units.
    Outputs: an inspectable, serializable experiment object.
    Assumptions: the class does not execute simulations; Phase 1C runtime owns
    start/pause/resume/checkpoint behavior.
    References: plan Phase 1A; ADR-0003; ADR-0004; Phase 3 / §9 tool binding.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    schema_version: Literal["0.1"] = "0.1"
    name: str
    model_spec: ModelSpec
    run_config: RunConfig = Field(default_factory=RunConfig)
    backend_config: BackendConfig = Field(default_factory=BackendConfig)
    diagnostics: list[DiagnosticConfig] = Field(default_factory=list)
    # Phase 3 — internal tools bound to this experiment. Each ToolReference
    # is applied to the run's diagnostics after the runtime completes; the
    # results land alongside the diagnostics in the saved capsule.
    tool_refs: list[ToolReference] = Field(default_factory=list)
    metadata: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_diagnostic_quantities(self) -> Experiment:
        known = (
            {s.name for s in self.model_spec.species}
            | {f.name for f in self.model_spec.fields_}
            | {eq.id for eq in self.model_spec.equations}
        )
        for diagnostic in self.diagnostics:
            if diagnostic.quantity not in known:
                raise ValueError(
                    f"DiagnosticConfig {diagnostic.name!r} references unknown "
                    f"quantity {diagnostic.quantity!r}. Known quantities: {sorted(known)}."
                )
        return self

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Experiment:
        """Build an experiment from a mapping.

        Purpose: deserialize experiment data from YAML/JSON-like structures.
        Inputs: `data` has no units itself; unit-aware fields inside it are
        parsed by `ModelSpec` and `RunConfig`.
        Outputs: a validated `Experiment`.
        Assumptions: callers have already chosen a trusted local source path.
        References: plan Phase 1A.
        """
        try:
            return cls.model_validate(data)
        except Exception as exc:
            raise ExperimentError(f"Experiment validation failed:\n{exc}") from exc

    def to_dict(self) -> dict[str, Any]:
        """Serialize the experiment to a plain mapping.

        Purpose: produce YAML/JSON-compatible data for save/load.
        Inputs: `self` includes unit-aware quantities.
        Outputs: a plain dict where quantities are unit strings.
        Assumptions: serialization is lossless for Phase 1A fields.
        References: plan Phase 1A.
        """
        return self.model_dump(mode="json", by_alias=True)

    @classmethod
    def load_yaml(cls, path: str | Path) -> Experiment:
        """Load an experiment from a YAML file.

        Purpose: restore a Phase 1A experiment from disk.
        Inputs: `path` is a filesystem path with no units.
        Outputs: a validated `Experiment`.
        Assumptions: the file is project-controlled or explicitly supplied by
        the user.
        References: plan Phase 1A.
        """
        try:
            data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            raise ExperimentError(f"YAML parse error in {path}: {exc}") from exc
        if not isinstance(data, dict):
            raise ExperimentError(f"Experiment YAML must parse to a mapping: {path}")
        return cls.from_dict(data)

    def save_yaml(self, path: str | Path) -> None:
        """Write the experiment as YAML.

        Purpose: persist a Phase 1A experiment for reload.
        Inputs: `path` is a filesystem path with no units.
        Outputs: writes YAML and returns `None`.
        Assumptions: callers pass a project-controlled path unless this is an
        explicit export.
        References: plan Phase 1A.
        """
        Path(path).write_text(
            yaml.safe_dump(self.to_dict(), sort_keys=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def from_model_spec(
        cls,
        model_spec: ModelSpec | dict[str, Any],
        *,
        name: str | None = None,
        run_config: RunConfig | dict[str, Any] | None = None,
        backend_config: BackendConfig | dict[str, Any] | None = None,
        diagnostics: list[DiagnosticConfig | dict[str, Any]] | None = None,
        metadata: dict[str, str] | None = None,
    ) -> Experiment:
        """Create an experiment from a ModelSpec.

        Purpose: provide the manual Phase 1A construction path.
        Inputs: `model_spec` is a validated `ModelSpec` or ModelSpec mapping;
        time fields inside `run_config` carry units.
        Outputs: a validated `Experiment`.
        Assumptions: diagnostics default from `ModelSpec.diagnostics`.
        References: plan Phase 1A.
        """
        spec = (
            model_spec
            if isinstance(model_spec, ModelSpec)
            else model_spec_from_dict(model_spec)
        )
        diagnostic_configs = diagnostics
        if diagnostic_configs is None:
            diagnostic_configs = [
                {
                    "name": diagnostic.name,
                    "quantity": diagnostic.quantity,
                    "output_format": diagnostic.output_format,
                    "visualization": diagnostic.visualization,
                }
                for diagnostic in spec.diagnostics
            ]
        return cls(
            name=name or spec.model.name,
            model_spec=spec,
            run_config=run_config or RunConfig(),
            backend_config=backend_config or BackendConfig(),
            diagnostics=diagnostic_configs,
            metadata=metadata or {},
        )


def model_spec_to_dict(spec: ModelSpec) -> dict[str, Any]:
    """Serialize a ModelSpec for experiment YAML.

    Purpose: centralize ModelSpec serialization for experiment save/load.
    Inputs: `spec` contains unit-aware quantities.
    Outputs: dict with unit strings.
    Assumptions: delegates to `simworkbench.model_spec.to_dict`.
    References: ADR-0003.
    """
    return to_dict(spec)


__all__ = [
    "BackendConfig",
    "DiagnosticConfig",
    "Experiment",
    "ExperimentError",
    "RunConfig",
    "model_spec_to_dict",
]
