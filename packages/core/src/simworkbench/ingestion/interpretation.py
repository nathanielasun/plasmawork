"""Phase 4D — Scientific interpretation agent (default = template-based).

Plan §Phase 4 hard rule: agents do not produce trusted simulations in
this phase. Only interpretation artifacts. Every output marks sections
as needing human review so a downstream reviewer (and the Phase 5
ModelSpec generation) treats the content as draft, not as source of
truth.

The default ``TemplateInterpretationAgent`` is deterministic: it
produces four Markdown files (paper_summary, assumptions,
validity_domain, implementation_plan) with placeholders pre-filled from
the extracted equations + parameters. A future LLM-backed agent can
replace it without changing the pipeline shape; the abstract base class
fixes the contract.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from .paper import ExtractedEquation, ExtractedParameter


@dataclass(frozen=True)
class InterpretationOutput:
    """The four Markdown documents the agent emits."""

    paper_summary: str
    assumptions: str
    validity_domain: str
    implementation_plan: str

    def filenames(self) -> dict[str, str]:
        return {
            "paper_summary.md": self.paper_summary,
            "assumptions.md": self.assumptions,
            "validity_domain.md": self.validity_domain,
            "implementation_plan.md": self.implementation_plan,
        }


_HUMAN_REVIEW_BANNER = (
    "> **Status: Draft — needs human review.** This artifact was produced "
    "by an automated interpretation agent. Plan §Phase 4 forbids treating "
    "agent-generated interpretation as trusted; a human reviewer must "
    "edit / approve every section before it feeds Phase 5 ModelSpec "
    "generation. Edits made through the workbench's review UI are tracked "
    "in `provenance/agent_trace.md`.\n"
)


class InterpretationAgent(ABC):
    @abstractmethod
    def interpret(
        self,
        *,
        paper_text: str,
        equations: list[ExtractedEquation],
        parameters: list[ExtractedParameter],
        paper_filename: str = "",
    ) -> InterpretationOutput:
        """Produce the four interpretation artifacts."""


class TemplateInterpretationAgent(InterpretationAgent):
    """Default agent — produces template Markdown with placeholders pre-
    filled from the extractor outputs. No LLM dependency.
    """

    def interpret(
        self,
        *,
        paper_text: str,
        equations: list[ExtractedEquation],
        parameters: list[ExtractedParameter],
        paper_filename: str = "",
    ) -> InterpretationOutput:
        # Take the first non-empty line as a candidate title (typically a
        # Markdown `# Heading`). Strip leading `#` characters.
        title = next(
            (
                ln.lstrip("# ").strip()
                for ln in paper_text.splitlines()
                if ln.strip()
            ),
            paper_filename or "Untitled paper",
        )

        # paper_summary.md — top-line description + counts.
        n_eq = len(equations)
        n_params = len(parameters)
        n_missing = sum(1 for p in parameters if p.missing_units)
        paper_summary = (
            f"# Paper summary — {title}\n\n"
            f"{_HUMAN_REVIEW_BANNER}\n"
            f"## Source\n\n"
            f"`paper_sources/{paper_filename}` was ingested by the workbench's "
            f"automated extractors. The agent counted "
            f"**{n_eq} equation(s)** and **{n_params} parameter(s)** "
            f"({n_missing} flagged as missing units).\n\n"
            f"## Notes for the reviewer\n\n"
            f"- Confirm or correct each extracted equation in the review UI.\n"
            f"- Fill in or correct units for every flagged parameter.\n"
            f"- Edits are appended to `provenance/agent_trace.md`.\n"
        )

        # assumptions.md — restate the parameters with units, flag the
        # ones where the extractor couldn't find units.
        assumptions_lines = [
            f"# Assumptions — {title}",
            "",
            _HUMAN_REVIEW_BANNER,
            "## Extracted parameters",
            "",
        ]
        for p in parameters:
            unit_str = p.unit if p.unit else "**MISSING — needs human review**"
            assumptions_lines.append(
                f"- `{p.name}` = {p.value} {unit_str}"
            )
        if not parameters:
            assumptions_lines.append("_No parameters extracted._")
        assumptions = "\n".join(assumptions_lines) + "\n"

        # validity_domain.md — pull text near the heading "validity" if
        # present, otherwise leave a marker.
        validity_section = _extract_section(paper_text, "validity")
        validity_domain = (
            f"# Validity domain — {title}\n\n"
            f"{_HUMAN_REVIEW_BANNER}\n"
        )
        if validity_section:
            validity_domain += (
                "## Extracted validity statement\n\n"
                f"{validity_section}\n\n"
                "_Reviewer: confirm bounds and write any missing limits._\n"
            )
        else:
            validity_domain += (
                "_The extractor did not find a 'Validity' section in the paper. "
                "Reviewer: write the model's regime of validity here._\n"
            )

        # implementation_plan.md — outline mapping equations → ModelSpec
        # equations / interactions.
        impl_lines = [
            f"# Implementation plan — {title}",
            "",
            _HUMAN_REVIEW_BANNER,
            "## Equations to implement",
            "",
        ]
        for eq in equations:
            impl_lines.append(
                f"- **{eq.id}** (line {eq.source_line}, confidence "
                f"{eq.confidence:.2f}): `{eq.text}`"
            )
        if not equations:
            impl_lines.append("_No equations extracted._")
        impl_lines.extend(
            [
                "",
                "## Suggested ModelSpec mapping",
                "",
                "_Reviewer: map each equation above to a `simworkbench.model_spec` "
                "equation entry; this template does not pre-fill the mapping "
                "because the agent cannot infer model structure without an LLM._",
            ]
        )
        implementation_plan = "\n".join(impl_lines) + "\n"

        return InterpretationOutput(
            paper_summary=paper_summary,
            assumptions=assumptions,
            validity_domain=validity_domain,
            implementation_plan=implementation_plan,
        )


def _extract_section(text: str, heading_keyword: str) -> str:
    """Return the body of the first Markdown section whose heading
    contains ``heading_keyword`` (case-insensitive). Empty if not found.
    """
    lines = text.splitlines()
    body: list[str] = []
    inside = False
    for line in lines:
        if line.startswith("#"):
            if inside:
                break
            heading = line.lstrip("#").strip().lower()
            if heading_keyword.lower() in heading:
                inside = True
                continue
        elif inside:
            body.append(line)
    return "\n".join(body).strip()


__all__ = [
    "InterpretationAgent",
    "InterpretationOutput",
    "TemplateInterpretationAgent",
]
