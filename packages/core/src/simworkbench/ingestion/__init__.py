"""Phase 4 — Agent-Assisted Paper Ingestion.

Public API for the paper-ingestion pipeline. Consumers do::

    from simworkbench.ingestion import PaperImporter
    importer = PaperImporter()
    importer.ingest("path/to/paper.md", "simulation_capsules/foo.lxp")

Per plan §Phase 4 hard rule, the pipeline produces interpretation
artifacts only — no trusted simulation outputs land in this phase. The
`paper_summary.md` / `assumptions.md` / `validity_domain.md` /
`implementation_plan.md` files are explicitly marked "needs human review".
"""

from __future__ import annotations

from .equations import EquationExtractor, RegexEquationExtractor
from .interpretation import (
    InterpretationAgent,
    InterpretationOutput,
    TemplateInterpretationAgent,
)
from .paper import (
    EditableArtifact,
    ExtractedEquation,
    ExtractedParameter,
    IngestionArtifacts,
    SourceRef,
)
from .parameters import ParameterExtractor, RegexParameterExtractor
from .pipeline import PaperImporter, PaperIngestionError

__all__ = [
    "EditableArtifact",
    "EquationExtractor",
    "ExtractedEquation",
    "ExtractedParameter",
    "IngestionArtifacts",
    "InterpretationAgent",
    "InterpretationOutput",
    "PaperImporter",
    "PaperIngestionError",
    "ParameterExtractor",
    "RegexEquationExtractor",
    "RegexParameterExtractor",
    "SourceRef",
    "TemplateInterpretationAgent",
]
