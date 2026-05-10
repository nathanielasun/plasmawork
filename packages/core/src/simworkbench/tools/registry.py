"""Phase 3B — Tool registry.

Discovers tools under ``packages/internal_tools/registry/`` and the
imported-tools cache under ``local_cache/imported_tools/`` (plan §9.7),
parses each ``tool.yaml`` via ``load_tool_yaml``, and resolves the
declared entrypoint to a ``BaseTool`` subclass.

The registry is read-mostly. Mutations are: register (copy a tool tree
into the local registry), promote/demote (update ``tool.yaml``'s
``status`` field), and refresh (re-walk the directories). All three go
through ``simworkbench.paths.is_under_workbench`` for safety.
"""

from __future__ import annotations

import importlib.util
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from simworkbench.paths import is_under_workbench, local_cache_root, repo_root

from .base_tool import BaseTool
from .io import ToolOutput
from .lifecycle import LifecycleError, ToolStatus, require_transition
from .metadata import ToolMetadata, load_tool_yaml, write_tool_yaml


class ToolRegistryError(RuntimeError):
    """Raised when registry operations violate a structural invariant."""


@dataclass(frozen=True)
class RegisteredTool:
    """One entry in the registry."""

    metadata: ToolMetadata
    directory: Path  # absolute path to the tool's directory

    @property
    def name(self) -> str:
        return self.metadata.name

    @property
    def status(self) -> ToolStatus:
        return self.metadata.status

    def load_class(self) -> type[BaseTool]:
        """Import the entrypoint module and return the BaseTool subclass."""
        rel_module, class_name = self.metadata.entrypoint.split(":", 1)
        module_path = (self.directory / rel_module).resolve()
        if not module_path.is_file():
            raise ToolRegistryError(
                f"Tool {self.name!r} entrypoint module not found: {module_path}"
            )
        spec_name = f"_simworkbench_tool_{self.name}"
        spec = importlib.util.spec_from_file_location(spec_name, module_path)
        if spec is None or spec.loader is None:
            raise ToolRegistryError(
                f"Cannot build import spec for tool {self.name!r} at {module_path}"
            )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec_name] = module
        spec.loader.exec_module(module)
        cls = getattr(module, class_name, None)
        if cls is None:
            raise ToolRegistryError(
                f"Tool {self.name!r} entrypoint class {class_name!r} not found in "
                f"{module_path}"
            )
        if not (isinstance(cls, type) and issubclass(cls, BaseTool)):
            raise ToolRegistryError(
                f"Tool {self.name!r} entrypoint {class_name!r} must subclass BaseTool"
            )
        # Cross-check name / version between class and YAML.
        if cls.name and cls.name != self.metadata.name:
            raise ToolRegistryError(
                f"Tool class.name={cls.name!r} disagrees with tool.yaml name="
                f"{self.metadata.name!r} at {self.directory}"
            )
        return cls

    def execute(self, **kwargs: object) -> ToolOutput:
        """Instantiate the entrypoint class and run it, validating both
        ``ToolInput`` and ``ToolOutput`` against ``tool.yaml``.

        ``BaseTool.execute`` already validates the input side; this wrapper
        adds the output side: every port name declared in
        ``tool.yaml`` ``outputs:`` must be present in the returned
        ``ToolOutput`` (carries ``agent_error_patterns.md``
        "Validating inputs but not outputs at scientific boundaries" — the
        post-Phase-3 audit found a tool returning ``{"wrong": 1}`` was
        accepted because nothing checked the output keys against the
        declared port list).
        """
        cls = self.load_class()
        instance = cls()
        result = instance.execute(**kwargs)
        declared = [p.name for p in self.metadata.outputs]
        missing = [name for name in declared if name not in result]
        if missing:
            raise ToolRegistryError(
                f"Tool {self.name!r} returned a ToolOutput missing declared "
                f"port(s): {missing!r}. tool.yaml outputs declared "
                f"{declared!r} but the run() returned {sorted(result)!r}. "
                "Either return the missing keys or update tool.yaml to "
                "match what the tool actually emits."
            )
        return result


def _registry_root() -> Path:
    return repo_root() / "packages" / "internal_tools" / "registry"


def _imported_root() -> Path:
    """Legacy flat imported-tools root. Kept as a back-compat read source
    for installs that have not yet run
    ``scripts/dev/migrate_tools_to_workspaces.sh``. New tools land under
    the per-workspace layout (Phase α, 2026-05-10)."""
    return local_cache_root() / "imported_tools"


