"""Phase 2C — Report exporter.

Generates a markdown report (``REPORT.md``) summarizing the capsule:
manifest fields, validation status, key diagnostics, exploratory/validated
state. Phase 2 is Markdown-only; Phase 7+ may add a PDF renderer.
"""

from __future__ import annotations

from pathlib import Path

from simworkbench.paths import is_under_workbench
from simworkbench.serialization.manifest import load_manifest
from simworkbench.serialization.validator import CapsuleValidator


def export_report(
    capsule_dir: str | Path,
    target: str | Path,
    *,
    report_name: str = "REPORT.md",
    require_workbench_target: bool = True,
) -> Path:
    """Write ``<target>/<report_name>`` and return its path."""
    capsule_path = Path(capsule_dir)
    out_path = Path(target) / report_name
    if require_workbench_target and not is_under_workbench(out_path):
        raise PermissionError(
            f"Refusing to write report outside workbench-managed roots: {out_path}"
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    manifest = load_manifest(capsule_path / "manifest.toml")
    report = CapsuleValidator().validate(capsule_path)

    lines: list[str] = [
        f"# Capsule report: `{manifest.capsule.name}`",
        "",
        f"- Format version: `{manifest.capsule.format_version}`",
        f"- Workbench version: `{manifest.capsule.workbench_version}`",
        f"- Created at: `{manifest.capsule.created_at}`",
        "",
        "## Model",
        "",
        f"- Name: `{manifest.model.name}`",
        f"- Domain: `{manifest.model.domain}`",
        f"- Schema version: `{manifest.model.schema_version}`",
        "",
        "## Runtime",
        "",
        f"- Backend: `{manifest.runtime.backend}`",
        f"- Default seed: `{manifest.runtime.default_seed}`",
        f"- Final state: `{manifest.runtime.final_state}`",
        f"- t_final: `{manifest.runtime.final_simulation_time_seconds:.6g} s`",
        f"- Elapsed wall-time: `{manifest.runtime.elapsed_seconds:.3f} s`",
        f"- Placeholder used: `{manifest.runtime.placeholder_used}`",
    ]
    if manifest.runtime.placeholders:
        lines.append(
            f"- Placeholder interactions: `{', '.join(manifest.runtime.placeholders)}`"
        )
    lines.extend(
        [
            "",
            "## Validation",
            "",
            f"- Validator status: `{'ok' if report.ok else 'failed'}`",
            f"- Errors: {len(report.errors)}",
            f"- Warnings: {len(report.warnings)}",
        ]
    )
    if report.errors:
        lines.append("")
        lines.append("### Errors")
        for v in report.errors:
            lines.append(f"- `{v.code}` — {v.message}" + (f" ({v.path})" if v.path else ""))
    if report.warnings:
        lines.append("")
        lines.append("### Warnings")
        for v in report.warnings:
            lines.append(f"- `{v.code}` — {v.message}" + (f" ({v.path})" if v.path else ""))

    if manifest.runtime.placeholder_used:
        lines.extend(
            [
                "",
                "## Exploratory run notice",
                "",
                "This run used placeholder rate constants. Treat the diagnostics "
                "as exploratory only — do not cite them as a validated physics "
                "result. Real coefficients are wired in Phase 4+ paper ingestion.",
            ]
        )

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path


__all__ = ["export_report"]
