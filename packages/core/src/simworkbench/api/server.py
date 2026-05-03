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
            return {
                "name": name,
                "source": "json",
                "series": json.loads(json_path.read_text(encoding="utf-8")),
            }
        raise HTTPException(
            status_code=404,
            detail=f"No diagnostics found in capsule {name!r} (results/diagnostics.{{h5,json}})",
        )

    return app


# Convenience: a module-level default app for `uvicorn simworkbench.api.server:app`.
app = create_app()


__all__ = ["RunSummary", "StartRunRequest", "app", "create_app"]
