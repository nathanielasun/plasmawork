"""Phase 8 — Backend registry.

Loads ``configs/backends.yaml`` via Pydantic, exposes a
capability-aware ``recommend(spec)``, and gates lifecycle promotions
at ``set_status`` (rule 18). Refuses to silently skip malformed
entries (rule 20).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from simworkbench.paths import repo_root
from simworkbench.runtime.solver_backend import BackendCapabilities, SolverBackend

from .lifecycle import BackendStatus, require_backend_transition
from .metadata import BackendMetadata, load_backends_yaml


class BackendRegistryError(RuntimeError):
    """Raised on registry lookup / load failures."""


@dataclass
class RegisteredBackend:
    """One row of the registry."""

    metadata: BackendMetadata
    backend: SolverBackend | None = field(default=None)

    @property
    def name(self) -> str:
        return self.metadata.name

    @property
    def status(self) -> BackendStatus:
        return BackendStatus(self.metadata.status)

    def describe_capabilities(self) -> dict[str, Any]:
        """Capability dump merging metadata + the live backend (if any)."""
        if self.backend is not None:
            return self.backend.describe_capabilities()
        # Backend has no Python implementation registered yet (planned /
        # external). Synthesize from the metadata so the UI / registry
        # consumer gets a uniform shape.
        return {
            "name": self.name,
            "domains": list(self.metadata.supports.domains),
            "geometries": list(self.metadata.supports.geometries),
            "precisions": list(self.metadata.supports.precision),
            "determinism": {
                "deterministic": bool(self.metadata.determinism),
                "warning": (
                    "" if self.metadata.determinism
                    else "Backend declares determinism=false; results may vary "
                    "across runs / hardware. See ADR-0006."
                ),
            },
        }

    def covers_modelspec(self, spec: Any) -> bool:
        """Capability filter: backend supports the spec's geometry +
        domain. Uses the live backend's capabilities when registered;
        falls back to the YAML metadata otherwise."""
        if self.backend is not None:
            return self.backend.CAPABILITIES.covers_modelspec(spec)
        # Build a synthetic capability dump from metadata.
        caps = BackendCapabilities(
            domains=tuple(self.metadata.supports.domains),
            geometries=tuple(self.metadata.supports.geometries),
            precisions=tuple(self.metadata.supports.precision) or ("float64",),
            deterministic=bool(self.metadata.determinism),
        )
        return caps.covers_modelspec(spec)


def _default_config_path() -> Path:
    return repo_root() / "configs" / "backends.yaml"


class BackendRegistry:
    """Discover + manage backends from ``configs/backends.yaml``.

    The registry is the mutation boundary for lifecycle promotions
    (carries ``CLAUDE.md`` rule 18 forward to Phase 8).
    """

    def __init__(self, *, config_path: str | Path | None = None) -> None:
        self.config_path = Path(config_path) if config_path else _default_config_path()
        try:
            metadata_list, selection_policy = load_backends_yaml(self.config_path)
        except ValidationError as exc:
            # Rule 20: do not silently skip invalid metadata.
            raise BackendRegistryError(
                f"Invalid backend metadata in {self.config_path}: {exc}"
            ) from exc
        except Exception as exc:  # noqa: BLE001 — surface every parse failure
            raise BackendRegistryError(
                f"Could not load backend metadata from {self.config_path}: {exc}"
            ) from exc
        self._entries: dict[str, RegisteredBackend] = {
            md.name: RegisteredBackend(metadata=md) for md in metadata_list
        }
        self.selection_policy: dict[str, Any] = selection_policy
        # Auto-attach live runtime backends so capability filtering
        # uses the live ``CAPABILITIES`` descriptor (richer than the
        # YAML metadata, which lists raw domain strings).
        self._auto_attach_runtime_backends()

    def _auto_attach_runtime_backends(self) -> None:
        """Attach Python instances of any backends auto-registered with
        the runtime (e.g. ``python_cpu``, ``numba_cpu``)."""
        try:
            from simworkbench.runtime import (
                get_backend as _get_backend,
            )
            from simworkbench.runtime import (
                known_backends as _known_backends,
            )
        except Exception:  # noqa: BLE001 — runtime is mandatory but defensive
            return
        for name in _known_backends():
            if name not in self._entries:
                continue
            try:
                backend = _get_backend(name)
            except Exception:  # noqa: BLE001
                continue
            row = self._entries[name]
            self._entries[name] = RegisteredBackend(
                metadata=row.metadata, backend=backend  # type: ignore[arg-type]
            )


    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def names(self) -> list[str]:
        return sorted(self._entries)

    def get(self, name: str) -> RegisteredBackend:
        try:
            return self._entries[name]
        except KeyError as exc:
            raise BackendRegistryError(
                f"No backend {name!r} in registry. "
                f"Known: {', '.join(self.names()) or '(empty)'}."
            ) from exc

    def filter_status(self, status: BackendStatus) -> list[RegisteredBackend]:
        return [b for b in self._entries.values() if b.status is status]

    def attach(self, backend: SolverBackend) -> None:
        """Bind a live ``SolverBackend`` instance to its registry row.

        The registry stores metadata-only entries by default; the
        runtime calls this when it imports a real backend module so
        ``RegisteredBackend.describe_capabilities`` can return the
        live capability dump.
        """
        try:
            row = self._entries[backend.name]
        except KeyError as exc:
            raise BackendRegistryError(
                f"Cannot attach unknown backend {backend.name!r} — "
                "add it to configs/backends.yaml first."
            ) from exc
        self._entries[backend.name] = RegisteredBackend(
            metadata=row.metadata, backend=backend
        )

    # ------------------------------------------------------------------
    # Capability-aware recommendation
    # ------------------------------------------------------------------

    def recommend(self, spec: Any) -> list[RegisteredBackend]:
        """Return the registered backends whose capabilities cover the
        given ``ModelSpec``. The result is filtered (capability) but
        unranked beyond the natural insertion order; callers apply the
        ``selection_policy`` ranking layer themselves.
        """
        return [b for b in self._entries.values() if b.covers_modelspec(spec)]

    # ------------------------------------------------------------------
    # Lifecycle (mutation boundary; rule 18)
    # ------------------------------------------------------------------

    def set_status(
        self,
        name: str,
        new_status: BackendStatus,
        *,
        actor: str = "agent",
    ) -> RegisteredBackend:
        """Promote / demote a backend. Rewrites ``configs/backends.yaml``.

        Library callers cannot bypass approval — there is no
        ``skip_approval`` kwarg. The HTTP API consumes a token (mirrors
        the Phase 7 module flow). Carries
        `agent_error_patterns.md` "Trusting a client-supplied actor
        identity for a privileged check".
        """
        entry = self.get(name)
        require_backend_transition(entry.status, new_status, actor=actor)
        # Rewrite the YAML.
        config_dict = self._read_yaml()
        for row in config_dict["backends"]:
            if row["name"] == name:
                row["status"] = new_status.value
                break
        else:
            raise BackendRegistryError(
                f"Backend {name!r} not found in {self.config_path}"
            )
        import yaml as _yaml

        self.config_path.write_text(
            _yaml.safe_dump(config_dict, sort_keys=False),
            encoding="utf-8",
        )
        # Refresh the in-memory entry.
        new_metadata = entry.metadata.model_copy(update={"status": new_status.value})
        self._entries[name] = RegisteredBackend(
            metadata=new_metadata, backend=entry.backend
        )
        return self._entries[name]

    def _read_yaml(self) -> dict[str, Any]:
        import yaml as _yaml

        return _yaml.safe_load(self.config_path.read_text(encoding="utf-8"))


__all__ = [
    "BackendRegistry",
    "BackendRegistryError",
    "RegisteredBackend",
]
