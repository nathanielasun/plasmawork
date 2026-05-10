"""Workbench backend HTTP API.

A FastAPI app exposing the experiment, runtime, diagnostics, capsule, tool,
paper-ingestion, proposal, code-generation, sweep/reporting, and autonomy
surfaces consumed by the workbench UI. The API is HTTP/JSON; the TypeScript
client in ``apps/workbench-ui/src/api/client.ts`` mirrors the public response
and request shapes.

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
- ``GET  /api/tools/{name}/schema``            — normalized UI-safe tool contract.
- ``POST /api/tools/{name}/preview``           — validate a run without side effects.
- ``POST /api/tools/{name}/runs``              — create a local tool run.
- ``GET  /api/tools/{name}/runs/{run_id}``     — read local tool run metadata.
- ``GET  /api/tools/{name}/runs/{run_id}/artifacts`` — list run artifacts.
- ``POST /api/tools/{name}/export``            — zip the tool tree (Phase 3D).
- ``POST /api/tools/import``                   — copy a tool tree into
  ``local_cache/imported_tools/`` (Phase 3D).
- ``GET  /api/tool-authoring/templates``       — list server-known tool templates.
- ``GET  /api/tool-authoring/code-templates``  — list Python code snippets.
- ``POST /api/tool-authoring/code-templates``  — save a workspace code snippet.
- ``DELETE /api/tool-authoring/code-templates/{template_id}`` — delete local snippet.
- ``POST /api/tool-authoring/drafts``          — create a controlled tool draft.
- ``GET  /api/tool-authoring/drafts``          — list controlled tool drafts.
- ``GET  /api/tool-authoring/drafts/{draft_id}`` — read draft status/files.
- ``DELETE /api/tool-authoring/drafts/{draft_id}`` — delete an unregistered draft.
- ``GET  /api/tool-authoring/drafts/{draft_id}/files/{path}`` — read draft file.
- ``PUT  /api/tool-authoring/drafts/{draft_id}/files/{path}`` — edit draft file.
- ``POST /api/tool-authoring/drafts/{draft_id}/manifest`` — parse draft tool.yaml.
- ``POST /api/tool-authoring/drafts/{draft_id}/preview`` — bounded code preview.
- ``POST /api/tool-authoring/drafts/{draft_id}/check`` — run package checker.
- ``POST /api/tool-authoring/drafts/{draft_id}/register`` — register checked draft.
- ``POST /api/tool-authoring/drafts/{draft_id}/export`` — export draft package.
- ``POST /api/papers/import``                       — ingest a paper into a capsule (Phase 4).
- ``GET  /api/papers/{capsule}/extracted``          — read the structured extraction (Phase 4).
- ``POST /api/papers/{capsule}/edit``               — edit an extracted artifact +
  record provenance (Phase 4).
- ``POST /api/proposals``                           — Phase 5 end-to-end
  (transform → map → analyze → propose).

The legacy ``POST /api/runs`` path is synchronous: it starts the run on the
request thread and returns the final state. Long-running or privileged run
state is handled by the secure-core workspace-scoped run machinery.
"""

from __future__ import annotations

import os
from datetime import UTC as _UTC
from datetime import datetime as _datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

try:
    from fastapi import Depends, FastAPI, HTTPException, Request
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
    simulation_capsules_root_for,
    temp_runs_root,
    temp_runs_root_for,
)
from simworkbench.runtime import Runner
from simworkbench.serialization import CapsuleValidator, load_manifest
from simworkbench.tools import (
    AGENT_ALLOWED,
    ApprovalError,
    LifecycleError,
    ToolAuthoringError,
    ToolAuthoringNotFound,
    ToolAuthoringService,
    ToolRegistry,
    ToolRegistryError,
    ToolRunManager,
    ToolSchemaError,
    ToolStatus,
    consume_approval,
    normalize_tool_schema,
)
from simworkbench.tools.artifacts import ToolArtifactError
from simworkbench.tools.promotion import (
    PromotionError,
    PromotionNotFound,
    PromotionService,
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
    inputs: dict[str, Any] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)
    data_mappings: dict[str, Any] = Field(default_factory=dict)

    def tool_kwargs(self) -> dict[str, Any]:
        """Return the canonical tool input mapping.

        ``kwargs`` is the legacy local API shape. ``inputs`` is the UI
        workbench shape. Both are accepted during the migration; if a caller
        sends both, they must agree so the server does not choose silently.
        """
        if self.kwargs and self.inputs and self.kwargs != self.inputs:
            raise ValueError("Request must not send conflicting kwargs and inputs")
        return dict(self.kwargs or self.inputs)


class ToolImportBody(BaseModel):
    """POST /api/tools/import body."""

    source_path: str
    target_name: str


class ToolPromoteBody(BaseModel):
    """POST /api/tools/{name}/promote body — Phase α.4 (2026-05-10).

    The source workspace is derived server-side from
    ``request.state.workspace_slug``; the body carries only the
    target slug + a justification. Forbidden field rule (v4 §4.1):
    the body MUST NOT carry ``from_workspace_slug``,
    ``requested_by``, ``request_id``, or any other server-derived
    identity / lifecycle field.
    """

    to_workspace_slug: str
    justification: str = ""


class PromotionDecisionBody(BaseModel):
    """POST /api/tools/promotions/{request_id}/(approve|deny) body."""

    decision_note: str = ""


class ToolDraftCreateBody(BaseModel):
    """POST /api/tool-authoring/drafts body."""

    template_id: str
    name: str


class ToolDraftFileBody(BaseModel):
    """PUT /api/tool-authoring/drafts/{draft_id}/files/{path} body."""

    content: str


class ToolCodeTemplateBody(BaseModel):
    """POST /api/tool-authoring/code-templates body."""

    title: str
    description: str = ""
    category: str
    target_path: str
    content: str
    preview_harness: str = "python_smoke"


class ToolCodeTemplateApplyBody(BaseModel):
    """POST /api/tool-authoring/drafts/{draft_id}/apply-code-template body."""

    template_id: str
    target_path: str | None = None


class ToolDraftPreviewBody(BaseModel):
    """POST /api/tool-authoring/drafts/{draft_id}/preview body."""

    harness: str = "python_smoke"


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


class BrowseEntry(BaseModel):
    """One entry returned by `GET /api/browse`.

    `path` is repo-relative so the UI never sees absolute filesystem
    paths. `kind` discriminates dir / file. `size_bytes` is omitted for
    directories.
    """

    name: str
    path: str
    kind: str  # "dir" | "file"
    size_bytes: int | None = None
    mtime_iso: str | None = None


class BrowseResponse(BaseModel):
    """`GET /api/browse` response."""

    root: str
    relative_path: str  # path inside the root, e.g. "" for the root itself
    parent_relative_path: str | None  # null when at the root
    entries: list[BrowseEntry]
    truncated: bool  # True if we capped the entry list


