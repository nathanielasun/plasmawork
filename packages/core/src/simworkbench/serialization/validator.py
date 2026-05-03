"""Phase 2A — Capsule directory validator.

Walks a `.lxp/` capsule directory and reports structural / schema
violations. The validator is the source of truth for "is this a well-formed
capsule"; the Phase 1F UI's ValidationView (Phase 2D) renders its output.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from simworkbench.serialization.manifest import (
    CAPSULE_FORMAT_VERSION,
    Manifest,
    load_manifest,
)


@dataclass
class Violation:
    """One structured validation finding."""

    severity: str  # "error" or "warning"
    code: str  # short machine-readable identifier
    message: str
    path: str | None = None  # capsule-relative path that triggered the finding


@dataclass
class ValidationReport:
    """Result of validating a capsule directory.

    ``ok`` is True iff there are no error-severity violations. Warnings do
    not affect ``ok``; they let callers (e.g. the UI) surface incomplete-but-
    not-broken capsules.
    """

    capsule_path: Path
    manifest: Manifest | None
    violations: list[Violation] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(v.severity == "error" for v in self.violations)

    @property
    def errors(self) -> list[Violation]:
        return [v for v in self.violations if v.severity == "error"]

    @property
    def warnings(self) -> list[Violation]:
        return [v for v in self.violations if v.severity == "warning"]


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


REQUIRED_SUBDIRS: tuple[str, ...] = (
    "model",
    "configs",
    "results",
    "provenance",
)
RECOMMENDED_SUBDIRS: tuple[str, ...] = (
    "paper_sources",
    "src/generated",
    "src/user_edits",
    "data",
    "validation",
    "notebooks",
)
REQUIRED_FILES: tuple[str, ...] = (
    "manifest.toml",
    "model/model_spec.yaml",
    "configs/run_config.yaml",
    "results/diagnostics.json",
    "provenance/provenance.lock",
    "provenance/agent_trace.md",
    "README.md",
)


class CapsuleValidator:
    """Validates a `.lxp/` capsule directory.

    Use::

        report = CapsuleValidator().validate(capsule_dir)
        if not report.ok:
            for v in report.errors:
                print(v.code, v.message, v.path)
    """

    def validate(self, capsule_dir: str | Path) -> ValidationReport:
        capsule_path = Path(capsule_dir).resolve()
        report = ValidationReport(capsule_path=capsule_path, manifest=None)

        if not capsule_path.is_dir():
            report.violations.append(
                Violation(
                    severity="error",
                    code="missing_capsule_directory",
                    message=f"Capsule directory does not exist: {capsule_path}",
                    path=None,
                )
            )
            return report

        # Required files first — without them, downstream checks have nothing
        # to validate against.
        for relative in REQUIRED_FILES:
            if not (capsule_path / relative).is_file():
                report.violations.append(
                    Violation(
                        severity="error",
                        code="missing_required_file",
                        message=f"Required capsule file is missing: {relative}",
                        path=relative,
                    )
                )

        # Required subdirectories.
        for relative in REQUIRED_SUBDIRS:
            if not (capsule_path / relative).is_dir():
                report.violations.append(
                    Violation(
                        severity="error",
                        code="missing_required_subdir",
                        message=f"Required capsule subdirectory is missing: {relative}",
                        path=relative,
                    )
                )

        # Recommended subdirectories — warnings only.
        for relative in RECOMMENDED_SUBDIRS:
            if not (capsule_path / relative).is_dir():
                report.violations.append(
                    Violation(
                        severity="warning",
                        code="missing_recommended_subdir",
                        message=(
                            f"Recommended capsule subdirectory missing: {relative}. "
                            "Phase 2+ exporters expect it to exist as an empty "
                            "placeholder."
                        ),
                        path=relative,
                    )
                )

        # Manifest schema check (only if manifest.toml exists).
        manifest_path = capsule_path / "manifest.toml"
        if manifest_path.is_file():
            try:
                manifest = load_manifest(manifest_path)
            except Exception as exc:  # noqa: BLE001 — we structured-report it.
                report.violations.append(
                    Violation(
                        severity="error",
                        code="manifest_schema_invalid",
                        message=f"manifest.toml does not validate: {exc}",
                        path="manifest.toml",
                    )
                )
            else:
                report.manifest = manifest
                if manifest.capsule.format_version != CAPSULE_FORMAT_VERSION:
                    report.violations.append(
                        Violation(
                            severity="error",
                            code="unsupported_format_version",
                            message=(
                                f"manifest.capsule.format_version "
                                f"{manifest.capsule.format_version!r} is not supported "
                                f"(this build expects {CAPSULE_FORMAT_VERSION!r}). "
                                "Run a migration before reopening the capsule."
                            ),
                            path="manifest.toml",
                        )
                    )

                # ModelSpec pointed at by the manifest must exist.
                model_path = capsule_path / manifest.model.model_spec_path
                if not model_path.is_file():
                    report.violations.append(
                        Violation(
                            severity="error",
                            code="missing_referenced_model_spec",
                            message=(
                                f"manifest.model.model_spec_path points at "
                                f"{manifest.model.model_spec_path!r}, but that file is "
                                "not present in the capsule."
                            ),
                            path=manifest.model.model_spec_path,
                        )
                    )

        return report


__all__ = [
    "CapsuleValidator",
    "RECOMMENDED_SUBDIRS",
    "REQUIRED_FILES",
    "REQUIRED_SUBDIRS",
    "ValidationReport",
    "Violation",
]
