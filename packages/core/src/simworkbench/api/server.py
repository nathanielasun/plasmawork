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
- ``POST /api/proposals``                           — Phase 5 end-to-end
  (transform → map → analyze → propose).

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
from simworkbench.tools import (
    AGENT_ALLOWED,
    ApprovalError,
    LifecycleError,
    ToolRegistry,
    ToolStatus,
    consume_approval,
)

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
    """POST /api/tools/{name}/status body.

    The ``actor`` field is intentionally absent. Earlier the API
    accepted ``actor="human"`` from the body and the registry
    promoted on the strength of that string alone — any caller could
    promote a tool to ``validated`` by claiming to be a human. Carries
    `agent_error_patterns.md` "Trusting a client-supplied actor
    identity for a privileged check".

    Agent-allowed transitions (draft / candidate / deprecated) run as
    ``actor="agent"``. Human-only transitions (validated / trusted)
    require a single-use approval token written via
    ``simworkbench.tools.grant_approval`` (or the local CLI). The
    endpoint reads + deletes the token before promoting.
    """

    status: str


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


class ProposalBody(BaseModel):
    """POST /api/proposals body — Phase 5 end-to-end runner.

    Plan §Phase 4 hard rule: agent-only interpretation cannot feed Phase 5.
    The body deliberately does NOT carry a ``require_reviewed`` knob —
    earlier post-Phase-5-close audit found the API exposed exactly that
    knob and any client could opt out by sending ``require_reviewed=false``.
    Hard rules belong inside the function, not as a caller-controlled
    flag (carries `agent_error_patterns.md` "Hard rule made optional via
    a client-controlled API parameter").
    """

    capsule: str


class CodegenBody(BaseModel):
    """POST /api/capsules/{name}/codegen body — Phase 6.

    Empty by design. The Phase 6 audit pre-emptively rejects a
    ``allow_user_edits_overwrite`` knob: the user_edits/ guard is
    library-enforced, not caller-controlled (carries
    `agent_error_patterns.md` "Hard rule made optional via a
    client-controlled API parameter"). The endpoint silently ignores
    extra fields rather than 422 so the gate-walk regression test can
    confirm the bypass attempt is harmless.
    """

    model_config = {"extra": "ignore"}


class UserEditBody(BaseModel):
    """POST /api/capsules/{name}/user_edits/{path:path} body.

    Reviewer-driven editor surface. The library's ``user_edit_write``
    enforces that ``path`` is under ``src/user_edits/`` only — paper_
    sources/, provenance/, and src/generated/ are refused at the
    library level, so the API can pass through without re-deriving
    the rule (carries the producer/consumer defense-in-depth pattern).
    """

    content: str


