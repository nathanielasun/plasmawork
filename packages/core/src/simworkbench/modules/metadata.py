"""Phase 7 — Registry v1 module metadata.

The Phase-1 ``module.yaml`` shape carried name / version / domain /
status / inputs / outputs / validity_domain / references / tests.
Phase 7 / 7A adds:

  - dependencies: list of other registered modules this module imports
    (name, optional version pin).
  - benchmarks: list of analytic / paper-reproduction reference cases
    that gate the candidate → validated promotion.
  - compatibility: declared backend list, schema version, dimensionality.

The schema is permissive: every old Phase-1 ``module.yaml`` continues to
load — the new fields default to empty lists / minimal blocks. Validated
modules MUST declare a non-empty benchmarks list (the gate-walk test
asserts this).
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Dependency(BaseModel):
    """A module dependency reference."""

    model_config = ConfigDict(extra="forbid")

    name: str
    version: str | None = None
    notes: str = ""


class BenchmarkRef(BaseModel):
    """A benchmark / analytic / paper-reproduction reference.

    The benchmark file lives under ``<module>/benchmarks/<id>.{py,md,yaml}``
    and is invoked by the module's pytest tree. The metadata block here
    is the index reviewers use to trace why the module is validated.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    description: str = ""
    reference: str = ""  # paper title / DOI / URL — free text
    tolerance: str = ""  # e.g. "1%", "1e-6 absolute" — free text
    artifact: str = ""  # repo-relative path, e.g. "benchmarks/lambert_beer.py"


class ModuleCompatibility(BaseModel):
    """Compatibility metadata: where this module can run."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = "0.1"
    backends: list[str] = Field(default_factory=list)  # e.g. ["python_cpu"]
    dimensionalities: list[int] = Field(default_factory=list)  # e.g. [0, 1]


class ModulePort(BaseModel):
    """One declared input / output port."""

    model_config = ConfigDict(extra="forbid")

    name: str
    units: str = ""
    description: str = ""


class ModuleValidity(BaseModel):
    """Carried forward from Phase 1 — free-form notes for validity."""

    model_config = ConfigDict(extra="allow")

    notes: list[str] = Field(default_factory=list)


class ModuleReference(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str = ""
    doi: str = ""
    url: str = ""


class ModuleTests(BaseModel):
    """Phase-1 tests block; carried forward."""

    model_config = ConfigDict(extra="allow")

    unit: list[str] = Field(default_factory=list)
    benchmark: list[str] = Field(default_factory=list)
    integration: list[str] = Field(default_factory=list)


class ModuleMetadata(BaseModel):
    """Registry v1 ``module.yaml`` shape.

    Every Phase-1 ``module.yaml`` continues to load — the new
    Registry v1 fields default to empty / minimal blocks. Validated
    modules carry a non-empty ``benchmarks`` list.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    version: str = "0.1.0"
    domain: str
    status: str = "candidate"
    description: str = ""

    inputs: list[ModulePort] = Field(default_factory=list)
    outputs: list[ModulePort] = Field(default_factory=list)
    validity_domain: ModuleValidity | dict[str, Any] = Field(
        default_factory=ModuleValidity
    )
    references: list[ModuleReference] = Field(default_factory=list)
    tests: ModuleTests | dict[str, Any] = Field(default_factory=ModuleTests)

    # Registry v1 additions.
    dependencies: list[Dependency] = Field(default_factory=list)
    benchmarks: list[BenchmarkRef] = Field(default_factory=list)
    compatibility: ModuleCompatibility = Field(default_factory=ModuleCompatibility)

    @model_validator(mode="after")
    def _validated_modules_have_benchmarks(self) -> ModuleMetadata:
        if self.status == "validated" and not self.benchmarks:
            raise ValueError(
                f"Module {self.name!r} is validated but declares no "
                "benchmarks. Plan §Phase 7 / 7A requires every "
                "validated module to carry at least one benchmark "
                "reference (id + artifact + tolerance)."
            )
        return self


def load_module_yaml(path: str | Path) -> ModuleMetadata:
    """Parse a ``module.yaml`` file into a Pydantic ``ModuleMetadata``."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"module.yaml must parse to a mapping: {path}")
    return ModuleMetadata.model_validate(raw)


def write_module_yaml(metadata: ModuleMetadata, path: str | Path) -> None:
    Path(path).write_text(
        yaml.safe_dump(
            metadata.model_dump(mode="json", exclude_unset=False, by_alias=True),
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def metadata_paths(modules_root: Path) -> Iterable[Path]:
    """Yield every ``module.yaml`` under ``modules_root`` excluding templates."""
    for path in modules_root.rglob("module.yaml"):
        if "templates" in path.parts:
            continue
        yield path


__all__ = [
    "BenchmarkRef",
    "Dependency",
    "ModuleCompatibility",
    "ModuleMetadata",
    "ModulePort",
    "ModuleReference",
    "ModuleTests",
    "ModuleValidity",
    "load_module_yaml",
    "metadata_paths",
    "write_module_yaml",
]
