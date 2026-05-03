"""Phase 2A — Capsule manifest schema (`manifest.toml`).

Pydantic models for the canonical `manifest.toml` shape per plan §7.2 and
ADR-0002. The Phase 1 minimal capsule wrote a hand-rolled subset of this
schema; Phase 2A finalizes the structure and adds the full reader/writer.

The on-disk format is TOML. The schema is versioned (``schema_version``);
breaking changes increment major and require a migration in
``simworkbench.serialization.migrations``.
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

CAPSULE_FORMAT_VERSION = "0.1"


class CapsuleSection(BaseModel):
    """`[capsule]` block."""

    model_config = ConfigDict(extra="forbid")

    name: str
    format_version: str = CAPSULE_FORMAT_VERSION
    workbench_version: str
    created_at: str  # ISO-8601 UTC

    @model_validator(mode="after")
    def _check_format_version(self) -> CapsuleSection:
        if not self.format_version:
            raise ValueError("[capsule].format_version is required.")
        return self


class PaperSection(BaseModel):
    """`[paper]` block — paper provenance for paper-derived capsules. Optional."""

    model_config = ConfigDict(extra="forbid")

    title: str = ""
    doi: str = ""
    source_path: str = ""


class ModelSection(BaseModel):
    """`[model]` block — minimal pointer to the ModelSpec."""

    model_config = ConfigDict(extra="forbid")

    name: str
    domain: str
    schema_version: str
    model_spec_path: str = "model/model_spec.yaml"
    validity_domain_path: str = "model/validity_domain.md"


class RuntimeSection(BaseModel):
    """`[runtime]` block — captures the run that produced this capsule."""

    model_config = ConfigDict(extra="forbid")

    backend: str
    default_seed: int
    final_state: str
    final_simulation_time_seconds: float
    elapsed_seconds: float
    placeholder_used: bool = False
    placeholders: list[str] = Field(default_factory=list)
    supports_pause_resume: bool = True
    supports_checkpointing: bool = True


class ProvenanceSection(BaseModel):
    """`[provenance]` block — pointer to the lock + agent trace."""

    model_config = ConfigDict(extra="forbid")

    lockfile: str = "provenance/provenance.lock"
    agent_trace: str = "provenance/agent_trace.md"
    environment: str = "provenance/environment.yaml"
    parent_capsule_hash: str = ""  # set on forks


class Manifest(BaseModel):
    """Top-level `manifest.toml` model.

    Sections per plan §7.2:

    - ``[capsule]``  — name, format_version, workbench_version, created_at
    - ``[paper]``    — paper provenance (optional, populated when applicable)
    - ``[model]``    — ModelSpec pointer
    - ``[runtime]``  — backend + run metadata
    - ``[provenance]`` — provenance.lock + agent_trace pointers
    """

    model_config = ConfigDict(extra="forbid")

    capsule: CapsuleSection
    paper: PaperSection = Field(default_factory=PaperSection)
    model: ModelSection
    runtime: RuntimeSection
    provenance: ProvenanceSection = Field(default_factory=ProvenanceSection)

    @model_validator(mode="after")
    def _check_format_version_supported(self) -> Manifest:
        if self.capsule.format_version != CAPSULE_FORMAT_VERSION:
            raise ValueError(
                f"Capsule manifest format_version {self.capsule.format_version!r} is not "
                f"supported by this build (expects {CAPSULE_FORMAT_VERSION!r}). "
                "Add a migration in simworkbench.serialization.migrations."
            )
        return self


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def load_manifest(path: str | Path) -> Manifest:
    """Read a `manifest.toml` file and return a validated ``Manifest``."""
    with Path(path).open("rb") as fh:
        data = tomllib.load(fh)
    return Manifest.model_validate(data)


def write_manifest(manifest: Manifest, path: str | Path) -> None:
    """Write a ``Manifest`` to disk as TOML.

    Avoids adding a runtime dep on ``tomli_w`` for this small flat-ish
    schema. The hand-rolled writer below is sufficient because every section
    is one level deep with primitive scalar / list values. Phase 8+ may swap
    to tomli_w if the schema grows beyond what this writer handles.
    """
    Path(path).write_text(_render_toml(manifest), encoding="utf-8")


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _render_toml(manifest: Manifest) -> str:
    data = manifest.model_dump(mode="python")
    lines: list[str] = []
    for section_name, section_body in data.items():
        if not isinstance(section_body, dict):
            raise TypeError(
                f"Top-level manifest entry {section_name!r} is not a section."
            )
        if lines:
            lines.append("")
        lines.append(f"[{section_name}]")
        for key, value in section_body.items():
            lines.append(f"{key} = {_toml_value(value)}")
    return "\n".join(lines) + "\n"


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    raise TypeError(
        f"Unsupported TOML value type for capsule manifest: {type(value).__name__}"
    )


__all__ = [
    "CAPSULE_FORMAT_VERSION",
    "CapsuleSection",
    "Manifest",
    "ModelSection",
    "PaperSection",
    "ProvenanceSection",
    "RuntimeSection",
    "load_manifest",
    "write_manifest",
]
