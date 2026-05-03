"""Paper-extraction tool template.

Extracts text, equations, and parameters from a paper file. Phase 3
provides only the template; the actual extraction stack lands in Phase 4
(Agent-Assisted Paper Ingestion). The default ``run`` is a stub that
returns the file's text and empty equations / parameters tables — replace
with your real extractor.

Per AGENTS.md / plan §22: extracted parameters MUST carry units. Don't
fabricate units when the paper omits them — flag the row with a
``placeholder:`` entry in ``coefficient_sources`` so the runtime can
later refuse the unsourced rate.
"""

from __future__ import annotations

from pathlib import Path

from simworkbench.tools import BaseTool, ToolInput, ToolIOError, ToolOutput


class PaperExtractionTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        path = inputs.require("source_path")
        if not isinstance(path, (str, Path)):
            raise ToolIOError("source_path must be a string or Path")
        if not Path(path).is_file():
            raise ToolIOError(f"source_path does not exist: {path}")

    def run(self, inputs: ToolInput) -> ToolOutput:
        path = Path(inputs["source_path"])
        text = path.read_text(encoding="utf-8", errors="replace")
        return ToolOutput(
            {
                "extracted_text": text,
                "extracted_equations": [],
                "extracted_parameters": [],
            }
        )


__all__ = ["PaperExtractionTemplate"]
