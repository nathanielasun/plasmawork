"""Phase 4A — Paper ingestion pipeline.

``PaperImporter.ingest(paper_path, capsule_dir)``:

  1. Copies the paper into ``<capsule>/paper_sources/`` (preserves the
     original file verbatim — plan §Phase 4 / 4A "Preserve source files").
  2. Runs the equation extractor → ``paper_sources/extracted_equations.json``.
  3. Runs the parameter extractor → ``paper_sources/extracted_parameters.yaml``.
  4. Runs the interpretation agent → four Markdown files under
     ``paper_sources/`` (paper_summary, assumptions, validity_domain,
     implementation_plan).
  5. Appends one entry to ``provenance/agent_trace.md`` via the canonical
     ``AgentTraceWriter`` (carries the post-Phase-2 lesson "Building
     writers without wiring producers" — the producer MUST invoke the
     writer, not hand-roll an equivalent).

The pipeline does NOT touch ``model/`` or ``results/``. Plan §Phase 4
hard rule: agents do not produce trusted simulations in this phase. The
gate-walk integration test asserts both directories stay untouched.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import yaml

from simworkbench.provenance import AgentTraceWriter

from .equations import EquationExtractor, RegexEquationExtractor
from .interpretation import (
    InterpretationAgent,
    TemplateInterpretationAgent,
)
from .paper import (
    ExtractedEquation,
    ExtractedParameter,
    IngestionArtifacts,
)
from .parameters import ParameterExtractor, RegexParameterExtractor


class PaperIngestionError(RuntimeError):
    """Raised when ingestion preconditions fail."""


class PaperImporter:
    """Orchestrator for Phase 4 paper ingestion."""

    def __init__(
        self,
        *,
        equation_extractor: EquationExtractor | None = None,
        parameter_extractor: ParameterExtractor | None = None,
        interpretation_agent: InterpretationAgent | None = None,
    ) -> None:
        self.equation_extractor = equation_extractor or RegexEquationExtractor()
        self.parameter_extractor = parameter_extractor or RegexParameterExtractor()
        self.interpretation_agent = (
            interpretation_agent or TemplateInterpretationAgent()
        )

    def ingest(
        self,
        paper_path: str | Path,
        capsule_dir: str | Path,
    ) -> IngestionArtifacts:
        """Copy the paper into the capsule and run every Phase 4 extractor."""
        source = Path(paper_path).resolve()
        if not source.is_file():
            raise PaperIngestionError(f"Paper file not found: {source}")
        capsule = Path(capsule_dir)
        if not capsule.is_dir():
            raise PaperIngestionError(
                f"Capsule directory not found: {capsule}. Pass an existing "
                "`.lxp/` directory."
            )

        paper_sources = capsule / "paper_sources"
        paper_sources.mkdir(parents=True, exist_ok=True)

        # 4A — copy the paper verbatim.
        target_paper = paper_sources / source.name
        shutil.copy2(source, target_paper)
        text = target_paper.read_text(encoding="utf-8", errors="replace")

        # 4B — equations.
        equations = self.equation_extractor.extract(
            text, source_file=f"paper_sources/{source.name}"
        )
        equations_path = paper_sources / "extracted_equations.json"
        equations_path.write_text(
            json.dumps(
                [eq.model_dump(mode="json") for eq in equations],
                indent=2,
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        # 4C — parameters.
        parameters = self.parameter_extractor.extract(
            text, source_file=f"paper_sources/{source.name}"
        )
        parameters_path = paper_sources / "extracted_parameters.yaml"
        parameters_path.write_text(
            yaml.safe_dump(
                [p.model_dump(mode="json") for p in parameters],
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        # 4D — interpretation artifacts.
        interpretation = self.interpretation_agent.interpret(
            paper_text=text,
            equations=equations,
            parameters=parameters,
            paper_filename=source.name,
        )
        interpretation_paths: dict[str, Path] = {}
        for filename, body in interpretation.filenames().items():
            target = paper_sources / filename
            target.write_text(body, encoding="utf-8")
            interpretation_paths[filename] = target

        # Provenance — one append-only entry recording the ingestion.
        # Carries post-Phase-2 lesson "Building writers without wiring
        # producers": we invoke AgentTraceWriter, NOT a hand-rolled append.
        provenance = capsule / "provenance"
        provenance.mkdir(parents=True, exist_ok=True)
        trace = AgentTraceWriter(provenance / "agent_trace.md")
        trace.append(
            agent="simworkbench.ingestion.PaperImporter",
            action="ingested paper",
            files_touched=(
                f"paper_sources/{source.name}",
                "paper_sources/extracted_equations.json",
                "paper_sources/extracted_parameters.yaml",
                "paper_sources/paper_summary.md",
                "paper_sources/assumptions.md",
                "paper_sources/validity_domain.md",
                "paper_sources/implementation_plan.md",
            ),
            notes=(
                f"equations={len(equations)} parameters={len(parameters)} "
                f"missing_units="
                f"{sum(1 for p in parameters if p.missing_units)}"
            ),
        )

        return IngestionArtifacts(
            capsule_dir=capsule,
            paper_path=target_paper,
            equations_path=equations_path,
            parameters_path=parameters_path,
            interpretation_paths=interpretation_paths,
        )

    # ------------------------------------------------------------------
    # Read + edit (used by the review UI / API).
    # ------------------------------------------------------------------

    def read_extracted(
        self, capsule_dir: str | Path
    ) -> dict[str, object]:
        """Return the structured extraction for the review UI."""
        capsule = Path(capsule_dir)
        paper_sources = capsule / "paper_sources"
        equations: list[dict] = []
        eqs_path = paper_sources / "extracted_equations.json"
        if eqs_path.is_file():
            equations = json.loads(eqs_path.read_text(encoding="utf-8"))
        parameters: list[dict] = []
        params_path = paper_sources / "extracted_parameters.yaml"
        if params_path.is_file():
            parameters = (
                yaml.safe_load(params_path.read_text(encoding="utf-8")) or []
            )
        interpretation = {}
        for slug, filename in (
            ("paper_summary", "paper_summary.md"),
            ("assumptions", "assumptions.md"),
            ("validity_domain", "validity_domain.md"),
            ("implementation_plan", "implementation_plan.md"),
        ):
            path = paper_sources / filename
            interpretation[slug] = (
                path.read_text(encoding="utf-8") if path.is_file() else ""
            )
        return {
            "equations": equations,
            "parameters": parameters,
            "interpretation": interpretation,
        }

    def apply_edit(
        self,
        capsule_dir: str | Path,
        *,
        artifact: str,
        index: int,
        field: str,
        value: object,
        reviewer: str,
    ) -> None:
        """Apply a human edit to one of the extracted artifacts.

        Persists the change AND appends one entry to agent_trace.md
        (carries the milestone's "Track edits in provenance" rule). The
        write goes through Pydantic round-trip so an invalid field name
        / value type fails before the file changes.
        """
        if artifact not in {"equations", "parameters", "interpretation"}:
            raise PaperIngestionError(
                f"Unknown artifact {artifact!r}. Allowed: "
                "equations | parameters | interpretation."
            )
        capsule = Path(capsule_dir)
        paper_sources = capsule / "paper_sources"

        if artifact == "equations":
            path = paper_sources / "extracted_equations.json"
            data = json.loads(path.read_text(encoding="utf-8"))
            self._apply_row_edit(
                data,
                index=index,
                field=field,
                value=value,
                reviewer=reviewer,
                model=ExtractedEquation,
            )
            path.write_text(
                json.dumps(data, indent=2, sort_keys=False), encoding="utf-8"
            )
        elif artifact == "parameters":
            path = paper_sources / "extracted_parameters.yaml"
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or []
            self._apply_row_edit(
                data,
                index=index,
                field=field,
                value=value,
                reviewer=reviewer,
                model=ExtractedParameter,
            )
            path.write_text(
                yaml.safe_dump(data, sort_keys=False), encoding="utf-8"
            )
        else:
            # interpretation: index 0..3 picks one of the four .md files;
            # field is "body" — this branch is rarely used but supported.
            slugs = (
                "paper_summary.md",
                "assumptions.md",
                "validity_domain.md",
                "implementation_plan.md",
            )
            if index < 0 or index >= len(slugs):
                raise PaperIngestionError(
                    f"interpretation index {index} out of range [0, {len(slugs)})"
                )
            if field != "body":
                raise PaperIngestionError(
                    "interpretation edits only support field='body'"
                )
            (paper_sources / slugs[index]).write_text(str(value), encoding="utf-8")

        # Provenance — append one row naming the edit.
        provenance = capsule / "provenance"
        provenance.mkdir(parents=True, exist_ok=True)
        trace = AgentTraceWriter(provenance / "agent_trace.md")
        trace.append(
            agent=f"reviewer:{reviewer}",
            action="edited extracted artifact",
            files_touched=(f"paper_sources/{self._artifact_filename(artifact)}",),
            notes=f"{artifact}[{index}].{field} updated",
        )

    @staticmethod
    def _artifact_filename(artifact: str) -> str:
        return {
            "equations": "extracted_equations.json",
            "parameters": "extracted_parameters.yaml",
            "interpretation": "*.md",
        }[artifact]

    @staticmethod
    def _apply_row_edit(
        rows: list[dict],
        *,
        index: int,
        field: str,
        value: object,
        reviewer: str,
        model: type,
    ) -> None:
        if index < 0 or index >= len(rows):
            raise PaperIngestionError(
                f"Row index {index} out of range [0, {len(rows)})"
            )
        row = dict(rows[index])
        if field not in row:
            # The field must already exist in the model's schema; we accept
            # the edit only when it would round-trip through the Pydantic
            # validator. This catches typos that would otherwise silently
            # drop into the YAML.
            allowed = set(model.model_fields)
            if field not in allowed:
                raise PaperIngestionError(
                    f"Unknown field {field!r} for {model.__name__}; "
                    f"allowed: {sorted(allowed)}."
                )
        row[field] = value
        row["edited_by"] = reviewer
        # Validate to catch schema violations BEFORE writing to disk.
        model.model_validate(row)
        rows[index] = row


__all__ = ["PaperImporter", "PaperIngestionError"]