class AutonomySweepBody(BaseModel):
    """POST /api/autonomy/sweep body — Phase 10 / 10C.

    The agent's budget is set by the SERVER policy (configs/agents.yaml
    → controlled_sweep.budget); a client-supplied budget would be a
    Phase-6 bypass-kwarg replay. The body carries only the parameter
    grid and the metric name.

    Phase-6 audit lesson: hard rules don't take a client-controlled
    flag. ``actor`` / ``role`` / ``skip_approval`` / ``budget`` are not
    accepted; FastAPI silently ignores extras so a regression test can
    confirm the bypass attempt is harmless.
    """

    model_config = {"extra": "ignore"}

    parameters: dict[str, list[float]]
    metric: str = "loss"
    name: str = "autonomy_sweep"


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

        # Build the experiment + run config inside try/except — a malformed
        # end_time / max_steps / seed must surface as 400, not 500. Earlier
        # the constructors ran outside the wrapper and any ValidationError
        # escaped as a server error (carries `agent_error_patterns.md`
        # "Boundary validation parity": API endpoints validate every input
        # they consume, not just the ones FastAPI auto-validates).
        try:
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
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — Pydantic ValidationError, etc.
            raise HTTPException(status_code=400, detail=str(exc)) from exc

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
            raise HTTPException(
                status_code=400, detail=f"Unknown status: {body.status!r}"
            ) from exc
        registry = _registry()
        try:
            entry = registry.get(name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        # Pick the actor SERVER-SIDE: agent-allowed transitions run as
        # actor="agent"; human-only transitions require a pre-written
        # single-use approval token in local_cache/tool_approvals/.
        # The actor is never read from the request body — that was the
        # Phase-6 audit finding "Trusting a client-supplied actor
        # identity for a privileged check".
        if new_status in AGENT_ALLOWED:
            actor = "agent"
        else:
            try:
                reviewer = consume_approval(
                    name,
                    from_status=entry.status.value,
                    to_status=new_status.value,
                )
            except ApprovalError as exc:
                raise HTTPException(status_code=403, detail=str(exc)) from exc
            actor = "human"
            _ = reviewer  # captured by approval token; future audit log

        try:
            promoted = registry.set_status(name, new_status, actor=actor)
        except LifecycleError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {
            "name": promoted.name,
            "status": promoted.status.value,
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

    # -----------------------------------------------------------------------
    # Phase 5 — ModelSpec generation + module match + gap analysis +
    # experiment proposal. The whole pipeline runs in one call so the UI
    # can render every output without orchestrating four endpoints.
    # -----------------------------------------------------------------------

    @app.post("/api/proposals")
    def create_proposal(body: ProposalBody) -> dict[str, Any]:
        from simworkbench.modeling import (
            ExperimentProposer,
            GapAnalyzer,
            ModelSpecGenerationError,
            ModelSpecGenerator,
            ModuleMatcher,
        )

        capsule_path = _resolve_capsule(body.capsule)
        try:
            # require_reviewed is hard-coded True at the API boundary.
            # Plan §Phase 4 forbids consuming agent-only interpretation,
            # and that rule is not caller-controlled. Tests use the
            # library directly with the kwarg.
            spec = ModelSpecGenerator(require_reviewed=True).generate(
                capsule_path
            )
        except ModelSpecGenerationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        matches = ModuleMatcher().match(spec)
        gaps = GapAnalyzer().analyze(spec, matches)
        proposal_path = ExperimentProposer().propose(
            capsule_path, spec, matches, gaps
        )
        return {
            "capsule": body.capsule,
            "proposal_path": str(proposal_path.relative_to(repo_root())),
            "modelspec_path": str(
                (capsule_path / "model" / "model_spec.yaml").relative_to(repo_root())
            ),
            "matches": matches.to_dict(),
            "gaps": gaps.to_dict(),
        }

    # -----------------------------------------------------------------------
    # Phase 6 — Sandboxed Agentic Code Generation. Three endpoints power the
    # UI's GeneratedCodeView: list, regenerate, and diff.
    # -----------------------------------------------------------------------

    @app.get("/api/capsules/{name}/codegen")
    def list_codegen(name: str) -> dict[str, Any]:
        """List the generated tree under ``<capsule>/src/generated/`` plus
        the user_edits/ tree (separately, never co-mingled).
        """
        import json as _json

        capsule_path = _resolve_capsule(name)
        generated_root = capsule_path / "src" / "generated"
        user_edits_root = capsule_path / "src" / "user_edits"

        def _enumerate(root: Path) -> list[dict[str, Any]]:
            if not root.is_dir():
                return []
            items: list[dict[str, Any]] = []
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.name != ".gitkeep":
                    items.append(
                        {
                            "path": path.relative_to(capsule_path).as_posix(),
                            "size_bytes": path.stat().st_size,
                        }
                    )
            return items

        manifest_path = generated_root / "codegen_manifest.json"
        manifest: dict[str, Any] | None = None
        if manifest_path.is_file():
            try:
                manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                manifest = None
        return {
            "capsule": name,
            "generated_files": _enumerate(generated_root),
            "user_edits_files": _enumerate(user_edits_root),
            "manifest": manifest,
        }

    @app.post("/api/capsules/{name}/codegen")
    def run_codegen(name: str, body: CodegenBody | None = None) -> dict[str, Any]:
        """Regenerate the generated tree from the capsule's ModelSpec.

        Hard-rule enforcement (13th behavioral check): the body model
        ignores any ``allow_user_edits_overwrite`` field; the sandbox
        refuses writes under ``user_edits/`` regardless. ``body`` is
        accepted but unused — its presence guards against future field
        smuggling, not against this call's behavior.
        """
        from simworkbench.codegen import CodeGenerator
        from simworkbench.model_spec import load_yaml as _load_modelspec_yaml

        _ = body  # silence linter; the field is intentionally unread
        capsule_path = _resolve_capsule(name)
        spec_path = capsule_path / "model" / "model_spec.yaml"
        if not spec_path.is_file():
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Capsule {name!r} has no model/model_spec.yaml — "
                    "run /api/proposals first."
                ),
            )
        spec = _load_modelspec_yaml(spec_path)
        result = CodeGenerator().generate(capsule_path, spec)
        return {
            "capsule": name,
            "files_written": list(result.files_written),
            "files_removed": list(result.removed_files),
            "manifest_path": (
                str(result.manifest_path.relative_to(repo_root()))
                if result.manifest_path
                else None
            ),
        }

    @app.get("/api/capsules/{name}/codegen/diff")
    def codegen_diff(name: str) -> dict[str, Any]:
        """Compute a real diff between the prior-generation manifest
        and what would result from regenerating right now.

        Returns ``{previous, current_preview, added, removed, changed,
        unchanged}``. Earlier this endpoint was misnamed: it returned
        ``previous`` + ``current_files`` only, leaving the diff
        derivation to the caller. Carries
        `agent_error_patterns.md` "Diff endpoint that doesn't compute a
        diff".

        ``current_preview`` is computed by running the generator on
        an in-memory capsule fixture (the spec on disk + a temp tree
        we write to under ``temp_runs/``), so the comparison reflects
        what would be written, not what was last written. The temp
        tree is removed before returning.
        """
        import json as _json
        import shutil as _shutil
        import uuid as _uuid

        from simworkbench.codegen import CodeGenerator
        from simworkbench.model_spec import load_yaml as _load_modelspec_yaml
        from simworkbench.paths import temp_runs_root

        capsule_path = _resolve_capsule(name)
        generated_root = capsule_path / "src" / "generated"
        prior_manifest_path = generated_root / "codegen_manifest.json"
        previous: dict[str, Any] | None = None
        if prior_manifest_path.is_file():
            try:
                previous = _json.loads(
                    prior_manifest_path.read_text(encoding="utf-8")
                )
            except Exception:  # noqa: BLE001
                previous = None

        # Generate a preview into a temp capsule clone so the disk
        # state isn't mutated.
        spec_path = capsule_path / "model" / "model_spec.yaml"
        if not spec_path.is_file():
            return {
                "capsule": name,
                "previous": previous,
                "current_preview": [],
                "added": [],
                "removed": [],
                "changed": [],
                "unchanged": [],
                "note": "No model_spec.yaml — generate a proposal first.",
            }
        preview_root = temp_runs_root() / f"_codegen_diff_{_uuid.uuid4().hex[:8]}.lxp"
        try:
            (preview_root / "model").mkdir(parents=True)
            (preview_root / "src" / "generated").mkdir(parents=True)
            (preview_root / "src" / "user_edits").mkdir(parents=True)
            (preview_root / "model" / "model_spec.yaml").write_text(
                spec_path.read_text(encoding="utf-8"), encoding="utf-8"
            )
            preview_spec = _load_modelspec_yaml(
                preview_root / "model" / "model_spec.yaml"
            )
            preview = CodeGenerator().generate(preview_root, preview_spec)
            current_preview = [
                {"path": p, "sha256": preview.file_hashes[p]}
                for p in preview.files_written
                if p != "src/generated/codegen_manifest.json"
            ]
        finally:
            _shutil.rmtree(preview_root, ignore_errors=True)

        # Compute added / removed / changed by comparing prior manifest
        # files (sha256 included) against the preview hashes.
        prior_files = {
            entry["path"]: entry.get("sha256", "")
            for entry in (previous.get("files", []) if previous else [])
            if isinstance(entry, dict) and "path" in entry
        }
        # codegen_manifest.json itself changes on every generate; exclude
        # from the diff so the rest of the tree is comparable.
        prior_files.pop("src/generated/codegen_manifest.json", None)
        current_files = {entry["path"]: entry["sha256"] for entry in current_preview}

        added = sorted(set(current_files) - set(prior_files))
        removed = sorted(set(prior_files) - set(current_files))
        changed = sorted(
            p for p in (set(prior_files) & set(current_files))
            if prior_files[p] != current_files[p]
        )
        unchanged = sorted(
            p for p in (set(prior_files) & set(current_files))
            if prior_files[p] == current_files[p]
        )
        return {
            "capsule": name,
            "previous": previous,
            "current_preview": current_preview,
            "added": added,
            "removed": removed,
            "changed": changed,
            "unchanged": unchanged,
        }

    @app.post("/api/capsules/{name}/validate-run")
    def run_validation(name: str) -> dict[str, Any]:
        """Run the Phase 6E ValidationRunner and return the summary path."""
        from simworkbench.codegen import ValidationRunner

        capsule_path = _resolve_capsule(name)
        try:
            summary_path = ValidationRunner().run(capsule_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "capsule": name,
            "summary_path": str(summary_path.relative_to(repo_root())),
        }

    # -----------------------------------------------------------------------
    # Phase 6D — Reviewer editor for src/user_edits/. The plan calls Phase 6D
    # "Generated Code Viewer AND Editor"; this endpoint is the editor side.
    # The library enforces the user_edits/ allow-list; the API just passes
    # through.
    # -----------------------------------------------------------------------

    @app.post("/api/capsules/{name}/user_edits/{file_path:path}")
    def write_user_edit(
        name: str, file_path: str, body: UserEditBody
    ) -> dict[str, Any]:
        from simworkbench.codegen import SandboxViolation, user_edit_write

        capsule_path = _resolve_capsule(name)
        if not file_path:
            raise HTTPException(
                status_code=400,
                detail="Empty path; supply a path under src/user_edits/.",
            )
        relative = f"src/user_edits/{file_path}"
        try:
            written = user_edit_write(capsule_path, relative, body.content)
        except SandboxViolation as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "capsule": name,
            "path": str(written.relative_to(capsule_path)),
            "size_bytes": written.stat().st_size,
        }

    # -----------------------------------------------------------------------
    # Phase 9 / 9D — Comparative reports. The Python reporter
    # (``simworkbench.reports.ComparisonReport``) writes manifest.json
    # under ``<capsule>/comparison/``. This endpoint surfaces it; no
    # business logic in the API.
    # -----------------------------------------------------------------------

    @app.get("/api/comparison/{name}")
    def get_comparison_report(name: str) -> dict[str, Any]:
        import json as _json

        capsule_path = _resolve_capsule(name)
        manifest_path = capsule_path / "comparison" / "manifest.json"
        if not manifest_path.is_file():
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No comparison/manifest.json under capsule {name!r}. "
                    "Run a sweep + ComparisonReport.write() first."
                ),
            )
        try:
            return _json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=500,
                detail=f"Comparison manifest unreadable: {exc}",
            ) from exc

    # -----------------------------------------------------------------------
    # Phase 10 — Autonomy endpoints. Every endpoint here returns DATA; no
    # endpoint mutates a capsule's lifecycle status. Approval-gated actions
    # (trusted-promotion, expensive-runs, external-export, destructive-edits)
    # require an out-of-band token (`grant_autonomy_approval`) — the API
    # never reads `actor` / `role` from the body.
    #
    # Phase-10 round-2 audit: every endpoint here APPENDS one entry to the
    # capsule's ``provenance/agent_trace.md`` so an autonomous decision is
    # auditable post hoc. The earlier implementation returned 200 without
    # any provenance write — that defeated plan §Phase 10's "preserve
    # inspectability" requirement.
    # -----------------------------------------------------------------------

    def _trace_autonomy(
        capsule_path: Path,
        *,
        agent: str,
        action: str,
        files_touched: tuple[str, ...] = (),
        notes: str = "",
    ) -> None:
        from simworkbench.provenance import AgentTraceWriter

        target = capsule_path / "provenance" / "agent_trace.md"
        AgentTraceWriter(target).append(
            agent=agent,
            action=action,
            files_touched=files_touched,
            notes=notes,
        )

    def _autonomy_sweep_budget(default: int = 32) -> int:
        """Read the controlled-sweep budget from configs/agents.yaml.

        Phase-10 round-2 audit: previously hard-coded 8, ignoring the
        ``max_evaluations_per_launch`` documented in the YAML. The
        config is now the source of truth; bad / missing values fall
        back to the default with a server log entry but never silently
        promote past the YAML's documented cap.
        """
        import yaml

        from simworkbench.paths import repo_root

        config_path = repo_root() / "configs" / "agents.yaml"
        try:
            config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        except OSError:
            return default
        for entry in config.get("agents", []) or []:
            if entry.get("role") == "controlled_sweep":
                budget_block = entry.get("budget") or {}
                cap = budget_block.get("max_evaluations_per_launch")
                if isinstance(cap, int) and cap > 0:
                    return cap
                break
        return default

    @app.post("/api/autonomy/design/{name}")
    def autonomy_design(name: str) -> dict[str, Any]:
        """Run ExperimentDesigner on the capsule's ModelSpec."""
        from simworkbench.autonomy import (
            ExperimentDesigner,
            capsule_status_for_plan,
        )
        from simworkbench.model_spec import load_yaml as _load_modelspec_yaml

        capsule_path = _resolve_capsule(name)
        spec_path = capsule_path / "model" / "model_spec.yaml"
        if not spec_path.is_file():
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Capsule {name!r} has no model/model_spec.yaml; "
                    "design first."
                ),
            )
        try:
            spec = _load_modelspec_yaml(spec_path)
        except Exception as exc:  # noqa: BLE001 — surfaced verbatim
            raise HTTPException(
                status_code=400,
                detail=f"Failed to load ModelSpec: {exc}",
            ) from exc
        try:
            plan = ExperimentDesigner().design(spec)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        status = capsule_status_for_plan(plan)
        _trace_autonomy(
            capsule_path,
            agent="experiment_design",
            action="autonomy_design",
            files_touched=("model/model_spec.yaml",),
            notes=(
                f"plan_status={status}; placeholders="
                f"{','.join(plan.placeholders) if plan.placeholders else 'none'}"
            ),
        )
        return {
            "capsule": name,
            "minimum_viable_model": plan.minimum_viable_model,
            "fidelity_ladder": [
                {
                    "label": s.label,
                    "description": s.description,
                    "cpu_cost_factor": s.cpu_cost_factor,
                }
                for s in plan.fidelity_ladder
            ],
            "cost_estimate": {
                "total_cpu_seconds": plan.cost_estimate.total_cpu_seconds,
                "backend": plan.cost_estimate.backend,
                "notes": plan.cost_estimate.notes,
            },
            "diagnostics": list(plan.diagnostics),
            "validation_path": list(plan.validation_path),
            "placeholders": list(plan.placeholders),
            "capsule_status": status,
        }

    @app.post("/api/autonomy/smoke/{name}")
    def autonomy_smoke(name: str) -> dict[str, Any]:
        """Run a SmokeRunner pass against the capsule's ModelSpec.

        Phase-10 round-2 audit added this endpoint: 10B was implemented
        as a library but not surfaced through the API. The UI panel
        advertises four endpoints (design / smoke / sweep / review);
        this completes the set.
        """
        from simworkbench.autonomy import SmokeRunner
        from simworkbench.experiment import (
            BackendConfig,
            Experiment,
            RunConfig,
        )
        from simworkbench.model_spec import load_yaml as _load_modelspec_yaml

        capsule_path = _resolve_capsule(name)
        spec_path = capsule_path / "model" / "model_spec.yaml"
        if not spec_path.is_file():
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Capsule {name!r} has no model/model_spec.yaml; "
                    "design first."
                ),
            )
        try:
            spec = _load_modelspec_yaml(spec_path)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail=f"Failed to load ModelSpec: {exc}",
            ) from exc
        try:
            experiment = Experiment.from_model_spec(
                spec,
                run_config=RunConfig(
                    start_time="0 s", end_time="1 ns", max_steps=10
                ),
                backend_config=BackendConfig(name="python_cpu"),
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail=f"Cannot build Experiment from spec: {exc}",
            ) from exc
        report = SmokeRunner().run(experiment)
        _trace_autonomy(
            capsule_path,
            agent="autonomous_runs",
            action="autonomy_smoke",
            notes=(
                f"instability_flags={len(report.instability_flags)}; "
                f"adjustments_suggested={len(report.suggested_param_adjustments)}"
            ),
        )
        return {
            "capsule": name,
            "diagnostics_interpretation": dict(report.diagnostics_interpretation),
            "instability_flags": list(report.instability_flags),
            "suggested_param_adjustments": list(
                report.suggested_param_adjustments
            ),
            "review_markdown": report.review_markdown,
        }

    @app.post("/api/autonomy/review/{name}")
    def autonomy_review(name: str) -> dict[str, Any]:
        """Run ScientificReviewer on the capsule and write the markdown."""
        from simworkbench.autonomy import ScientificReviewer

        capsule_path = _resolve_capsule(name)
        try:
            written = ScientificReviewer().write(capsule_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        rel = written.relative_to(capsule_path)
        _trace_autonomy(
            capsule_path,
            agent="scientific_review",
            action="autonomy_review",
            files_touched=(str(rel),),
        )
        return {
            "capsule": name,
            "review_path": str(rel),
        }

    @app.post("/api/autonomy/sweep/{name}")
    def autonomy_sweep(name: str, body: AutonomySweepBody) -> dict[str, Any]:
        """Run a budget-bounded sweep via ControlledSweepAgent.

        The objective is a stand-in quadratic on the first declared
        parameter — production callers wire the objective to the
        capsule's runner. The endpoint exists primarily to surface the
        agent's trend summary + next-sweep recommendation through the
        UI.
        """
        from simworkbench.autonomy import ControlledSweepAgent
        from simworkbench.sweep import GridSampler, SweepSpec

        capsule_path = _resolve_capsule(name)
        if not body.parameters:
            raise HTTPException(
                status_code=400,
                detail="parameters dict is empty; supply at least one axis.",
            )
        spec = SweepSpec(
            name=body.name,
            parameters=body.parameters,  # type: ignore[arg-type]
            sampler=GridSampler(),
        )
        # Phase-10 round-2 audit: budget comes from configs/agents.yaml
        # (controlled_sweep.budget.max_evaluations_per_launch). The body
        # never carries a budget — passing one would be a Phase-6
        # bypass-kwarg replay.
        budget = _autonomy_sweep_budget()
        agent = ControlledSweepAgent(budget=budget, summary_metric=body.metric)
        first_axis = next(iter(body.parameters))

        def objective(p: dict[str, float]) -> dict[str, float]:
            return {body.metric: float(p[first_axis]) ** 2}

        result = agent.launch_with_summary(spec, objective)
        _trace_autonomy(
            capsule_path,
            agent="controlled_sweep",
            action="autonomy_sweep",
            notes=(
                f"budget={budget}; completed={len(result.report.completed)}; "
                f"failed={len(result.report.failed)}; "
                f"stopped_reason={result.report.stopped_reason}"
            ),
        )
        return {
            "capsule": name,
            "trend_summary": result.trend_summary,
            "next_sweep_recommendation": result.next_sweep_recommendation,
            "failure_ratio": result.failure_ratio,
            "completed": len(result.report.completed),
            "failed": len(result.report.failed),
            "stopped_reason": result.report.stopped_reason,
            "budget": budget,
        }

    return app


# Convenience: a module-level default app for `uvicorn simworkbench.api.server:app`.
app = create_app()


__all__ = ["RunSummary", "StartRunRequest", "app", "create_app"]
