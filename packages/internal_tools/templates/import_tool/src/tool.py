"""Import tool template.

Imports an external file (CSV, HDF5, cross-section table, ...) and emits
a structured payload. Per plan §9.7 imports must NOT scatter files —
the import should copy assets into ``local_cache/imported_tools/`` or
the local registry, never to arbitrary user paths.
"""

from __future__ import annotations

from pathlib import Path

from simworkbench.tools import BaseTool, ToolInput, ToolIOError, ToolOutput


class ImportTemplate(BaseTool):
    name = "TEMPLATE"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        path_str = inputs.require("source_path")
        if not isinstance(path_str, (str, Path)):
            raise ToolIOError("source_path must be a string or Path")
        if not Path(path_str).exists():
            raise ToolIOError(f"source_path does not exist: {path_str}")

    def run(self, inputs: ToolInput) -> ToolOutput:
        path = Path(inputs["source_path"])
        # Replace this stub with your real parser. The default reads UTF-8
        # text and returns one record per non-empty line.
        records = [
            {"line_no": i, "text": line}
            for i, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), start=1
            )
            if line.strip()
        ]
        return ToolOutput({"payload": records})


__all__ = ["ImportTemplate"]
