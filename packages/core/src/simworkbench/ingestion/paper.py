"""Phase 4 — Pydantic models for ingested paper artifacts.

Every extracted artifact carries:
  - a confidence flag (0..1; 1.0 only for human-confirmed entries),
  - a source pointer (file + line) so the review UI can jump to the
    original paragraph,
  - a human-edit field (set when a reviewer corrects the agent's output;
    appended to provenance).

These are the contracts the JSON / YAML files on disk must round-trip
through (cf. the post-Phase-2-close pattern *Schema drift between
writers and validators*).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceRef(BaseModel):
    """Pointer back into the imported paper text."""

    model_config = ConfigDict(extra="forbid")

    file: str  # capsule-relative, e.g. "paper_sources/sample.md"
    line: int  # 1-based line number


class ExtractedEquation(BaseModel):
    """One row of ``extracted_equations.json``."""

    model_config = ConfigDict(extra="forbid")

    id: str  # stable id like "eq_001"
    text: str  # the equation as the extractor saw it
    latex: str = ""  # parsed LaTeX body (best-effort)
    source_line: int  # 1-based line in the source file
    source_file: str = ""
    confidence: float = 0.5
    edited_by: str = ""  # reviewer name once a human edits the row
    notes: str = ""


class ExtractedParameter(BaseModel):
    """One row of ``extracted_parameters.yaml``."""

    model_config = ConfigDict(extra="forbid")

    name: str
    value: float | str
    unit: str = ""
    missing_units: bool = False
    source_line: int = 0
    source_file: str = ""
    confidence: float = 0.5
    edited_by: str = ""
    notes: str = ""


class IngestionArtifacts(BaseModel):
    """Return value of ``PaperImporter.ingest`` — paths to every artifact
    written under ``<capsule>/paper_sources/``.

    Pydantic with ``arbitrary_types_allowed=True`` so the Path objects
    survive validation.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    capsule_dir: Any  # Path
    paper_path: Any  # Path
    extracted_text_path: Any = None  # Path — Phase 4A task 3
    tables_path: Any = None  # Path — Phase 4A task 4
    figures_path: Any = None  # Path — Phase 4A task 5
    equations_path: Any  # Path
    parameters_path: Any  # Path
    interpretation_paths: dict[str, Any] = Field(default_factory=dict)


# Allowed editable artifacts at the review API; refuse anything else with 400.
EditableArtifact = Literal["equations", "parameters", "interpretation"]


__all__ = [
    "EditableArtifact",
    "ExtractedEquation",
    "ExtractedParameter",
    "IngestionArtifacts",
    "SourceRef",
]