class ExampleSummary(BaseModel):
    """One row in `GET /api/examples`.

    Each example under `examples/` ships at least a `run.py` and
    `README.md`. ModelSpec-driven examples (simple_rate_equations,
    krf_excimer) also ship `model.yaml`; the `kind` field
    distinguishes the two execution paths so the UI can render the
    right action.
    """

    name: str
    kind: str  # "modelspec" | "script"
    description: str
    has_model_yaml: bool
    readme_path: str
    run_path: str
    model_yaml_path: str | None = None


class RunExampleResponse(BaseModel):
    """POST /api/examples/{name}/run response."""

    name: str
    run_id: str | None = None
    summary_path: str | None = None
    capsule_name: str | None = None
    stdout_tail: str = ""
    duration_seconds: float = 0.0


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
# Workspace slug resolution — Phase 0.5 / Phase E5 + post-audit hardening
# (2026-05-09).
#
# The workbench-gateway proxies requests with the resolved workspace slug
# attached to ``request.state.workspace_slug`` via the HMAC-verified
# auth_middleware. Route handlers read it through the
# ``workspace_slug_dep`` FastAPI dependency below.
#
# Two modes:
#   - **gateway-required (production)**: ``WORKBENCH_GATEWAY_HANDOFF_SECRET``
#     is set in the env. ``create_app`` mounts ``WorkbenchHandoffMiddleware``
#     and ``workspace_slug_dep`` FAILS-CLOSED with 401 when
#     ``request.state.workspace_slug`` is absent. Defense in depth against
#     a same-host process that bypasses the gateway: even on loopback,
#     unsigned requests are rejected.
#   - **dev / single-tenant (no gateway)**: env var unset.
#     ``create_app`` does NOT mount the middleware; ``workspace_slug_dep``
#     falls back to ``DEFAULT_WORKSPACE_SLUG`` so direct TestClient usage
#     and internal-caller scripts keep working. The audit fix on
#     2026-05-09 closed the previous "fallback always engaged" gap which
#     allowed any colocated process to call the API as the default
#     workspace.
#
# Override knobs:
#   - ``SIMWORKBENCH_DEFAULT_WORKSPACE_SLUG``: default slug used in dev
#     mode (defaults to ``shared-public-experiments``).
#   - ``SIMWORKBENCH_REQUIRE_GATEWAY``: set to ``1`` to force gateway-
#     required mode without setting the secret env var (used by tests
#     that inject the middleware manually).
# ---------------------------------------------------------------------------


DEFAULT_WORKSPACE_SLUG = os.environ.get(
    "SIMWORKBENCH_DEFAULT_WORKSPACE_SLUG", "shared-public-experiments"
)


def _gateway_required_from_env() -> bool:
    """Return True iff the env declares gateway-required mode.

    Gateway-required mode is implied either by the explicit
    ``SIMWORKBENCH_REQUIRE_GATEWAY=1`` opt-in OR by the presence of a
    non-empty ``WORKBENCH_GATEWAY_HANDOFF_SECRET`` (any production
    deployment that runs the gateway will have set this for the
    FastAPI process to read).
    """
    if os.environ.get("SIMWORKBENCH_REQUIRE_GATEWAY", "") == "1":
        return True
    secret = os.environ.get("WORKBENCH_GATEWAY_HANDOFF_SECRET", "")
    return len(secret) > 0


def workspace_slug_dep(request: Request) -> str:
    """Return the request's workspace slug.

    Reads ``request.state.workspace_slug`` (set by
    ``WorkbenchHandoffMiddleware`` after HMAC verification). When the
    state attribute is missing:

    - In gateway-required mode → raises 401. This branch fires when a
      same-host process bypasses the gateway and hits the API
      directly. Without this fail-closed, the previous fallback
      behavior let any colocated caller run as ``DEFAULT_WORKSPACE_SLUG``.
    - In dev mode → falls back to ``DEFAULT_WORKSPACE_SLUG`` so direct
      TestClient usage and internal-caller scripts keep working.
    """
    slug = getattr(request.state, "workspace_slug", None)
    if slug is None:
        if _gateway_required_from_env():
            raise HTTPException(
                status_code=401,
                detail="Authentication required (missing workspace context).",
            )
        return DEFAULT_WORKSPACE_SLUG
    return slug


# ---------------------------------------------------------------------------
# App factory — per-app run registry lives in the closure, NOT module-global.
# Honors agent_error_patterns.md "API factory advertises isolation while
# sharing module-global state".
# ---------------------------------------------------------------------------


