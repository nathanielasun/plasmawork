"""Phase 7 — Module registry.

Walks ``packages/physics_modules/<domain>/<name>/module.yaml`` and
exposes a typed API mirroring the Phase-3 tool registry. Promotions
to validated / trusted go through ``set_status`` with a hard
``actor="human"`` requirement; the HTTP API gates that path with a
single-use approval token (see ``simworkbench.modules.approval``).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from simworkbench.paths import repo_root

from .lifecycle import ModuleStatus, require_module_transition
from .metadata import ModuleMetadata, load_module_yaml, metadata_paths, write_module_yaml


class ModuleRegistryError(RuntimeError):
    """Raised on registry lookups that fail."""


@dataclass
class RegisteredModule:
    metadata: ModuleMetadata
    directory: Path

    @property
    def name(self) -> str:
        return self.metadata.name

    @property
    def status(self) -> ModuleStatus:
        return ModuleStatus(self.metadata.status)


def _default_modules_root() -> Path:
    return repo_root() / "packages" / "physics_modules"


class ModuleRegistry:
    """Discover + manage physics modules under
    ``packages/physics_modules/``."""

    def __init__(self, *, modules_root: Path | None = None) -> None:
        self.modules_root = modules_root or _default_modules_root()
        self._entries: dict[str, RegisteredModule] = {}
        self.refresh()

    def refresh(self) -> None:
        self._entries = {}
        for path in metadata_paths(self.modules_root):
            try:
                metadata = load_module_yaml(path)
            except Exception:  # noqa: BLE001 — surfaced lazily on .get(name)
                continue
            self._entries[metadata.name] = RegisteredModule(
                metadata=metadata, directory=path.parent
            )

    def names(self) -> list[str]:
        return sorted(self._entries)

    def get(self, name: str) -> RegisteredModule:
        try:
            return self._entries[name]
        except KeyError as exc:
            raise ModuleRegistryError(
                f"No module {name!r} in registry. "
                f"Known: {', '.join(self.names()) or '(empty)'}."
            ) from exc

    def filter_status(self, status: ModuleStatus) -> list[RegisteredModule]:
        return [m for m in self._entries.values() if m.status is status]

    def set_status(
        self,
        name: str,
        new_status: ModuleStatus,
        *,
        actor: str = "agent",
    ) -> RegisteredModule:
        """Promote / demote a module. Persists by rewriting its
        ``module.yaml``.

        Raises ``ModuleLifecycleError`` for illegal transitions and
        agent-driven promotions to validated / trusted. The HTTP API
        layer enforces that ``actor="human"`` requires a single-use
        approval token.
        """
        entry = self.get(name)
        require_module_transition(entry.status, new_status, actor=actor)
        new_metadata = entry.metadata.model_copy(
            update={"status": new_status.value}
        )
        write_module_yaml(new_metadata, entry.directory / "module.yaml")
        self._entries[name] = RegisteredModule(
            metadata=new_metadata, directory=entry.directory
        )
        return self._entries[name]


__all__ = ["ModuleRegistry", "ModuleRegistryError", "RegisteredModule"]
