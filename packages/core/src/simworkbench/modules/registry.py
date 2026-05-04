"""Phase 7 — Module registry.

Walks ``packages/physics_modules/<domain>/<name>/module.yaml`` and
exposes a typed API mirroring the Phase-3 tool registry. Promotions
to validated / trusted go through ``set_status`` with approval-token
and scientific-evidence checks at the same mutation boundary that
rewrites ``module.yaml``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from simworkbench.paths import repo_root

from .approval import consume_module_approval
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
            except Exception as exc:  # noqa: BLE001
                raise ModuleRegistryError(
                    f"Invalid module metadata at {path}: {exc}"
                ) from exc
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
        non-human promotions to validated / trusted. Privileged
        promotions also consume a single-use approval token and, for
        ``candidate → validated``, require benchmark artifacts plus
        declared tests that pass. This gate lives in the library and has
        no caller-exposed bypass flags, so direct callers cannot bypass
        it by passing ``actor="human"``.
        """
        entry = self.get(name)
        require_module_transition(entry.status, new_status, actor=actor)

        new_metadata = self._metadata_with_status(entry.metadata, new_status)
        if new_status is ModuleStatus.VALIDATED:
            self._validate_scientific_evidence(entry, new_metadata)
        if new_status in {ModuleStatus.VALIDATED, ModuleStatus.TRUSTED}:
            consume_module_approval(
                name,
                from_status=entry.status.value,
                to_status=new_status.value,
            )

        write_module_yaml(new_metadata, entry.directory / "module.yaml")
        self._entries[name] = RegisteredModule(
            metadata=new_metadata, directory=entry.directory
        )
        return self._entries[name]

    @staticmethod
    def _metadata_with_status(
        metadata: ModuleMetadata,
        new_status: ModuleStatus,
    ) -> ModuleMetadata:
        data = metadata.model_dump(mode="python")
        data["status"] = new_status.value
        return ModuleMetadata.model_validate(data)

    @staticmethod
    def _declared_tests(metadata: ModuleMetadata) -> list[str]:
        raw = (
            metadata.tests.model_dump(mode="python")
            if hasattr(metadata.tests, "model_dump")
            else dict(metadata.tests or {})
        )
        tests: list[str] = []
        for values in raw.values():
            if isinstance(values, list):
                tests.extend(str(v) for v in values if str(v).strip())
        return tests

    def _validate_scientific_evidence(
        self,
        entry: RegisteredModule,
        metadata: ModuleMetadata,
    ) -> None:
        """Validate benchmark artifacts + declared tests before promotion.

        The registry previously checked the actor but not the artifact's
        scientific state. Promotion to ``validated`` now refuses missing
        benchmark references, missing benchmark files, missing tests, and
        failing tests before it rewrites ``module.yaml``.
        """
        if not metadata.benchmarks:
            raise ModuleRegistryError(
                f"Module {entry.name!r} cannot be promoted to validated: "
                "module.yaml benchmarks is empty."
            )

        module_root = entry.directory.resolve()
        for benchmark in metadata.benchmarks:
            if not benchmark.artifact:
                raise ModuleRegistryError(
                    f"Module {entry.name!r} benchmark {benchmark.id!r} has no artifact."
                )
            artifact = (module_root / benchmark.artifact).resolve()
            try:
                artifact.relative_to(module_root)
            except ValueError as exc:
                raise ModuleRegistryError(
                    f"Module {entry.name!r} benchmark artifact "
                    f"{benchmark.artifact!r} escapes the module directory."
                ) from exc
            if not artifact.is_file():
                raise ModuleRegistryError(
                    f"Module {entry.name!r} benchmark artifact "
                    f"{benchmark.artifact!r} does not exist."
                )

        tests = self._declared_tests(metadata)
        if not tests:
            raise ModuleRegistryError(
                f"Module {entry.name!r} cannot be promoted to validated: "
                "module.yaml tests is empty."
            )
        self._run_declared_tests(entry, tests)

    @staticmethod
    def _resolve_declared_test(entry: RegisteredModule, rel: str) -> Path:
        path = Path(rel)
        if path.is_absolute() or ".." in path.parts:
            raise ModuleRegistryError(
                f"Module {entry.name!r}: declared test {rel!r} must be a "
                "safe relative path without '..'."
            )

        module_candidate = (entry.directory / path).resolve()
        if module_candidate.is_file():
            return module_candidate

        repo_candidate = (repo_root() / path).resolve()
        try:
            repo_candidate.relative_to(repo_root().resolve())
        except ValueError as exc:
            raise ModuleRegistryError(
                f"Module {entry.name!r}: declared test {rel!r} escapes the repo."
            ) from exc
        if repo_candidate.is_file():
            return repo_candidate

        raise ModuleRegistryError(
            f"Module {entry.name!r}: declared test {rel!r} does not exist "
            f"under {entry.directory} or the repository root."
        )

    @classmethod
    def _run_declared_tests(cls, entry: RegisteredModule, tests: list[str]) -> None:
        import subprocess
        import sys

        test_paths = [str(cls._resolve_declared_test(entry, rel)) for rel in tests]
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-x", "--tb=short", *test_paths],
            cwd=str(repo_root()),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ModuleRegistryError(
                f"Module {entry.name!r} cannot be promoted to validated: "
                f"declared tests failed (exit {result.returncode}).\n\n"
                f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
            )


__all__ = ["ModuleRegistry", "ModuleRegistryError", "RegisteredModule"]