def create_app(
    *,
    mount_handoff_middleware: bool | None = None,
) -> FastAPI:
    """Build a fresh FastAPI app with its own in-memory run registry.

    Tests use this so each test starts with a clean state. The registry
    lives in the closure, NOT at module scope — see
    `agent_error_patterns.md` "API factory advertises isolation while
    sharing module-global state".

    Phase 0.5 post-audit (2026-05-09): when
    ``WORKBENCH_GATEWAY_HANDOFF_SECRET`` is set in the env (or the
    explicit ``mount_handoff_middleware=True`` override is passed),
    the app mounts ``WorkbenchHandoffMiddleware`` so any direct same-
    host request that lacks valid handoff headers is rejected at the
    edge. The dependency layer (``workspace_slug_dep``) ALSO fails
    closed in that mode — defense in depth against a future refactor
    that accidentally drops the middleware mount.

    ``mount_handoff_middleware``:
        - ``None`` (default): derive from env. Production sets the
          secret in ``.env.auth``; dev / TestClient leave it unset.
        - ``True``: mount unconditionally (used by integration tests
          that exercise the gateway → FastAPI path with signed
          headers).
        - ``False``: skip the mount (used by tests that exercise the
          API surface directly without the middleware).
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

    # Phase 0.5 post-audit (2026-05-09) — mount the gateway HMAC
    # middleware when the env declares gateway-required mode. The mount
    # has to happen BEFORE any route registration so the middleware
    # wraps every request.
    should_mount = (
        mount_handoff_middleware
        if mount_handoff_middleware is not None
        else _gateway_required_from_env()
    )
    if should_mount:
        from simworkbench.api.auth_middleware import (
            WorkbenchHandoffMiddleware,
            load_handoff_secret_from_env,
        )

        handoff_secret = load_handoff_secret_from_env()
        app.add_middleware(
            WorkbenchHandoffMiddleware,
            handoff_secret=handoff_secret,
        )

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(ok=True, version=__version__)

    # -----------------------------------------------------------------------
    # Folder browser.
    #
    # Read-only. Allow-listed roots: simulation_capsules, temp_runs,
    # local_cache, temp_imports (the four workbench-managed roots), plus
    # examples/ for picking model.yaml / run.py paths.
    #
    # Safety:
    #   - root name allow-listed against _BROWSE_ROOTS.
    #   - relative_path validated via .resolve().relative_to(root) so
    #     `..` and symlink escapes raise.
    #   - entry list capped at MAX_ENTRIES so a pathological dir does
    #     not OOM the response.
    #   - never executes any file.
    # -----------------------------------------------------------------------

    # Phase 0.5 / Phase E5: simulation_capsules and temp_runs are
    # workspace-scoped — each request resolves them under
    # `<root>/{slug}/`. local_cache, temp_imports, and examples stay
    # cross-workspace by design (per the auth-gateway plan: examples
    # are read-only-shared; local_cache holds system-wide caches).
    _BROWSE_ROOTS_CROSS_WORKSPACE: dict[str, Path] = {
        "local_cache": (repo_root() / "local_cache").resolve(),
        "temp_imports": (repo_root() / "temp_imports").resolve(),
        "examples": (repo_root() / "examples").resolve(),
    }
    _BROWSE_ROOT_NAMES: tuple[str, ...] = (
        "simulation_capsules",
        "temp_runs",
        *_BROWSE_ROOTS_CROSS_WORKSPACE.keys(),
    )
    _BROWSE_MAX_ENTRIES = 500

    def _resolve_browse_root(root: str, slug: str) -> Path:
        if root == "simulation_capsules":
            return simulation_capsules_root_for(slug).resolve()
        if root == "temp_runs":
            return temp_runs_root_for(slug).resolve()
        return _BROWSE_ROOTS_CROSS_WORKSPACE[root]

    @app.get("/api/browse", response_model=BrowseResponse)
    def browse(
        root: str = "simulation_capsules",
        path: str = "",
        slug: str = Depends(workspace_slug_dep),
    ) -> BrowseResponse:
        if root not in _BROWSE_ROOT_NAMES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Unknown browse root {root!r}. Allow-listed: "
                    f"{list(_BROWSE_ROOT_NAMES)}."
                ),
            )
        root_path = _resolve_browse_root(root, slug)
        if not root_path.is_dir():
            # Allowed root that doesn't exist on disk yet (e.g. empty
            # local_cache before first run). Return a real but empty
            # response rather than a 404.
            return BrowseResponse(
                root=root,
                relative_path="",
                parent_relative_path=None,
                entries=[],
                truncated=False,
            )

        # Resolve the requested subpath safely.
        rel = path.strip().lstrip("/")
        target = (root_path / rel).resolve() if rel else root_path
        try:
            target.relative_to(root_path)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Refusing to browse outside root {root!r}: "
                    f"{path!r} resolves outside the allowed tree."
                ),
            ) from exc
        if not target.is_dir():
            raise HTTPException(
                status_code=404,
                detail=f"Browse target {root}/{rel} is not a directory.",
            )

        # Build entry list. Dirs first, then files, both alphabetical.
        # Stop scanning at MAX_ENTRIES.
        try:
            children = sorted(
                target.iterdir(),
                key=lambda p: (not p.is_dir(), p.name.lower()),
            )
        except PermissionError as exc:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied reading {root}/{rel}.",
            ) from exc

        truncated = len(children) > _BROWSE_MAX_ENTRIES
        children = children[:_BROWSE_MAX_ENTRIES]

        entries: list[BrowseEntry] = []
        for child in children:
            try:
                stat = child.stat()
            except OSError:
                continue
            is_dir = child.is_dir()
            mtime_iso = (
                _datetime.fromtimestamp(stat.st_mtime, tz=_UTC).isoformat(
                    timespec="seconds"
                )
            )
            entries.append(
                BrowseEntry(
                    name=child.name,
                    path=str(child.relative_to(root_path)),
                    kind="dir" if is_dir else "file",
                    size_bytes=None if is_dir else stat.st_size,
                    mtime_iso=mtime_iso,
                )
            )

        rel_clean = "" if target == root_path else str(target.relative_to(root_path))
        parent_rel: str | None
        if rel_clean == "":
            parent_rel = None
        else:
            parent_path = target.parent
            parent_rel = (
                ""
                if parent_path == root_path
                else str(parent_path.relative_to(root_path))
            )

        return BrowseResponse(
            root=root,
            relative_path=rel_clean,
            parent_relative_path=parent_rel,
            entries=entries,
            truncated=truncated,
        )

    # -----------------------------------------------------------------------
    # Examples discovery + one-click runner.
    #
    # The UI's "Examples" panel lists every directory under examples/ that
    # ships a run.py + README.md. Each example is server-side allow-listed
    # against the discovered set; the API never reads a script path from
    # the request body. ModelSpec-driven examples (those with a
    # model.yaml) reuse the existing /api/runs path; pure-script examples
    # invoke run.py via subprocess with the repo venv, a 5-minute timeout,
    # and stdout capture.
    # -----------------------------------------------------------------------

    def _discover_examples() -> dict[str, ExampleSummary]:
        """Walk examples/ and return one ExampleSummary per qualified dir."""
        examples_root = repo_root() / "examples"
        out: dict[str, ExampleSummary] = {}
        if not examples_root.is_dir():
            return out
        for child in sorted(examples_root.iterdir()):
            if not child.is_dir():
                continue
            run_py = child / "run.py"
            readme = child / "README.md"
            if not (run_py.is_file() and readme.is_file()):
                continue
            model_yaml = child / "model.yaml"
            has_model = model_yaml.is_file()
            # Description = first paragraph of README, headers stripped.
            description = ""
            try:
                body = readme.read_text(encoding="utf-8")
                for raw in body.splitlines():
                    line = raw.strip()
                    if not line or line.startswith("#"):
                        continue
                    description = line
                    break
            except OSError:
                description = ""
            out[child.name] = ExampleSummary(
                name=child.name,
                kind="modelspec" if has_model else "script",
                description=description,
                has_model_yaml=has_model,
                readme_path=str(readme.relative_to(repo_root())),
                run_path=str(run_py.relative_to(repo_root())),
                model_yaml_path=(
                    str(model_yaml.relative_to(repo_root())) if has_model else None
                ),
            )
        return out

    @app.get("/api/examples", response_model=list[ExampleSummary])
    def list_examples() -> list[ExampleSummary]:
        return list(_discover_examples().values())

    @app.post("/api/examples/{name}/run", response_model=RunExampleResponse)
    def run_example(name: str) -> RunExampleResponse:
        """Run an example end-to-end.

        For ModelSpec-driven examples, parses the YAML and drives
        ``Runner`` synchronously (mirrors /api/runs). For
        script-driven examples, exec's run.py via subprocess with the
        repo venv. Either way the resulting capsule + summary paths
        come back as a typed response so the UI can link the user
        straight to the artifact.
        """
        import re
        import subprocess
        import time as _time

        examples = _discover_examples()
        if name not in examples:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Example {name!r} not found. Discovered: "
                    f"{sorted(examples)}"
                ),
            )
        example = examples[name]
        started = _time.monotonic()

        if example.kind == "modelspec":
            # Reuse the validated /api/runs path: build Experiment +
            # Runner inline. We re-import here rather than calling the
            # endpoint function so the run is still recorded in `runs`.
            assert example.model_yaml_path is not None
            spec_path = (repo_root() / example.model_yaml_path).resolve()
            try:
                spec = load_modelspec_yaml(spec_path)
                experiment = Experiment.from_model_spec(
                    spec,
                    run_config=RunConfig(
                        start_time="0 s",
                        end_time="100 ns",
                        max_steps=200,
                        seed=0,
                    ),
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            runner = Runner(experiment, base_seed=0)
            try:
                result = runner.run()
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            runs[runner.run_id] = {
                "state": result.state.value,
                "elapsed_seconds": result.elapsed_seconds,
                "final_simulation_time": result.final_simulation_time,
                "diagnostics": {k: list(v) for k, v in result.diagnostics.items()},
                "placeholders": list(result.placeholders),
            }
            return RunExampleResponse(
                name=name,
                run_id=runner.run_id,
                duration_seconds=_time.monotonic() - started,
                stdout_tail=(
                    f"ran ModelSpec {example.model_yaml_path} → run_id={runner.run_id}"
                ),
            )

        # Script-driven example. Run via subprocess with the repo venv.
        venv_python = repo_root() / ".venv" / "bin" / "python"
        python_exe = (
            str(venv_python) if venv_python.is_file() else "python3"
        )
        run_path = (repo_root() / example.run_path).resolve()
        # Defense in depth: refuse if the resolved run path escapes
        # examples/. _discover_examples already validated this, but
        # the file might be a symlink.
        try:
            run_path.relative_to((repo_root() / "examples").resolve())
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Refusing to run example outside examples/: {run_path}",
            ) from exc

        try:
            proc = subprocess.run(
                [python_exe, str(run_path)],
                cwd=str(repo_root()),
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(
                status_code=504,
                detail=f"Example {name!r} exceeded 5-minute timeout",
            ) from exc

        if proc.returncode != 0:
            tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-30:])
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Example {name!r} failed (exit {proc.returncode}). "
                    f"Last lines:\n{tail}"
                ),
            )

        # Parse stdout for the summary path + run_id (the examples'
        # own '[done]' / '[run]' lines are the source of truth).
        run_id_match = re.search(r"run_id\s*=\s*(\S+)", proc.stdout)
        summary_match = re.search(r"summary\s*=\s*(\S+)", proc.stdout)
        capsule_match = re.search(r"capsule\s*=\s*(\S+)", proc.stdout)
        stdout_tail = "\n".join(proc.stdout.splitlines()[-12:])
        return RunExampleResponse(
            name=name,
            run_id=run_id_match.group(1) if run_id_match else None,
            summary_path=summary_match.group(1) if summary_match else None,
            capsule_name=(
                Path(capsule_match.group(1)).name if capsule_match else None
            ),
            stdout_tail=stdout_tail,
            duration_seconds=_time.monotonic() - started,
        )

    # ---- runs <-> temp_runs/ unification ------------------------------
    #
    # In-memory `runs` is populated by `start_run` and the modelspec
    # branch of `run_example`. Script-driven example runs (ising, MD,
    # laser_species, pde_wave_equation) execute via subprocess and
    # write summaries to `temp_runs/<run_id>/summary.json` — they
    # never enter the in-memory dict. Without merging, the
    # Diagnostics tab silently drops every script-driven run.
    #
    # The merge is read-only: discovery walks temp_runs/ on each
    # listing call, parses each summary.json, and extracts any
    # diagnostic-shaped data (list[number], dict of list[number],
    # or list[dict] columnar) so the existing /api/runs response
    # contract still holds.

    def _load_temp_run_summary(
        run_id: str, slug: str = DEFAULT_WORKSPACE_SLUG
    ) -> dict[str, Any] | None:
        """Return the parsed summary.json for a run id under temp_runs/{slug}/.

        Path-traversal-guarded via name normalisation: the run_id
        cannot contain `/` or start with `.`. Returns None if the
        file doesn't exist or won't parse.
        """
        if not run_id or "/" in run_id or "\\" in run_id or run_id.startswith("."):
            return None
        target = temp_runs_root_for(slug) / run_id / "summary.json"
        if not target.is_file():
            return None
        try:
            import json as _json

            return _json.loads(target.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _extract_diagnostics(summary: dict[str, Any]) -> dict[str, list[float]]:
        """Walk the summary dict, surface anything time-series-shaped.

        Three accepted shapes (heuristic, best-effort — heterogeneous
        run-script outputs predate any JSON schema):
          1. Top-level ``key: list[number]`` → exposed as ``key``.
          2. Top-level ``key: {sub: list[number]}`` → exposed as
             ``key.sub`` (e.g. ``species_trajectories.A``).
          3. Top-level ``key: list[dict]`` → each numeric column is
             exposed as ``key.column`` (e.g. ising's ``rows.m_per_spin``).
        """
        out: dict[str, list[float]] = {}

        def _is_number_list(seq: Any) -> bool:
            return (
                isinstance(seq, list)
                and bool(seq)
                and all(isinstance(x, (int, float)) for x in seq)
                and not all(isinstance(x, bool) for x in seq)
            )

        for key, val in summary.items():
            # Pattern 1: list of numbers.
            if _is_number_list(val):
                out[key] = [float(x) for x in val]
                continue
            # Pattern 2: dict of list of numbers.
            if isinstance(val, dict):
                for sub_key, sub_val in val.items():
                    if _is_number_list(sub_val):
                        out[f"{key}.{sub_key}"] = [float(x) for x in sub_val]
                continue
            # Pattern 3: list of dicts → tabular columns.
            if isinstance(val, list) and val and all(isinstance(x, dict) for x in val):
                columns: set[str] = set()
                for row in val:
                    columns.update(row.keys())
                for col in columns:
                    series: list[float] = []
                    for row in val:
                        v = row.get(col)
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            series.append(float(v))
                    if series:
                        out[f"{key}.{col}"] = series
        return out

    def _temp_run_to_info(summary: dict[str, Any]) -> dict[str, Any]:
        """Project a summary.json into the same shape `runs[rid]` uses."""
        diagnostics = _extract_diagnostics(summary)
        # Best-effort: time axis from a `time_seconds` key if present
        # under any common location, else nothing (the diagnostic GET
        # falls back to integer indices).
        return {
            "state": str(summary.get("state", "completed")),
            "elapsed_seconds": float(summary.get("elapsed_seconds", 0.0) or 0.0),
            "final_simulation_time": float(
                summary.get("final_simulation_time")
                or summary.get("simulated_time_s")
                or 0.0
            ),
            "diagnostics": diagnostics,
            "placeholders": list(summary.get("placeholders", []) or []),
            "_source": "temp_run",
        }

    def _discover_temp_runs(
        slug: str = DEFAULT_WORKSPACE_SLUG,
    ) -> dict[str, dict[str, Any]]:
        """Walk temp_runs/{slug}/ and load every summary.json found."""
        root = temp_runs_root_for(slug)
        out: dict[str, dict[str, Any]] = {}
        if not root.is_dir():
            return out
        for child in root.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            summary = _load_temp_run_summary(child.name, slug)
            if summary is None:
                continue
            run_id = str(summary.get("run_id") or child.name)
            out[run_id] = _temp_run_to_info(summary)
        return out

    @app.get("/api/runs", response_model=list[RunSummary])
    def list_runs(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[RunSummary]:
        # In-memory runs take precedence (they carry the Runner's
        # full diagnostic dict); on-disk summaries fill in everything
        # the user kicked off through Examples gallery / a terminal.
        merged: dict[str, dict[str, Any]] = {}
        merged.update(_discover_temp_runs(slug))
        merged.update(runs)
        return [_summary(rid, info) for rid, info in merged.items()]

    @app.get("/api/runs/{run_id}", response_model=RunSummary)
    def get_run(
        run_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> RunSummary:
        if run_id in runs:
            return _summary(run_id, runs[run_id])
        summary = _load_temp_run_summary(run_id, slug)
        if summary is None:
            raise HTTPException(
                status_code=404, detail=f"Run {run_id!r} not found"
            )
        return _summary(run_id, _temp_run_to_info(summary))

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
    def get_diagnostic(
        run_id: str,
        name: str,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        # Resolve the run from in-memory first, then fall back to the
        # on-disk summary. This is what unifies the Diagnostics tab
        # across in-process runs and script-driven examples.
        info: dict[str, Any] | None = None
        if run_id in runs:
            info = runs[run_id]
        else:
            summary = _load_temp_run_summary(run_id, slug)
            if summary is not None:
                info = _temp_run_to_info(summary)
        if info is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
        diagnostics = info["diagnostics"]
        if name not in diagnostics:
            raise HTTPException(
                status_code=404,
                detail=f"Diagnostic {name!r} not present on run {run_id!r}",
            )
        values = diagnostics[name]
        # Time axis: prefer time_seconds when present (python_cpu shape),
        # otherwise an integer index axis. Scripts that produce
        # tabular data via Pattern 3 in _extract_diagnostics get the
        # index axis — the consumer can rebind by picking another
        # column as x via a future axis-selector UI.
        times = diagnostics.get("time_seconds")
        if not isinstance(times, list) or len(times) != len(values):
            times = list(range(len(values)))
        return {"run_id": run_id, "name": name, "times": times, "values": values}

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
    def list_capsules(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[dict[str, str]]:
        """List ``.lxp`` directories under ``simulation_capsules/{slug}/``."""
        root = simulation_capsules_root_for(slug)
        return [
            {"name": p.name, "path": str(p.relative_to(repo_root()))}
            for p in sorted(root.iterdir())
            if p.is_dir() and p.suffix == ".lxp"
        ]

    @app.get("/api/temp_runs")
    def list_temp_runs(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[dict[str, str]]:
        """List directories under ``temp_runs/{slug}/`` (in-flight runs)."""
        root = temp_runs_root_for(slug)
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

    def _resolve_capsule(
        name: str, slug: str = DEFAULT_WORKSPACE_SLUG
    ) -> Path:
        """Look up a capsule by directory name in the workspace's
        capsule root, refusing path-escape inputs.

        Honors agent_error_patterns.md "Side-effecting before validating": we
        validate the resolved path is inside the workspace-scoped
        ``simulation_capsules/{slug}/`` BEFORE any read. ``..`` segments
        would otherwise let a caller escape the sandbox.
        """
        root = simulation_capsules_root_for(slug).resolve()
        target = (root / name).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid capsule name") from exc
        if not target.is_dir():
            raise HTTPException(status_code=404, detail=f"Capsule {name!r} not found")
        return target

    @app.get("/api/capsules/{name}")
    def get_capsule(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Manifest + structural summary for a single capsule.

        The UI's ManifestView consumes this. We return raw JSON-friendly dicts
        so the frontend doesn't need to parse TOML.
        """
        capsule_path = _resolve_capsule(name, slug)
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
    def list_capsule_tree(
        name: str,
        subtree: str = "",
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """List files (recursively) under a capsule's subtree.

        Used by the UI's CapsuleCodeView to enumerate files in
        ``src/{generated,user_edits,kernels}/`` so the user can pick one
        to open via ``/files/{path}``. Without this, the view had no way
        to discover what existed and was effectively dead.
        """
        capsule_path = _resolve_capsule(name, slug)
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
    def get_capsule_file(
        name: str,
        file_path: str,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Read a single text file from a capsule.

        Restricted to the capsule directory subtree. Binary files (HDF5,
        images) are refused with a 415 — the UI uses different surfaces for
        those (diagnostics endpoint, plot images).
        """
        capsule_path = _resolve_capsule(name, slug)
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
    def validate_capsule(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Run the canonical CapsuleValidator and return its report."""
        capsule_path = _resolve_capsule(name, slug)
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
    def get_capsule_diagnostics(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Read ``results/diagnostics.h5`` (preferred) or ``diagnostics.json``.

        Returns ``{"series": {<name>: [floats...]}, "source": "h5"|"json"}``.
        Phase 1's minimal capsule used JSON; Phase 2A added HDF5 — both are
        accepted so older capsules still inspect correctly.
        """
        import json

        capsule_path = _resolve_capsule(name, slug)
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

    def _registry(slug: str | None = None) -> ToolRegistry:
        # Build a fresh ToolRegistry per request so tool.yaml edits show up
        # without restarting the server. Cheap (just YAML parsing).
        # Phase α (2026-05-10): the workspace slug scopes the registry to
        # the active workspace + shared-internal-tools. When ``slug`` is
        # None (legacy callers, refresh_registry.py, batch tools) the
        # registry walks the legacy flat layout instead.
        registry = ToolRegistry(workspace_slug=slug)
        registry.refresh()
        return registry

    _tool_runs = ToolRunManager()

    def _tool_entry_or_404(name: str, slug: str | None = None):
        try:
            return _registry(slug).get(name)
        except Exception as exc:  # noqa: BLE001 — surfaced verbatim.
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def _tool_compat_output(run: Any) -> dict[str, Any]:
        """Rebuild the legacy /execute output shape from a persisted run.

        New tool runs materialize table/file/diagram outputs as artifacts.
        ``/execute`` remains the small synchronous compatibility endpoint, so
        it reads JSON/text artifacts back into the old ``{"output": ...}``
        response while still leaving the run/artifact metadata behind for the
        new UI surfaces.
        """
        import json as _json

        output = dict(run.inline_output)
        for artifact in run.artifacts:
            target = (repo_root() / artifact.path).resolve()
            try:
                target.relative_to(repo_root())
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Artifact {artifact.artifact_id!r} escapes repo root",
                ) from exc
            if artifact.mime_type == "application/json":
                output[artifact.name] = _json.loads(target.read_text(encoding="utf-8"))
            elif artifact.mime_type in {"text/markdown", "text/plain"}:
                output[artifact.name] = target.read_text(encoding="utf-8")
            else:
                output[artifact.name] = artifact.model_dump(mode="json")
        return output

    def _tool_run_api_response(run: Any) -> dict[str, Any]:
        """Return a UI-friendly run payload while preserving raw fields.

        The raw ``ToolRun`` manifest fields (``inline_output`` and
        ``artifacts``) stay in the response for Python/integration callers.
        The UI consumes the normalized ``outputs`` / ``validation`` / ``logs``
        fields so it does not need to know the persistence shape.
        """
        payload = run.model_dump(mode="json")
        outputs: list[dict[str, Any]] = []
        for name, value in run.inline_output.items():
            outputs.append(
                {
                    "name": name,
                    "kind": "scalar" if not isinstance(value, (dict, list)) else "json",
                    "value": value,
                    "units": value.get("units") if isinstance(value, dict) else None,
                }
            )
        for artifact in run.artifacts:
            outputs.append(
                {
                    "name": artifact.name,
                    "kind": artifact.kind,
                    "value": artifact.preview,
                    "artifact_id": artifact.artifact_id,
                    "mime_type": artifact.mime_type,
                }
            )
        validation: list[dict[str, str]] = []
        if run.status.value == "failed":
            validation.append(
                {
                    "severity": "error",
                    "message": run.error or "Tool run failed.",
                }
            )
        elif run.status.value == "completed":
            validation.append(
                {
                    "severity": "info",
                    "message": "Tool run completed.",
                }
            )
        payload.update(
            {
                "name": run.tool_name,
                "outputs": outputs,
                "validation": validation,
                "logs": [
                    f"run {run.run_id} started",
                    (
                        f"run {run.status.value}"
                        if run.completed_at is None
                        else f"run {run.status.value} at {run.completed_at}"
                    ),
                ],
            }
        )
        return payload

    # -----------------------------------------------------------------------
    # Tool authoring endpoints. These create/edit/check draft packages under a
    # controlled local workspace root and only register them after a current
    # backend package check passes.
    # -----------------------------------------------------------------------

    def _authoring(slug: str | None = None) -> ToolAuthoringService:
        # Phase α (2026-05-10): drafts are workspace-scoped. Drafts
        # created in workspace X land under
        # ``local_cache/workspaces/{X}/tool_drafts/`` and are only
        # visible to X members. Legacy callers (no slug) keep the
        # ``local`` workspace prefix for back-compat.
        if slug is None:
            return ToolAuthoringService()
        return ToolAuthoringService(workspace_id=slug)

    def _raise_authoring(exc: ToolAuthoringError) -> None:
        status = 404 if isinstance(exc, ToolAuthoringNotFound) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc

    @app.get("/api/tool-authoring/templates")
    def list_tool_authoring_templates(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[dict[str, Any]]:
        return _authoring(slug).list_templates()

    @app.get("/api/tool-authoring/code-templates")
    def list_tool_authoring_code_templates(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[dict[str, Any]]:
        return _authoring(slug).list_code_templates()

    @app.post("/api/tool-authoring/code-templates")
    def create_tool_authoring_code_template(
        body: ToolCodeTemplateBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).create_code_template(
                title=body.title,
                description=body.description,
                category=body.category,
                target_path=body.target_path,
                content=body.content,
                preview_harness=body.preview_harness,
            )
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/code-templates/import")
    def import_tool_authoring_code_template(
        body: ToolCodeTemplateBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).import_code_template(
                title=body.title,
                description=body.description,
                category=body.category,
                target_path=body.target_path,
                content=body.content,
                preview_harness=body.preview_harness,
            )
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.delete("/api/tool-authoring/code-templates/{template_id}")
    def delete_tool_authoring_code_template(
        template_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).delete_code_template(template_id)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/drafts")
    def create_tool_authoring_draft(
        body: ToolDraftCreateBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).create_draft(
                template_id=body.template_id,
                tool_name=body.name,
            )
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.get("/api/tool-authoring/drafts")
    def list_tool_authoring_drafts(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[dict[str, Any]]:
        return _authoring(slug).list_drafts()

    @app.get("/api/tool-authoring/drafts/{draft_id}")
    def get_tool_authoring_draft(
        draft_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).get_draft(draft_id)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.delete("/api/tool-authoring/drafts/{draft_id}")
    def delete_tool_authoring_draft(
        draft_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).delete_draft(draft_id)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.get("/api/tool-authoring/drafts/{draft_id}/files/{path:path}")
    def read_tool_authoring_file(
        draft_id: str,
        path: str,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).read_file(draft_id, path)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.put("/api/tool-authoring/drafts/{draft_id}/files/{path:path}")
    def write_tool_authoring_file(
        draft_id: str,
        path: str,
        body: ToolDraftFileBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).write_file(draft_id, path, body.content)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/drafts/{draft_id}/manifest")
    def validate_tool_authoring_manifest(
        draft_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).validate_manifest(draft_id)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/drafts/{draft_id}/apply-code-template")
    def apply_tool_authoring_code_template(
        draft_id: str,
        body: ToolCodeTemplateApplyBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).apply_code_template(
                draft_id=draft_id,
                template_id=body.template_id,
                target_path=body.target_path,
            )
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/drafts/{draft_id}/preview")
    def preview_tool_authoring_draft(
        draft_id: str,
        body: ToolDraftPreviewBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).preview_draft(
                draft_id=draft_id,
                harness=body.harness,
            )
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/drafts/{draft_id}/check")
    def check_tool_authoring_draft(
        draft_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).run_check(draft_id)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.post("/api/tool-authoring/drafts/{draft_id}/register")
    def register_tool_authoring_draft(
        draft_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).register_draft(draft_id)
        except (ToolAuthoringError, ToolRegistryError, ValueError) as exc:
            if isinstance(exc, ToolAuthoringError):
                _raise_authoring(exc)
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/tool-authoring/drafts/{draft_id}/export")
    def export_tool_authoring_draft(
        draft_id: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        try:
            return _authoring(slug).export_draft(draft_id)
        except ToolAuthoringError as exc:
            _raise_authoring(exc)

    @app.get("/api/tools")
    def list_tools(
        slug: str = Depends(workspace_slug_dep),
    ) -> list[dict[str, Any]]:
        return _registry(slug).index()

    @app.get("/api/tools/{name}")
    def get_tool(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        entry = _tool_entry_or_404(name, slug)
        return {
            "name": entry.name,
            "directory": str(entry.directory.relative_to(repo_root())),
            "metadata": entry.metadata.model_dump(mode="json"),
        }

    @app.get("/api/tools/{name}/docs")
    def get_tool_docs(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Return the tool's README + tool.yaml text so the UI can render
        documentation without a second fetch round-trip.
        """
        entry = _tool_entry_or_404(name, slug)
        readme = entry.directory / "README.md"
        yaml_path = entry.directory / "tool.yaml"
        return {
            "name": entry.name,
            "readme": readme.read_text(encoding="utf-8") if readme.is_file() else "",
            "tool_yaml": yaml_path.read_text(encoding="utf-8") if yaml_path.is_file() else "",
        }

    @app.get("/api/tools/{name}/schema")
    def get_tool_schema(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Return the normalized UI-safe tool contract."""
        entry = _tool_entry_or_404(name, slug)
        return normalize_tool_schema(entry.metadata)

    @app.post("/api/tools/{name}/preview")
    def preview_tool(
        name: str,
        body: ToolExecuteBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Validate a tool run request and report planned side effects."""
        entry = _tool_entry_or_404(name, slug)
        try:
            preview = _tool_runs.preview(
                entry,
                kwargs=body.tool_kwargs(),
                units=body.units,
            )
        except (ToolSchemaError, ToolArtifactError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        response = preview.model_dump(mode="json")
        response["schema"] = response.pop("contract")
        response["name"] = response["tool_name"]
        response["ok"] = True
        response["validation"] = [
            {
                "severity": "info",
                "message": "Preview accepted; no tool side effects were run.",
            }
        ]
        for artifact in response["planned_artifacts"]:
            artifact.setdefault(
                "artifact_id",
                f"planned:{entry.name}:{artifact.get('name', 'artifact')}",
            )
        return response

    @app.post("/api/tools/{name}/runs")
    def create_tool_run(
        name: str,
        body: ToolExecuteBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Create a local synchronous tool run and persist output artifacts."""
        entry = _tool_entry_or_404(name, slug)
        try:
            run = _tool_runs.run(entry, kwargs=body.tool_kwargs(), units=body.units)
        except (ToolSchemaError, ToolArtifactError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _tool_run_api_response(run)

    @app.get("/api/tools/{name}/runs/{run_id}")
    def get_tool_run(name: str, run_id: str) -> dict[str, Any]:
        try:
            run = _tool_runs.get_run(name, run_id)
        except ToolArtifactError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — registry/read failures become 404.
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _tool_run_api_response(run)

    @app.get("/api/tools/{name}/runs/{run_id}/artifacts")
    def list_tool_run_artifacts(name: str, run_id: str) -> dict[str, Any]:
        try:
            artifacts = _tool_runs.list_artifacts(name, run_id)
        except ToolArtifactError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — registry/read failures become 404.
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {
            "name": name,
            "run_id": run_id,
            "artifacts": [artifact.model_dump(mode="json") for artifact in artifacts],
        }

    @app.get("/api/tool-artifacts/{artifact_id}")
    def get_tool_artifact(artifact_id: str) -> dict[str, Any]:
        """Return safe metadata + preview for a materialized tool artifact."""
        try:
            artifact = _tool_runs.get_artifact(artifact_id)
        except ToolArtifactError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — read failures become 404.
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return artifact.model_dump(mode="json")

    @app.post("/api/tools/{name}/status")
    def set_tool_status(
        name: str,
        body: ToolStatusBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        try:
            new_status = ToolStatus(body.status)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=f"Unknown status: {body.status!r}"
            ) from exc
        registry = _registry(slug)
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
    def run_tool_tests(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Run the tool's declared validation tests via pytest.

        Phase 3 gate verb: "test it". Returns ``{passed, returncode,
        stdout, stderr}`` so the UI can render the result without a
        second round-trip.
        """
        import subprocess
        import sys as _sys

        try:
            entry = _registry(slug).get(name)
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
    def execute_tool(
        name: str,
        body: ToolExecuteBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Run a registered tool with JSON-serializable kwargs.

        Phase 3 gate verb: "use it (execute it)". For unit-aware ports,
        pass the magnitude in ``kwargs`` and the unit string in
        ``units`` (the endpoint wraps each magnitude with
        ``simworkbench.units.Q``). Output ports declared in tool.yaml
        are validated by ``RegisteredTool.execute``.
        """
        entry = _tool_entry_or_404(name, slug)
        try:
            run = _tool_runs.run(entry, kwargs=body.tool_kwargs(), units=body.units)
        except (ToolSchemaError, ToolArtifactError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if run.status.value == "failed":
            raise HTTPException(status_code=400, detail=run.error or "Tool run failed")

        return {
            "name": name,
            "run_id": run.run_id,
            "output": _tool_compat_output(run),
            "artifacts": [artifact.model_dump(mode="json") for artifact in run.artifacts],
        }

    @app.post("/api/tools/{name}/export")
    def export_tool(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Zip the tool's directory under local_cache/exports/.

        Phase 3 gate verb: "export it". Returns the archive path relative
        to the repo root so the UI can show / link it.
        """
        import zipfile
        from pathlib import Path as _Path

        from simworkbench.paths import local_cache_root as _local

        try:
            entry = _registry(slug).get(name)
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
    def import_paper(
        body: PaperImportBody, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
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

        capsule_path = _resolve_capsule(body.capsule, slug)
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
    def get_paper_extracted(
        capsule: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        from simworkbench.ingestion import PaperImporter

        capsule_path = _resolve_capsule(capsule, slug)
        return PaperImporter().read_extracted(capsule_path)

    @app.post("/api/papers/{capsule}/edit")
    def edit_paper(
        capsule: str,
        body: PaperEditBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        from simworkbench.ingestion import PaperImporter, PaperIngestionError

        capsule_path = _resolve_capsule(capsule, slug)
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
    def import_tool(
        body: ToolImportBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Copy an external tool tree into the active workspace's
        imported-tool cache.

        Phase 3 gate verb: "import it". Phase α (2026-05-10) made the
        target workspace-scoped: imports land under
        ``local_cache/imported_tools/{slug}/`` so a tool imported in
        workspace X is private to X. The ``shared-internal-tools``
        bucket is reachable only via the promotion flow
        (``POST /api/tools/{name}/promote``), which requires
        PlatformAdmin approval.

        The source must be a directory containing a ``tool.yaml``;
        the target name is sanitized via
        ``ToolRegistry.register_from_template`` (which refuses path-
        escape names).
        """
        from simworkbench.paths import imported_tools_root_for as _ws_tools
        from simworkbench.tools import ToolRegistryError

        source = Path(body.source_path).expanduser().resolve()
        if not source.is_dir() or not (source / "tool.yaml").is_file():
            raise HTTPException(
                status_code=400,
                detail=f"source_path {body.source_path!r} is not a tool directory.",
            )
        target_root = _ws_tools(slug)
        registry = _registry(slug)
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
    # Phase α.4 — cross-workspace tool promotion (2026-05-10).
    #
    # WorkspaceAdmin in workspace X requests promotion of an imported
    # tool to a target workspace (typically `shared-internal-tools`);
    # PlatformAdmin approves; the approval performs the directory copy
    # and audits the action.
    #
    # Role gating: the gateway's proxy authChain enforces capabilities
    # before forwarding to FastAPI. In dev mode (no gateway), every
    # request is treated as having all roles for testing convenience —
    # documented in LIMITATIONS as a dev-only fallback. Production
    # deployments MUST run the gateway; otherwise the promotion flow
    # is ungated.
    # -----------------------------------------------------------------------

    _promotions = PromotionService()

    def _actor_roles(request: Request) -> tuple[str, ...]:
        """Read the role list from the gateway handoff. Empty tuple in
        dev mode (no middleware mounted)."""
        actor = getattr(request.state, "workbench_actor", None)
        if actor is None:
            return ()
        return tuple(actor.roles or ())

    def _actor_user_id(request: Request) -> str:
        """Read the actor user id. Falls back to "_dev_user" in dev mode
        so tests have a stable identity in promotion records."""
        actor = getattr(request.state, "workbench_actor", None)
        if actor is None:
            return "_dev_user"
        return actor.user_id

    def _require_role(request: Request, role: str) -> None:
        """403 if the actor does not carry the required role.

        Dev-mode bypass: when no middleware is mounted, the gateway is
        not enforcing capabilities either, so the role check is a
        no-op. This keeps direct-TestClient tests functional. The
        gateway-required env (``WORKBENCH_GATEWAY_HANDOFF_SECRET``
        set) flips this to strict mode via the auth_middleware mount;
        production deployments always have the secret set.
        """
        roles = _actor_roles(request)
        # Empty roles = dev mode; allow everything.
        if not roles:
            return
        if role not in roles:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Action requires role {role!r}; actor has {list(roles)}."
                ),
            )

    @app.post("/api/tools/{name}/promote")
    def request_tool_promotion(
        name: str,
        body: ToolPromoteBody,
        request: Request,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Request promotion of a workspace-local tool to a target
        workspace (typically ``shared-internal-tools``).

        Source workspace is derived from ``request.state.workspace_slug``
        (set by the auth middleware). Body carries only the target +
        a justification — never the source slug, the requester id, or
        the request id (v4 §4.1 forbidden-field rule).
        """
        _require_role(request, "WorkspaceAdmin")
        try:
            record = _promotions.request(
                tool_name=name,
                from_workspace_slug=slug,
                to_workspace_slug=body.to_workspace_slug,
                requested_by=_actor_user_id(request),
                justification=body.justification,
            )
        except PromotionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return record.as_json_dict()

    @app.get("/api/tool-promotions")
    def list_tool_promotions(request: Request) -> list[dict[str, Any]]:
        """List every pending promotion request. PlatformAdmin
        (IncidentRemediator role) only — the approver surface."""
        _require_role(request, "IncidentRemediator")
        return [r.as_json_dict() for r in _promotions.list_pending()]

    @app.post("/api/tool-promotions/{request_id}/approve")
    def approve_tool_promotion(
        request_id: str,
        body: PromotionDecisionBody,
        request: Request,
    ) -> dict[str, Any]:
        """Approve a pending promotion. Performs the cross-workspace
        directory copy + records the approval. PlatformAdmin only."""
        _require_role(request, "IncidentRemediator")
        try:
            record = _promotions.approve(
                request_id=request_id,
                approver_user_id=_actor_user_id(request),
                decision_note=body.decision_note,
            )
        except PromotionNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PromotionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return record.as_json_dict()

    @app.post("/api/tool-promotions/{request_id}/deny")
    def deny_tool_promotion(
        request_id: str,
        body: PromotionDecisionBody,
        request: Request,
    ) -> dict[str, Any]:
        """Deny a pending promotion. Source unchanged; record kept
        for audit. PlatformAdmin only."""
        _require_role(request, "IncidentRemediator")
        try:
            record = _promotions.deny(
                request_id=request_id,
                approver_user_id=_actor_user_id(request),
                decision_note=body.decision_note,
            )
        except PromotionNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PromotionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return record.as_json_dict()

    # -----------------------------------------------------------------------
    # Phase 5 — ModelSpec generation + module match + gap analysis +
    # experiment proposal. The whole pipeline runs in one call so the UI
    # can render every output without orchestrating four endpoints.
    # -----------------------------------------------------------------------

    @app.post("/api/proposals")
    def create_proposal(
        body: ProposalBody, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        from simworkbench.modeling import (
            ExperimentProposer,
            GapAnalyzer,
            ModelSpecGenerationError,
            ModelSpecGenerator,
            ModuleMatcher,
        )

        capsule_path = _resolve_capsule(body.capsule, slug)
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
    def list_codegen(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """List the generated tree under ``<capsule>/src/generated/`` plus
        the user_edits/ tree (separately, never co-mingled).
        """
        import json as _json

        capsule_path = _resolve_capsule(name, slug)
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
    def run_codegen(
        name: str,
        body: CodegenBody | None = None,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
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
        capsule_path = _resolve_capsule(name, slug)
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
    def codegen_diff(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
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

        capsule_path = _resolve_capsule(name, slug)
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
        preview_root = temp_runs_root_for(slug) / f"_codegen_diff_{_uuid.uuid4().hex[:8]}.lxp"
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
    def run_validation(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Run the Phase 6E ValidationRunner and return the summary path."""
        from simworkbench.codegen import ValidationRunner

        capsule_path = _resolve_capsule(name, slug)
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
        name: str,
        file_path: str,
        body: UserEditBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        from simworkbench.codegen import SandboxViolation, user_edit_write

        capsule_path = _resolve_capsule(name, slug)
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
    def get_comparison_report(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        import json as _json

        capsule_path = _resolve_capsule(name, slug)
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
    def autonomy_design(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Run ExperimentDesigner on the capsule's ModelSpec."""
        from simworkbench.autonomy import (
            ExperimentDesigner,
            capsule_status_for_plan,
        )
        from simworkbench.model_spec import load_yaml as _load_modelspec_yaml

        capsule_path = _resolve_capsule(name, slug)
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
    def autonomy_smoke(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
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

        capsule_path = _resolve_capsule(name, slug)
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
    def autonomy_review(
        name: str, slug: str = Depends(workspace_slug_dep)
    ) -> dict[str, Any]:
        """Run ScientificReviewer on the capsule and write the markdown."""
        from simworkbench.autonomy import ScientificReviewer

        capsule_path = _resolve_capsule(name, slug)
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
    def autonomy_sweep(
        name: str,
        body: AutonomySweepBody,
        slug: str = Depends(workspace_slug_dep),
    ) -> dict[str, Any]:
        """Run a budget-bounded sweep via ControlledSweepAgent.

        The objective is a stand-in quadratic on the first declared
        parameter — production callers wire the objective to the
        capsule's runner. The endpoint exists primarily to surface the
        agent's trend summary + next-sweep recommendation through the
        UI.
        """
        from simworkbench.autonomy import ControlledSweepAgent
        from simworkbench.sweep import GridSampler, SweepSpec

        capsule_path = _resolve_capsule(name, slug)
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