# Workspace-scoped layout introduced in Phase α (2026-05-10). The
# active workspace's tools are read from ``imported_tools/{slug}/``;
# the shared bucket is read from ``imported_tools/shared-internal-tools/``.
# Any directory whose name starts with ``_`` is skipped — that's the
# quarantine convention for the legacy migration sweep.
SHARED_INTERNAL_TOOLS_SLUG = "shared-internal-tools"

# Reserved subdirectory names ToolRegistry MUST NOT walk. Phase α
# (2026-05-10) added ``_pending_migration`` for the legacy flat-layout
# quarantine sweep AND ``_pending_promotions`` for the cross-workspace
# promotion request queue. Future quarantine / archive buckets land
# here so a new reserved name doesn't accidentally surface in a tool
# listing.
RESERVED_QUARANTINE_DIRS = frozenset({
    "_pending_migration",
    "_pending_promotions",
})


def _imported_root_for_slug(slug: str) -> Path:
    return local_cache_root() / "imported_tools" / slug


def _walk_tool_yamls(root: Path):
    """Yield ``tool.yaml`` paths from ``root``.

    Skips subdirectories listed in ``RESERVED_QUARANTINE_DIRS`` so the
    migration sweep's ``_pending_migration/`` cannot be silently
    reactivated by a future glob. Test fixtures that prefix their
    tool names with ``_pytest_`` are NOT affected — only literal
    reserved names match.
    """
    if not root.is_dir():
        return
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name in RESERVED_QUARANTINE_DIRS:
            continue
        tool_yaml = child / "tool.yaml"
        if tool_yaml.is_file():
            yield tool_yaml


