"""Bounded preview runner for draft internal tools.

This module is launched as a subprocess by ``ToolAuthoringService``. It
executes a saved draft package through fixed harness fixtures and writes a
JSON result for the UI. It is not a shell, notebook, or arbitrary snippet
runner; paths and harness names are server-derived by the caller.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import sys
from collections.abc import Mapping, Sequence
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

from simworkbench.paths import local_cache_root
from simworkbench.tools.artifacts import json_safe_value
from simworkbench.tools.base_tool import BaseTool
from simworkbench.tools.io import ToolOutput
from simworkbench.tools.metadata import ToolMetadata, ToolPort, load_tool_yaml
from simworkbench.units import Q


class PreviewRunnerError(RuntimeError):
    """Raised when a preview cannot be executed safely."""


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point for subprocess preview execution."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("draft_root")
    parser.add_argument("harness")
    parser.add_argument("result_path")
    args = parser.parse_args(argv)

    try:
        payload = run_preview(
            draft_root=Path(args.draft_root),
            harness=args.harness,
            result_path=Path(args.result_path),
        )
        Path(args.result_path).write_text(
            json.dumps(payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        return 0 if payload["passed"] else 1
    except Exception as exc:  # noqa: BLE001 - returned to API as preview stderr.
        error_payload = {
            "passed": False,
            "outputs": [],
            "artifacts": [],
            "diagnostics": [str(exc)],
        }
        Path(args.result_path).parent.mkdir(parents=True, exist_ok=True)
        Path(args.result_path).write_text(
            json.dumps(error_payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        print(f"Preview failed: {exc}", file=sys.stderr)
        return 1


def run_preview(*, draft_root: Path, harness: str, result_path: Path) -> dict[str, Any]:
    """Run one preview harness and return UI-renderable output rows."""
    root = draft_root.resolve()
    try:
        root.relative_to(local_cache_root().resolve())
    except ValueError as exc:
        raise PreviewRunnerError("Draft root must be inside local_cache.") from exc
    if not root.is_dir():
        raise PreviewRunnerError("Draft root is not a directory.")

    metadata = load_tool_yaml(root / "tool.yaml")
    tool = _load_tool(root, metadata)
    kwargs = _fixture_inputs(metadata.inputs, harness)
    result = tool.execute(**kwargs)
    if not isinstance(result, ToolOutput):
        raise PreviewRunnerError("Tool returned a non-ToolOutput value.")

    outputs = _preview_outputs(metadata, result.to_dict())
    diagnostics = _diagnostics(metadata, result.to_dict(), harness)
    return {
        "passed": True,
        "outputs": outputs,
        "artifacts": [],
        "diagnostics": diagnostics,
        "result_path": str(result_path),
    }


def _load_tool(root: Path, metadata: ToolMetadata) -> BaseTool:
    module_path_raw, class_name = metadata.entrypoint.split(":", 1)
    module_path = (root / module_path_raw).resolve()
    try:
        module_path.relative_to(root)
    except ValueError as exc:
        raise PreviewRunnerError("Tool entrypoint escapes draft root.") from exc
    if not module_path.is_file() or module_path.is_symlink():
        raise PreviewRunnerError("Tool entrypoint is missing or symlinked.")

    spec = importlib.util.spec_from_file_location(
        f"simworkbench_preview_{root.name}",
        module_path,
    )
    if spec is None or spec.loader is None:
        raise PreviewRunnerError("Could not load draft tool module.")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(root))
    try:
        spec.loader.exec_module(module)
    finally:
        try:
            sys.path.remove(str(root))
        except ValueError:
            pass
    tool_cls = getattr(module, class_name, None)
    if not isinstance(tool_cls, type) or not issubclass(tool_cls, BaseTool):
        raise PreviewRunnerError(f"Entrypoint class {class_name!r} is not a BaseTool.")
    return tool_cls()


def _fixture_inputs(ports: Sequence[ToolPort], harness: str) -> dict[str, Any]:
    n = 80 if harness in {"ode_solver", "visualization"} else 32
    t = np.linspace(0.0, 1.0, n)
    fixtures: dict[str, Any] = {}
    for port in ports:
        kind = port.type
        name = port.name.lower()
        if kind == "array":
            values = _array_values(name, t, harness)
            fixtures[port.name] = Q(values, port.units or "dimensionless")
        elif kind == "scalar":
            fixtures[port.name] = Q(1.0, port.units) if port.units else 1.0
        elif kind == "bool":
            fixtures[port.name] = True
        elif kind == "string":
            fixtures[port.name] = "preview"
        elif kind in {"table", "json"}:
            fixtures[port.name] = [{"x": float(x), "y": float(np.exp(-x))} for x in t[:5]]
        else:
            fixtures[port.name] = Q(t, port.units or "dimensionless") if port.units else t.tolist()
    return fixtures


def _array_values(name: str, t: np.ndarray, harness: str) -> np.ndarray:
    if "time" in name:
        return t
    if "frequency" in name:
        return np.linspace(1.0, 10.0, t.size)
    if harness == "ode_solver" or "ode" in name:
        return np.exp(-2.0 * t)
    if "field" in name:
        return np.sin(2.0 * np.pi * t) * np.exp(-0.3 * t)
    if "intensity" in name or "signal" in name:
        return 0.5 + 0.5 * np.sin(2.0 * np.pi * t)
    return np.linspace(0.0, 1.0, t.size)


def _preview_outputs(metadata: ToolMetadata, values: Mapping[str, Any]) -> list[dict[str, Any]]:
    declared = {output.name: output for output in metadata.outputs}
    rows: list[dict[str, Any]] = []
    for name, value in values.items():
        port = declared.get(name)
        rows.append(_preview_output(name, value, port))
    return rows


def _preview_output(name: str, value: Any, port: ToolPort | None) -> dict[str, Any]:
    kind = _output_kind(name, value, port)
    return {
        "name": name,
        "kind": kind,
        "units": port.units if port else None,
        "value": _preview_value(kind, value),
    }


def _output_kind(name: str, value: Any, port: ToolPort | None) -> str:
    kind = "json"
    if hasattr(value, "savefig"):
        kind = "image"
    elif port is not None and port.type == "figure":
        kind = "image"
    elif port is not None and port.type in {"array", "timeseries"}:
        kind = "timeseries"
    elif port is not None and port.type in {
        "scalar",
        "table",
        "diagram",
        "image",
        "report",
        "json",
    }:
        kind = port.type
    elif isinstance(value, dict) and {"nodes", "edges"}.issubset(value):
        kind = "diagram"
    elif isinstance(value, list):
        kind = "table"
    elif "diagram" in name.lower() or "graph" in name.lower():
        kind = "diagram"
    return kind


def _preview_value(kind: str, value: Any) -> Any:
    if kind == "image" and hasattr(value, "savefig"):
        return _figure_data_url(value)
    return json_safe_value(value)


def _figure_data_url(figure: Any) -> str:
    buffer = BytesIO()
    figure.savefig(buffer, format="png", dpi=110, bbox_inches="tight")
    try:
        import matplotlib.pyplot as plt

        plt.close(figure)
    except Exception:  # pragma: no cover - cleanup best effort.
        pass
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _diagnostics(
    metadata: ToolMetadata,
    values: Mapping[str, Any],
    harness: str,
) -> list[str]:
    diagnostics: list[str] = [f"Harness {harness} executed {metadata.entrypoint}."]
    missing = [output.name for output in metadata.outputs if output.name not in values]
    if missing:
        diagnostics.append(f"Declared output(s) missing from ToolOutput: {missing!r}.")
    extra = [name for name in values if name not in {output.name for output in metadata.outputs}]
    if extra:
        diagnostics.append(f"Undeclared preview output(s): {extra!r}.")
    return diagnostics


if __name__ == "__main__":
    raise SystemExit(main())
