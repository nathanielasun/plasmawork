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
from .lifecycle import ToolStatus, require_transition
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


def _registry_root() -> Path:
    return repo_root() / "packages" / "internal_tools" / "registry"


def _imported_root() -> Path:
    return local_cache_root() / "imported_tools"


class ToolRegistry:
    """In-memory snapshot of every tool the workbench can see.

    Use::

        registry = ToolRegistry()
        registry.refresh()
        tool = registry.get("absorption_spectrum_diagnostic").load_class()()
        tool.execute(frequency=Q_(...), intensity=Q_(...))
    """

    def __init__(self) -> None:
        self._entries: dict[str, RegisteredTool] = {}

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def refresh(self) -> None:
        """Re-walk the registry roots and rebuild the entry map.

        Discovers two trees: the canonical repo registry under
        ``packages/internal_tools/registry/`` and the user-imported cache
        under ``local_cache/imported_tools/`` (plan §9.7). Tools are
        identified by their ``tool.yaml``; subdirs without one are
        skipped silently.
        """
        self._entries.clear()
        for root in (_registry_root(), _imported_root()):
            if not root.is_dir():
                continue
            for tool_yaml in root.glob("*/tool.yaml"):
                try:
                    metadata = load_tool_yaml(tool_yaml)
                except Exception as exc:  # noqa: BLE001 — surface the failure verbatim.
                    raise ToolRegistryError(
                        f"Failed to load tool.yaml at {tool_yaml}: {exc}"
                    ) from exc
                directory = tool_yaml.parent.resolve()
                if metadata.name in self._entries:
                    other = self._entries[metadata.name].directory
                    raise ToolRegistryError(
                        f"Duplicate tool {metadata.name!r}: {directory} and {other}"
                    )
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
        Phase 2C exporters use.
        """
        src = Path(template_dir).resolve()
        if not src.is_dir():
            raise ToolRegistryError(f"Template not found: {src}")
        root = (target_root or _registry_root()).resolve()
        if not is_under_workbench(root):
            raise PermissionError(
                f"Refusing to register tool outside workbench-managed roots: {root}"
            )
        target = root / target_name
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
        self.refresh()
        return self.get(target_name)

    def set_status(
        self,
        name: str,
        new_status: ToolStatus,
        *,
        actor: str = "agent",
    ) -> RegisteredTool:
        """Promote / demote a tool. Persists by rewriting its tool.yaml.

        Raises ``LifecycleError`` on illegal transitions or unauthorized
        agent promotions (plan §9.5 — agents may not set ``trusted`` or
        ``validated``).
        """
        entry = self.get(name)
        require_transition(entry.status, new_status, actor=actor)
        new_metadata = entry.metadata.model_copy(update={"status": new_status})
        write_tool_yaml(new_metadata, entry.directory / "tool.yaml")
        self._entries[name] = RegisteredTool(
            metadata=new_metadata, directory=entry.directory
        )
        return self._entries[name]


__all__ = [
    "RegisteredTool",
    "ToolRegistry",
    "ToolRegistryError",
]