class ToolRegistry:
    """In-memory snapshot of every tool the workbench can see.

    Use::

        registry = ToolRegistry()
        registry.refresh()
        tool = registry.get("absorption_spectrum_diagnostic").load_class()()
        tool.execute(frequency=Q_(...), intensity=Q_(...))

    Phase α (2026-05-10): the registry now scopes by workspace. The
    ``workspace_slug`` constructor argument selects the active
    workspace's tools; the registry ALWAYS also surfaces the
    ``shared-internal-tools`` workspace (the system-wide vetted bucket).
    Tools in other workspaces remain invisible.

    Backward compatibility: ``ToolRegistry()`` (no arg) walks the
    legacy flat ``imported_tools/`` root in addition to the seeded
    workspaces. Existing tests + the ``refresh_registry.py`` script
    rely on this so the migration can ship without per-call updates.
    Pass ``workspace_slug=...`` from FastAPI handlers (the slug comes
    from ``request.state.workspace_slug`` via ``workspace_slug_dep``).
    """

    def __init__(self, workspace_slug: str | None = None) -> None:
        self._entries: dict[str, RegisteredTool] = {}
        self._workspace_slug = workspace_slug

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def refresh(self) -> None:
        """Re-walk the registry roots and rebuild the entry map.

        Read order (later roots win on duplicate names — workspace-local
        tools shadow shared-internal-tools, which shadow the canonical
        repo registry):

        1. ``packages/internal_tools/registry/`` (repo, canonical).
        2. ``local_cache/imported_tools/`` (legacy flat layout, kept as
           a read source until the operator runs the migration sweep).
        3. ``local_cache/imported_tools/shared-internal-tools/``
           (system-wide vetted workspace bucket).
        4. ``local_cache/imported_tools/{workspace_slug}/`` (active
           workspace, only when constructed with one).

        Subdirs without a ``tool.yaml`` are skipped silently.
        Subdirs whose name starts with ``_`` are skipped — that's the
        quarantine convention for the legacy migration sweep.
        """
        self._entries.clear()
        roots: list[Path] = [_registry_root(), _imported_root()]
        roots.append(_imported_root_for_slug(SHARED_INTERNAL_TOOLS_SLUG))
        if (
            self._workspace_slug is not None
            and self._workspace_slug != SHARED_INTERNAL_TOOLS_SLUG
        ):
            roots.append(_imported_root_for_slug(self._workspace_slug))
        for root in roots:
            for tool_yaml in _walk_tool_yamls(root):
                try:
                    metadata = load_tool_yaml(tool_yaml)
                except Exception as exc:  # noqa: BLE001 — surface the failure verbatim.
                    raise ToolRegistryError(
                        f"Failed to load tool.yaml at {tool_yaml}: {exc}"
                    ) from exc
                directory = tool_yaml.parent.resolve()
                # Later roots in the read-order list shadow earlier
                # roots on duplicate names — workspace-local wins over
                # shared-internal-tools wins over the legacy flat
                # cache wins over the canonical repo registry. This is
                # the expected layering for the per-workspace model.
                self._entries[metadata.name] = RegisteredTool(
                    metadata=metadata, directory=directory
                )

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and name in self._entries

    def __iter__(self):
        return iter(self._entries.values())

    def __len__(self) -> int:
        return len(self._entries)

    def get(self, name: str) -> RegisteredTool:
        if name not in self._entries:
            raise ToolRegistryError(f"Tool {name!r} not in registry")
        return self._entries[name]

    def by_status(self, status: ToolStatus) -> list[RegisteredTool]:
        return [e for e in self._entries.values() if e.status == status]

    def by_type(self, tool_type: str) -> list[RegisteredTool]:
        return [e for e in self._entries.values() if e.metadata.type == tool_type]

    def index(self) -> list[dict[str, str]]:
        """Flat list-of-dicts suitable for the UI's tool list / index.yaml."""
        return [
            {
                "name": e.name,
                "type": e.metadata.type,
                "version": e.metadata.version,
                "status": e.metadata.status.value,
                "directory": str(e.directory.relative_to(repo_root())),
            }
            for e in sorted(self._entries.values(), key=lambda e: e.name)
        ]

    # ------------------------------------------------------------------
    # Mutations
    # ------------------------------------------------------------------

    def register_from_template(
        self,
        template_dir: str | Path,
        target_name: str,
        *,
        target_root: Path | None = None,
    ) -> RegisteredTool:
        """Copy a template tree into the registry under ``target_name``.

        ``target_root`` defaults to the canonical registry root. We refuse
        to write outside the workbench-managed roots — same guard the
        Phase 2C exporters use — AND we refuse a ``target_name`` that
        traverses out of the registry root via ``..`` / absolute paths /
        embedded slashes (carries ``agent_error_patterns.md``
        "Path traversal via unvalidated user-controlled component in
        destination paths" — a probe with ``target_name="../../escape"``
        previously created a directory outside the registry root before
        any validation fired).
        """
        # Reject path-escape `target_name` BEFORE touching the filesystem.
        # The registered name must be a single path component: no slashes,
        # no `..`, no leading `.`, and the resolved target must land inside
        # the registry root.
        if not target_name or target_name.strip() != target_name:
            raise ToolRegistryError("target_name must not be empty / whitespace")
        if "/" in target_name or "\\" in target_name:
            raise ToolRegistryError(
                f"target_name {target_name!r} contains a path separator. "
                "Tool names must be a single directory component."
            )
        if target_name in {".", ".."} or target_name.startswith(".."):
            raise ToolRegistryError(
                f"target_name {target_name!r} traverses out of the registry root."
            )
        if Path(target_name).is_absolute():
            raise ToolRegistryError(
                f"target_name {target_name!r} must be relative, not absolute."
            )

        src = Path(template_dir).resolve()
        if not src.is_dir():
            raise ToolRegistryError(f"Template not found: {src}")
        root = (target_root or _registry_root()).resolve()
        if not is_under_workbench(root):
            raise PermissionError(
                f"Refusing to register tool outside workbench-managed roots: {root}"
            )
        target = (root / target_name).resolve()
        # Belt + suspenders: confirm the resolved path stays inside ``root``.
        # Even with the syntactic checks above, a symlinked ``root`` or an
        # OS-specific oddity could let things drift; this is the last line.
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ToolRegistryError(
                f"target {target!r} resolved outside the registry root {root!r}"
            ) from exc
        if target.exists():
            raise ToolRegistryError(
                f"Tool target already exists: {target}. Pick a different name "
                "or remove the existing tool first."
            )
        shutil.copytree(src, target)
        # Stamp the new tool.yaml's `name` field if the template's was a
        # placeholder; otherwise leave the user's deliberate name in place.
        target_yaml = target / "tool.yaml"
        if target_yaml.is_file():
            data = yaml.safe_load(target_yaml.read_text(encoding="utf-8")) or {}
            if data.get("name") in (None, "", "TEMPLATE"):
                data["name"] = target_name
                target_yaml.write_text(
                    yaml.safe_dump(data, sort_keys=False), encoding="utf-8"
                )
        # Also rewrite ``name = "TEMPLATE"`` in the entrypoint module so the
        # class identity matches the metadata. Without this rewrite, freshly
        # registered template tools failed to load (carries
        # `agent_error_patterns.md` "Cross-check on registered artifact that
        # ignores half its identity").
        if target_yaml.is_file():
            metadata = load_tool_yaml(target_yaml)
            entry_rel = metadata.entrypoint.split(":", 1)[0]
            entry_path = (target / entry_rel).resolve()
            try:
                entry_path.relative_to(target)
            except ValueError:
                entry_path = None  # type: ignore[assignment]
            if entry_path is not None and entry_path.is_file():
                source = entry_path.read_text(encoding="utf-8")
                rewritten = source.replace(
                    'name = "TEMPLATE"', f'name = "{metadata.name}"'
                )
                if rewritten != source:
                    entry_path.write_text(rewritten, encoding="utf-8")
        self.refresh()
        return self.get(target_name)

    def set_status(
        self,
        name: str,
        new_status: ToolStatus,
        *,
        actor: str = "agent",
        run_tests: bool = True,
    ) -> RegisteredTool:
        """Promote / demote a tool. Persists by rewriting its tool.yaml.

        Raises ``LifecycleError`` on illegal transitions, unauthorized
        agent promotions (plan §9.5 — agents may not set ``trusted`` /
        ``validated``), AND on candidate→validated when the tool's
        declared ``validation.tests`` is empty or any of those tests
        fail. The lifecycle gate must include the artifact's scientific
        state, not just the actor (carries
        ``agent_error_patterns.md`` "Lifecycle promotion that checks the
        actor but not the artifact's scientific state").

        Pass ``run_tests=False`` only from a test fixture that explicitly
        wants to bypass the pytest invocation; production callers always
        run them.
        """
        entry = self.get(name)
        require_transition(entry.status, new_status, actor=actor)

        # Scientific gate for promotion to validated: the tool MUST declare
        # tests AND those tests MUST pass. Promotion to trusted is gated
        # by an external human-review process (recorded in the actor=
        # "human" gate above) but the validated→trusted step inherits
        # whatever validation evidence the tool already collected.
        if new_status is ToolStatus.VALIDATED and run_tests:
            tests = list(entry.metadata.validation.tests)
            if not tests:
                raise LifecycleError(
                    f"Tool {name!r} cannot be promoted to validated: "
                    "tool.yaml validation.tests is empty. Plan §9.5 "
                    "requires a validated tool to pass tests + benchmark "
                    "cases. Add at least one test under tests/ and list "
                    "it in validation.tests before promoting."
                )
            self._run_validation_tests(entry, tests)

        new_metadata = entry.metadata.model_copy(update={"status": new_status})
        write_tool_yaml(new_metadata, entry.directory / "tool.yaml")
        self._entries[name] = RegisteredTool(
            metadata=new_metadata, directory=entry.directory
        )
        return self._entries[name]

    @staticmethod
    def _run_validation_tests(entry: RegisteredTool, tests: list[str]) -> None:
        """Run pytest on the tool's declared validation tests. Raises
        ``LifecycleError`` if any test fails or the test invocation errors.
        """
        import subprocess
        import sys

        # Resolve every test path under the tool's directory and refuse
        # path-escape (a tool.yaml with `tests: ["../../etc/passwd"]`
        # must not let the validator run anything outside the tool tree).
        test_paths: list[str] = []
        for rel in tests:
            target = (entry.directory / rel).resolve()
            try:
                target.relative_to(entry.directory.resolve())
            except ValueError as exc:
                raise LifecycleError(
                    f"Tool {entry.name!r}: validation test {rel!r} resolves "
                    f"outside the tool directory ({target}). Refusing to run."
                ) from exc
            if not target.exists():
                raise LifecycleError(
                    f"Tool {entry.name!r}: declared validation test {rel!r} "
                    f"does not exist at {target}."
                )
            test_paths.append(str(target))

        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-x", "--tb=short", *test_paths],
            cwd=str(entry.directory),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise LifecycleError(
                f"Tool {entry.name!r} cannot be promoted to validated: "
                f"validation tests failed (exit {result.returncode}).\n\n"
                f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
            )


__all__ = [
    "RegisteredTool",
    "ToolRegistry",
    "ToolRegistryError",
]
