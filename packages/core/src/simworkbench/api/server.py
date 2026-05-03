"""Workbench backend HTTP API — Phase 1F.

A small FastAPI app that exposes the experiment / runtime / diagnostics
surface the workbench UI consumes. The API is HTTP/JSON and intentionally
minimal: list runs, start a run from a YAML model spec, query state, fetch
final diagnostics.

Per AGENTS.md "Repository Architecture Rules → Packaging boundary": the
TypeScript UI never imports Python directly. It talks to this server.

Endpoints:

- ``GET  /api/health``                 — server liveness probe.
- ``GET  /api/runs``                   — list runs the server has seen.
- ``POST /api/runs``                   — start a new run from a YAML path.
- ``GET  /api/runs/{run_id}``          — get a run's state + diagnostics.
- ``POST /api/runs/{run_id}/stop``     — stop a run (best-effort).
- ``GET  /api/docs/pages``             — list available docs pages.
- ``GET  /api/capsules``               — list directories under simulation_capsules/.
- ``GET  /api/capsules/{name}``        — manifest + structural summary (Phase 2D).
- ``GET  /api/capsules/{name}/files/{path}``   — read a text file under the capsule (Phase 2D).
- ``GET  /api/capsules/{name}/validate``       — run CapsuleValidator (Phase 2D).
- ``GET  /api/capsules/{name}/diagnostics``    — diagnostics series for the
  capsule's ``results/`` directory (Phase 2D).
- ``GET  /api/tools``                          — registry index (Phase 3D).
- ``GET  /api/tools/{name}``                   — full tool metadata (Phase 3D).
- ``GET  /api/tools/{name}/docs``              — README + tool.yaml text (Phase 3D).
- ``POST /api/tools/{name}/status``            — lifecycle promotion (Phase 3D).
- ``POST /api/tools/{name}/run-tests``         — pytest the tool (Phase 3D).
- ``POST /api/tools/{name}/execute``           — invoke the tool with kwargs (Phase 3D).
- ``POST /api/tools/{name}/export``            — zip the tool tree (Phase 3D).
- ``POST /api/tools/import``                   — copy a tool tree into
  ``local_cache/imported_tools/`` (Phase 3D).
- ``POST /api/papers/import``                       — ingest a paper into a capsule (Phase 4).
- ``GET  /api/papers/{capsule}/extracted``          — read the structured extraction (Phase 4).
- ``POST /api/papers/{capsule}/edit``               — edit an extracted artifact +
  record provenance (Phase 4).

Phase 1F runs are synchronous: the server starts the run on the request
thread and returns the final state. Async / pause-resume across HTTP is a
Phase 1F+ enhancement; the in-process Runner already supports it (see
``simworkbench.runtime.Runner``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

try:
    from fastapi import FastAPI, HTTPException
except ImportError as exc:  # pragma: no cover — fastapi is a hard dep.
    raise RuntimeError(
        "FastAPI is required for the workbench API server. "
        "Install via `pip install -e packages/core` or add fastapi explicitly."
    ) from exc

from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml as load_modelspec_yaml
from simworkbench.paths import (
    repo_root,
    simulation_capsules_root,
    temp_runs_root,
)
from simworkbench.runtime import Runner
from simworkbench.serialization import CapsuleValidator, load_manifest
from simworkbench.tools import LifecycleError, ToolRegistry, ToolStatus

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class StartRunRequest(BaseModel):
    """POST /api/runs body."""

    model_yaml_path: str = Field(
        description=(
            "Repo-relative path to a ModelSpec YAML, e.g. "
            "'examples/simple_rate_equations/model.yaml'."
        )
    )
    end_time: str = "100 ns"
    max_steps: int = 100
    seed: int = 0


class RunSummary(BaseModel):
    run_id: str
    state: str
    elapsed_seconds: float
    final_simulation_time: float
    diagnostics_keys: list[str]
    placeholder_used: bool = False
    placeholders: list[str] = []


class HealthResponse(BaseModel):
    ok: bool = True
    version: str


class ToolStatusBody(BaseModel):
    """POST /api/tools/{name}/status body."""

    status: str
    actor: str = "agent"


class ToolExecuteBody(BaseModel):
    """POST /api/tools/{name}/execute body."""

    kwargs: dict[str, Any] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)


class ToolImportBody(BaseModel):
    """POST /api/tools/import body."""

    source_path: str
    target_name: str


class PaperImportBody(BaseModel):
    """POST /api/papers/import body."""

    capsule: str  # capsule directory name (`<name>.lxp`) under simulation_capsules/
    source_path: str  # absolute path to the paper file


class PaperEditBody(BaseModel):
    """POST /api/papers/{capsule}/edit body."""

    artifact: str  # equations | parameters | interpretation
    index: int
    field: str
    value: Any
    reviewer: str


# ---------------------------------------------------------------------------
# App factory — per-app run registry lives in the closure, NOT module-global.
# Honors agent_error_patterns.md "API factory advertises isolation while
# sharing module-global state".
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Build a fresh FastAPI app with its own in-memory run registry.

    Tests use this so each test starts with a clean state. The registry
    lives in the closure, NOT at module scope — see
    `agent_error_patterns.md` "API factory advertises isolation while
    sharing module-global state".
    """
    from simworkbench import __version__

    runs: dict[str, dict[str, Any]] = {}

    def _summary(rid: str, info: dict[str, Any]) -> RunSummary:
        placeholders = list(info.get("placeholders", []))
        return RunSummary(
            run_id=rid,
            state=info["state"],
            elapsed_seconds=info["elapsed_seconds"],
            final_simulation_time=info["final_simulation_time"],
            diagnostics_keys=list(info["diagnostics"].keys()),
            placeholders=placeholders,
            placeholder_used=bool(placeholders),
        )

    app = FastAPI(
        title="Scientific Simulation Workbench API",
        version=__version__,
        description="Phase 1F backend for the local workbench UI.",
    )

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(ok=True, version=__version__)

    @app.get("/api/runs", response_model=list[RunSummary])
    def list_runs() -> list[RunSummary]:
        return [_summary(rid, info) for rid, info in runs.items()]

    @app.get("/api/runs/{run_id}", response_model=RunSummary)
    def get_run(run_id: str) -> RunSummary:
        if run_id not in runs:
            raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
        return _summary(run_id, runs[run_id])

    @app.post("/api/runs", response_model=RunSummary)
    def start_run(req: StartRunRequest) -> RunSummary:
        spec_path = (repo_root() / req.model_yaml_path).resolve()
        if not spec_path.is_file():
            raise HTTPException(
                status_code=400,
                detail=f"Model spec not found at {req.model_yaml_path!r}",
            )
        # Refuse to read outside the repo (defense in depth).
        try:
            spec_path.relative_to(repo_root())
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Refusing to load model spec outside the repository: "
                    f"{req.model_yaml_path!r}"
                ),
            ) from exc

        spec = load_modelspec_yaml(spec_path)
        experiment = Experiment.from_model_spec(
            spec,
            run_config=RunConfig(
                start_time="0 s",
                end_time=req.end_time,
                max_steps=req.max_steps,
                seed=req.seed,
            ),
        )
        runner = Runner(experiment, base_seed=req.seed)
        try:
            result = runner.run()
        except ValueError as exc:
            # Backend refusals (e.g. unsourced rates per plan §22) become
            # 422s so the UI can surface the message verbatim.
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        runs[runner.run_id] = {
            "state": result.state.value,
            "elapsed_seconds": result.elapsed_seconds,
            "final_simulation_time": result.final_simulation_time,
            "diagnostics": {k: list(v) for k, v in result.diagnostics.items()},
            "placeholders": list(result.placeholders),
        }
        return _summary(runner.run_id, runs[runner.run_id])

    @app.get("/api/runs/{run_id}/diagnostics/{name}")
    def get_diagnostic(run_id: str, name: str) -> dict[str, Any]:
        if run_id not in runs:
            raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
        diagnostics = runs[run_id]["diagnostics"]
        if name not in diagnostics:
            raise HTTPException(
                status_code=404,
                detail=f"Diagnostic {name!r} not present on run {run_id!r}",
            )
        times = diagnostics.get("time_seconds", [])
        return {"run_id": run_id, "name": name, "times": times, "values": diagnostics[name]}

    @app.get("/api/docs/pages")
    def list_docs_pages() -> list[dict[str, str]]:
        """Enumerate ``docs_site/src/content/*.tsx`` for the in-app DocsViewer."""
        content_dir = repo_root() / "docs_site" / "src" / "content"
        if not content_dir.is_dir():
            return []
        return [
            {
                "slug": p.stem,
                "title": p.stem.replace("_", " ").title(),
                "path": str(p.relative_to(repo_root())),
            }
            for p in sorted(content_dir.glob("*.tsx"))
        ]

    @app.get("/api/capsules")
    def list_capsules() -> list[dict[str, str]]:
        """List ``.lxp`` directories under ``simulation_capsules/`` (Phase 1F skeleton)."""
        root = simulation_capsules_root()
        return [
            {"name": p.name, "path": str(p.relative_to(repo_root()))}
            for p in sorted(root.iterdir())
            if p.is_dir() and p.suffix == ".lxp"
        ]

    @app.get("/api/temp_runs")
    def list_temp_runs() -> list[dict[str, str]]:
        """List directories under ``temp_runs/`` (in-flight runs)."""
        root = temp_runs_root()
        return [
            {"name": p.name, "path": str(p.relative_to(repo_root()))}
            for p in sorted(root.iterdir())
            if p.is_dir() and p.name != ".gitkeep"
        ]

    # -----------------------------------------------------------------------
    # Phase 2D — capsule inspection endpoints. The UI's CapsuleExplorer reads
    # these to render manifest, ModelSpec, code, results, validation, and
    # provenance views without learning the on-disk layout itself.
    # -----------------------------------------------------------------------

    def _resolve_capsule(name: str) -> Path:
        """Look up a capsule by directory name, refusing path-escape inputs.

        Honors agent_error_patterns.md "Side-effecting before validating": we
        validate the resolved path is inside ``simulation_capsules/`` BEFORE
        any read. ``..`` segments would otherwise let a caller escape the
        sandbox.
        """
        root = simulation_capsules_root().resolve()
        target = (root / name).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid capsule name") from exc
        if not target.is_dir():
            raise HTTPException(status_code=404, detail=f"Capsule {name!r} not found")
        return target

    @app.get("/api/capsules/{name}")
    def get_capsule(name: str) -> dict[str, Any]:
        """Manifest + structural summary for a single capsule.

        The UI's ManifestView consumes this. We return raw JSON-friendly dicts
        so the frontend doesn't need to parse TOML.
        """
        capsule_path = _resolve_capsule(name)
        manifest_path = capsule_path / "manifest.toml"
        manifest_dump: dict[str, Any] | None = None
        manifest_error: str | None = None
        if manifest_path.is_file():
            try:
                manifest_dump = load_manifest(manifest_path).model_dump(mode="python")
            except Exception as exc:  # noqa: BLE001 — surfaced to caller verbatim.
                manifest_error = str(exc)

        # Top-level subtree listing — what a user sees in CapsuleExplorer.
        subtrees: list[dict[str, Any]] = []
        for child in sorted(capsule_path.iterdir()):
            if child.is_dir():
                subtrees.append(
                    {
                        "name": child.name,
                        "kind": "dir",
                        "entries": sum(1 for _ in child.rglob("*") if _.is_file()),
                    }
                )
            else:
                subtrees.append(
                    {"name": child.name, "kind": "file", "size_bytes": child.stat().st_size}
                )
        return {
            "name": name,
            "path": str(capsule_path.relative_to(repo_root())),
            "manifest": manifest_dump,
            "manifest_error": manifest_error,
            "subtrees": subtrees,
        }

    @app.get("/api/capsules/{name}/tree")
    def list_capsule_tree(name: str, subtree: str = "") -> dict[str, Any]:
        """List files (recursively) under a capsule's subtree.

        Used by the UI's CapsuleCodeView to enumerate files in
        ``src/{generated,user_edits,kernels}/`` so the user can pick one
        to open via ``/files/{path}``. Without this, the view had no way
        to discover what existed and was effectively dead.
        """
        capsule_path = _resolve_capsule(name)
        base = (capsule_path / subtree).resolve() if subtree else capsule_path
        try:
            base.relative_to(capsule_path)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Subtree escapes capsule"
            ) from exc
        if not base.is_dir():
            raise HTTPException(
                status_code=404, detail=f"Subtree not found: {subtree}"
            )
        files: list[dict[str, Any]] = []
        for path in sorted(base.rglob("*")):
            if path.is_file():
                rel = path.relative_to(capsule_path).as_posix()
                files.append({"path": rel, "size_bytes": path.stat().st_size})
        return {"name": name, "subtree": subtree, "files": files}

    @app.get("/api/capsules/{name}/files/{file_path:path}")
    def get_capsule_file(name: str, file_path: str) -> dict[str, Any]:
        """Read a single text file from a capsule.

        Restricted to the capsule directory subtree. Binary files (HDF5,
        images) are refused with a 415 — the UI uses different surfaces for
        those (diagnostics endpoint, plot images).
        """
        capsule_path = _resolve_capsule(name)
        target = (capsule_path / file_path).resolve()
        try:
            target.relative_to(capsule_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Path escapes capsule") from exc
        if not target.is_file():
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
        binary_suffixes = {".h5", ".hdf5", ".zarr", ".png", ".jpg", ".jpeg", ".pdf", ".zip"}
        if target.suffix.lower() in binary_suffixes:
            raise HTTPException(
                status_code=415,
                detail=f"Refusing to return binary file as text: {file_path}",
            )
        try:
            text = target.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=415, detail=f"Not a UTF-8 text file: {file_path}"
            ) from exc
        return {
            "name": name,
            "path": file_path,
            "size_bytes": target.stat().st_size,
            "content": text,
        }

    @app.get("/api/capsules/{name}/validate")
    def validate_capsule(name: str) -> dict[str, Any]:
        """Run the canonical CapsuleValidator and return its report."""
        capsule_path = _resolve_capsule(name)
        report = CapsuleValidator().validate(capsule_path)
        return {
            "name": name,
            "ok": report.ok,
            "violations": [
                {
                    "severity": v.severity,
                    "code": v.code,
                    "message": v.message,
                    "path": v.path,
                }
                for v in report.violations
            ],
            "errors": [v.code for v in report.errors],
            "warnings": [v.code for v in report.warnings],
        }

    @app.get("/api/capsules/{name}/diagnostics")
    def get_capsule_diagnostics(name: str) -> dict[str, Any]:
        """Read ``results/diagnostics.h5`` (preferred) or ``diagnostics.json``.

        Returns ``{"series": {<name>: [floats...]}, "source": "h5"|"json"}``.
        Phase 1's minimal capsule used JSON; Phase 2A added HDF5 — both are
        accepted so older capsules still inspect correctly.
        """
        import json

        capsule_path = _resolve_capsule(name)
        h5_path = capsule_path / "results" / "diagnostics.h5"
        json_path = capsule_path / "results" / "diagnostics.json"
        if h5_path.is_file():
            from simworkbench.serialization import read_diagnostics_h5

            data, _meta = read_diagnostics_h5(h5_path)
            return {
                "name": name,
                "source": "h5",
                "series": {k: v.tolist() for k, v in data.items()},
            }
        if json_path.is_file():
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            # Phase 1's minimal capsule wrote the JSON sidecar with a top-
            # level "diagnostics" key holding the series; metadata fields
            # (run_id, state, elapsed_seconds, ...) sit alongside. The earlier
            # implementation returned the whole payload as `series`, which
            # leaked metadata keys into the UI's series table. Pull
            # `diagnostics` if present; otherwise treat the payload itself
            # as the series map (older sidecars).
            if isinstance(payload, dict) and "diagnostics" in payload:
                series_obj = payload["diagnostics"] or {}
            else:
                series_obj = payload or {}
            return {
                "name": name,
                "source": "json",
                "series": series_obj,
            }
        raise HTTPException(
            status_code=404,
            detail=f"No diagnostics found in capsule {name!r} (results/diagnostics.{{h5,json}})",
        )

    # -----------------------------------------------------------------------
    # Phase 3D — Tool registry endpoints. The UI's Tools tab consumes these.
    # -----------------------------------------------------------------------

    def _registry() -> ToolRegistry:
        # Build a fresh ToolRegistry per request so tool.yaml edits show up
        # without restarting the server. Cheap (just YAML parsing).
        registry = ToolRegistry()
        registry.refresh()
        return registry

    @app.get("/api/tools")
    def list_tools() -> list[dict[str, Any]]:
        return _registry().index()

    @app.get("/api/tools/{name}")
    def get_tool(name: str) -> dict[str, Any]:
        try:
            entry = _registry().get(name)
        except Exception as exc:  # noqa: BLE001 — surfaced verbatim.
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {
            "name": entry.name,
            "directory": str(entry.directory.relative_to(repo_root())),
            "metadata": entry.metadata.model_dump(mode="json"),
        }

    @app.get("/api/tools/{name}/docs")
    def get_tool_docs(name: str) -> dict[str, Any]:
        """Return the tool's README + tool.yaml text so the UI can render
        documentation without a second fetch round-trip.
        """
        try:
            entry = _registry().get(name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        readme = entry.directory / "README.md"
        yaml_path = entry.directory / "tool.yaml"
        return {
            "name": entry.name,
            "readme": readme.read_text(encoding="utf-8") if readme.is_file() else "",
            "tool_yaml": yaml_path.read_text(encoding="utf-8") if yaml_path.is_file() else "",
        }

    @app.post("/api/tools/{name}/status")
    def set_tool_status(name: str, body: ToolStatusBody) -> dict[str, Any]:
        try:
            new_status = ToolStatus(body.status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Unknown status: {body.status!r}") from exc
        registry = _registry()
        try:
            entry = registry.set_status(name, new_status, actor=body.actor)
        except LifecycleError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {
            "name": entry.name,
            "status": entry.status.value,
        }

    @app.post("/api/tools/{name}/run-tests")
    def run_tool_tests(name: str) -> dict[str, Any]:
        """Run the tool's declared validation tests via pytest.

        Phase 3 gate verb: "test it". Returns ``{passed, returncode,
        stdout, stderr}`` so the UI can render the result without a
        second round-trip.
        """
        import subprocess
        import sys as _sys

        try:
            entry = _registry().get(name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        tests = list(entry.metadata.validation.tests)
        if not tests:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Tool {name!r} declares no validation tests. Add at least "
                    "one entry under tool.yaml validation.tests before running."
                ),
            )
        # Resolve every path under the tool directory (refuse path-escape).
        test_paths: list[str] = []
        tool_dir = entry.directory.resolve()
        for rel in tests:
            target = (tool_dir / rel).resolve()
            try:
                target.relative_to(tool_dir)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Test {rel!r} escapes tool directory; refusing to run.",
                ) from exc
            test_paths.append(str(target))
        result = subprocess.run(
            [_sys.executable, "-m", "pytest", "-x", "--tb=short", *test_paths],
            cwd=str(tool_dir),
            capture_output=True,
            text=True,
            check=False,
        )
        return {
            "name": name,
            "passed": result.returncode == 0,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    @app.post("/api/tools/{name}/execute")
    def execute_tool(name: str, body: ToolExecuteBody) -> dict[str, Any]:
        """Run a registered tool with JSON-serializable kwargs.

        Phase 3 gate verb: "use it (execute it)". For unit-aware ports,
        pass the magnitude in ``kwargs`` and the unit string in
        ``units`` (the endpoint wraps each magnitude with
        ``simworkbench.units.Q``). Output ports declared in tool.yaml
        are validated by ``RegisteredTool.execute``.
        """
        from simworkbench.units import Q

        try:
            entry = _registry().get(name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        # Build kwargs: any key in `body.units` gets wrapped in Q().
        prepared: dict[str, Any] = {}
        for key, value in body.kwargs.items():
            if key in body.units:
                prepared[key] = Q(value, body.units[key])
            else:
                prepared[key] = value
        try:
            output = entry.execute(**prepared)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        # Convert any unit-aware results back to (magnitude, units) pairs
        # so the response is JSON-serializable.
        from simworkbench.units.registry import get_registry as _ureg

        def _serialize(v: Any) -> Any:
            if isinstance(v, _ureg().Quantity):
                mag = v.magnitude
                if hasattr(mag, "tolist"):
                    mag = mag.tolist()
                return {"magnitude": mag, "units": str(v.units)}
            if hasattr(v, "tolist"):
                return v.tolist()
            return v

        return {
            "name": name,
            "output": {k: _serialize(output[k]) for k in output},
        }

    @app.post("/api/tools/{name}/export")
    def export_tool(name: str) -> dict[str, Any]:
        """Zip the tool's directory under local_cache/exports/.

        Phase 3 gate verb: "export it". Returns the archive path relative
        to the repo root so the UI can show / link it.
        """
        import zipfile
        from pathlib import Path as _Path

        from simworkbench.paths import local_cache_root as _local

        try:
            entry = _registry().get(name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        archive_dir = _local() / "exports"
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive = archive_dir / f"{entry.name}.tool.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in entry.directory.rglob("*"):
                if path.is_file():
                    arcname = _Path(entry.name) / path.relative_to(entry.directory)
                    zf.write(path, arcname=str(arcname))
        return {
            "name": name,
            "archive": str(archive.relative_to(repo_root())),
            "size_bytes": archive.stat().st_size,
        }

    # -----------------------------------------------------------------------
    # Phase 4 — Paper ingestion endpoints. The PaperImporter does the work;
    # the API surface is a thin wrapper that the UI calls.
    # -----------------------------------------------------------------------

    @app.post("/api/papers/import")
    def import_paper(body: PaperImportBody) -> dict[str, Any]:
        # Catch BOTH PaperIngestionError (caller-input failures) AND
        # TextExtractionError (extractor / dependency failures) — the
        # post-Phase-4 audit found PDF imports returning HTTP 500 because
        # only the first was caught. Carries `agent_error_patterns.md`
        # "Shipping the structured error without shipping the success path":
        # both the structured error AND its propagation to the boundary
        # have to land for the feature to work.
        from simworkbench.ingestion import (
            PaperImporter,
            PaperIngestionError,
            TextExtractionError,
        )

        capsule_path = _resolve_capsule(body.capsule)
        try:
            artifacts = PaperImporter().ingest(body.source_path, capsule_path)
        except (PaperIngestionError, TextExtractionError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "capsule": body.capsule,
            "paper_imported": str(artifacts.paper_path.relative_to(repo_root())),
            "equations_path": str(
                artifacts.equations_path.relative_to(repo_root())
            ),
            "parameters_path": str(
                artifacts.parameters_path.relative_to(repo_root())
            ),
            "interpretation_files": sorted(artifacts.interpretation_paths),
        }

    @app.get("/api/papers/{capsule}/extracted")
    def get_paper_extracted(capsule: str) -> dict[str, Any]:
        from simworkbench.ingestion import PaperImporter

        capsule_path = _resolve_capsule(capsule)
        return PaperImporter().read_extracted(capsule_path)

    @app.post("/api/papers/{capsule}/edit")
    def edit_paper(capsule: str, body: PaperEditBody) -> dict[str, Any]:
        from simworkbench.ingestion import PaperImporter, PaperIngestionError

        capsule_path = _resolve_capsule(capsule)
        try:
            PaperImporter().apply_edit(
                capsule_path,
                artifact=body.artifact,
                index=body.index,
                field=body.field,
                value=body.value,
                reviewer=body.reviewer,
            )
        except PaperIngestionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"capsule": capsule, "ok": True}

    @app.post("/api/tools/import")
    def import_tool(body: ToolImportBody) -> dict[str, Any]:
        """Copy an external tool tree into ``local_cache/imported_tools/``.

        Phase 3 gate verb: "import it". The source must be a directory
        containing a ``tool.yaml``; the target name is sanitized via
        ``ToolRegistry.register_from_template`` (which refuses path-
        escape names).
        """
        from simworkbench.paths import local_cache_root as _local
        from simworkbench.tools import ToolRegistryError

        source = Path(body.source_path).expanduser().resolve()
        if not source.is_dir() or not (source / "tool.yaml").is_file():
            raise HTTPException(
                status_code=400,
                detail=f"source_path {body.source_path!r} is not a tool directory.",
            )
        target_root = _local() / "imported_tools"
        target_root.mkdir(parents=True, exist_ok=True)
        registry = _registry()
        try:
            entry = registry.register_from_template(
                source, body.target_name, target_root=target_root
            )
        except ToolRegistryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "name": entry.name,
            "directory": str(entry.directory.relative_to(repo_root())),
        }

    return app


# Convenience: a module-level default app for `uvicorn simworkbench.api.server:app`.
app = create_app()


__all__ = ["RunSummary", "StartRunRequest", "app", "create_app"]
