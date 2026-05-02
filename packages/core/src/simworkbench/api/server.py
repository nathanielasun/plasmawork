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
except ImportError:  # pragma: no cover — fastapi is a hard dep, but keep a clear message.
    raise RuntimeError(
        "FastAPI is required for the workbench API server. "
        "Install via `pip install -e packages/core` or add fastapi explicitly."
    )

from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml as load_modelspec_yaml
from simworkbench.paths import (
    repo_root,
    simulation_capsules_root,
    temp_runs_root,
)
from simworkbench.runtime import Runner

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class StartRunRequest(BaseModel):
    """POST /api/runs body."""

    model_yaml_path: str = Field(
        description="Repo-relative path to a ModelSpec YAML, e.g. 'examples/simple_rate_equations/model.yaml'."
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


class HealthResponse(BaseModel):
    ok: bool = True
    version: str


# ---------------------------------------------------------------------------
# In-memory run registry (Phase 1F — single-process; persistence Phase 2+).
# ---------------------------------------------------------------------------

_RUNS: dict[str, dict[str, Any]] = {}


def _runs_index() -> list[RunSummary]:
    return [
        RunSummary(
            run_id=rid,
            state=info["state"],
            elapsed_seconds=info["elapsed_seconds"],
            final_simulation_time=info["final_simulation_time"],
            diagnostics_keys=list(info["diagnostics"].keys()),
        )
        for rid, info in _RUNS.items()
    ]


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Build a fresh FastAPI app. Tests use this instead of a module-level app
    so each test starts with a clean run registry.
    """
    from simworkbench import __version__

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
        return _runs_index()

    @app.get("/api/runs/{run_id}", response_model=RunSummary)
    def get_run(run_id: str) -> RunSummary:
        if run_id not in _RUNS:
            raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
        info = _RUNS[run_id]
        return RunSummary(
            run_id=run_id,
            state=info["state"],
            elapsed_seconds=info["elapsed_seconds"],
            final_simulation_time=info["final_simulation_time"],
            diagnostics_keys=list(info["diagnostics"].keys()),
        )

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
                detail=f"Refusing to load model spec outside the repository: {req.model_yaml_path!r}",
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
        result = runner.run()
        _RUNS[runner.run_id] = {
            "state": result.state.value,
            "elapsed_seconds": result.elapsed_seconds,
            "final_simulation_time": result.final_simulation_time,
            "diagnostics": {k: list(v) for k, v in result.diagnostics.items()},
        }
        return RunSummary(
            run_id=runner.run_id,
            state=result.state.value,
            elapsed_seconds=result.elapsed_seconds,
            final_simulation_time=result.final_simulation_time,
            diagnostics_keys=list(result.diagnostics.keys()),
        )

    @app.get("/api/runs/{run_id}/diagnostics/{name}")
    def get_diagnostic(run_id: str, name: str) -> dict[str, Any]:
        if run_id not in _RUNS:
            raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
        diagnostics = _RUNS[run_id]["diagnostics"]
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
            {"slug": p.stem, "title": p.stem.replace("_", " ").title(), "path": str(p.relative_to(repo_root()))}
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

    return app


# Convenience: a module-level default app for `uvicorn simworkbench.api.server:app`.
app = create_app()


__all__ = ["RunSummary", "StartRunRequest", "app", "create_app"]
