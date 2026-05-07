#!/usr/bin/env python3
"""Validate one Scientific Simulation Workbench internal tool package."""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Literal

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - environment failure path
    print(
        "ERROR: PyYAML is required. Run inside the project environment "
        "or install simworkbench-core dependencies.",
        file=sys.stderr,
    )
    raise SystemExit(2) from None


Severity = Literal["error", "warning"]

REQUIRED_TOP_LEVEL: set[str] = {
    "name",
    "version",
    "type",
    "description",
    "author",
    "status",
    "entrypoint",
    "inputs",
    "outputs",
    "compatible_domains",
    "requires",
    "validation",
}
OPTIONAL_TOP_LEVEL: set[str] = {"io", "permissions", "ui", "artifacts"}
ALLOWED_TOP_LEVEL = REQUIRED_TOP_LEVEL | OPTIONAL_TOP_LEVEL

ALLOWED_STATUS = {"draft", "candidate", "validated", "trusted", "deprecated"}
ALLOWED_TYPES = {
    "agent",
    "automation",
    "diagnostic",
    "export",
    "import",
    "import_tool",
    "paper_extraction",
    "physics",
    "physics_module",
    "solver",
    "solver_adapter",
    "validation",
    "visualization",
}
ALLOWED_PORT_TYPES = {
    "array",
    "bool",
    "capsule",
    "diagram",
    "enum",
    "file",
    "figure",
    "heatmap",
    "image",
    "json",
    "particle_scatter",
    "report",
    "scalar",
    "string",
    "table",
    "timeseries",
}
ALLOWED_RENDERERS = {
    "diagram",
    "file",
    "flow",
    "graph",
    "heatmap",
    "image",
    "json",
    "line",
    "metric",
    "particle_scatter",
    "pipeline",
    "plot",
    "report",
    "scalar",
    "scatter",
    "schema",
    "table",
    "timeseries",
}
ALLOWED_ARTIFACT_KINDS = {
    "diagram",
    "file",
    "heatmap",
    "image",
    "json",
    "particle_scatter",
    "report",
    "scalar",
    "table",
    "timeseries",
}
DANGEROUS_RENDERERS = {
    "dangerouslysetinnerhtml",
    "html",
    "iframe",
    "javascript",
    "raw_html",
    "raw_svg",
    "script",
    "svg",
}
DANGEROUS_MIME_TYPES = {
    "application/ecmascript",
    "application/javascript",
    "image/svg+xml",
    "text/html",
    "text/javascript",
}
DANGEROUS_KEYS = {
    "actor",
    "actor_id",
    "content_hash",
    "created_at",
    "created_by",
    "current_version_id",
    "dangerouslysetinnerhtml",
    "raw_html",
    "role",
    "status",
    "storage_path",
    "updated_at",
    "updated_by",
    "user_id",
    "workspace_id",
}
PATH_FIELD_NAMES = {
    "artifact_path",
    "artifact_paths",
    "file_path",
    "path",
    "paths",
    "readme_path",
    "source_path",
    "storage_path",
    "target_path",
}
ENTRYPOINT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
URL_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


@dataclass(frozen=True)
class Issue:
    """One validation issue emitted by the checker."""

    severity: Severity
    location: str
    message: str


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point."""
    args = parse_args(argv)
    package_path = Path(args.tool_package)
    issues = validate_tool_package(package_path)

    if not args.quiet:
        for issue in issues:
            print(f"{issue.severity.upper()}: {issue.location}: {issue.message}")

    errors = [issue for issue in issues if issue.severity == "error"]
    warnings = [issue for issue in issues if issue.severity == "warning"]
    if errors or (args.warnings_as_errors and warnings):
        print(
            f"Tool package check failed: {len(errors)} error(s), "
            f"{len(warnings)} warning(s).",
            file=sys.stderr,
        )
        return 1

    if not args.quiet:
        print(
            f"Tool package check passed: {package_path} "
            f"({len(warnings)} warning(s))."
        )
    return 0


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tool_package", help="Path to a tool package directory.")
    parser.add_argument(
        "--warnings-as-errors",
        action="store_true",
        help="Treat package-completeness warnings as failures.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print the final failure summary, if any.",
    )
    return parser.parse_args(argv)


def validate_tool_package(package_path: Path) -> list[Issue]:
    """Validate a tool package and return errors/warnings."""
    issues: list[Issue] = []
    if not package_path.exists():
        return [Issue("error", str(package_path), "package path does not exist")]
    if not package_path.is_dir():
        return [Issue("error", str(package_path), "package path is not a directory")]

    yaml_path = package_path / "tool.yaml"
    if not yaml_path.is_file():
        return [Issue("error", str(yaml_path), "missing tool.yaml")]

    data = load_yaml_mapping(yaml_path, issues)
    if data is None:
        return issues

    validate_top_level(data, issues)
    validate_entrypoint(package_path, data.get("entrypoint"), issues)
    validate_ports(data.get("inputs"), "inputs", issues)
    validate_ports(data.get("outputs"), "outputs", issues)
    validate_validation_block(package_path, data.get("validation"), issues)
    validate_package_docs(package_path, issues)
    validate_optional_ui_metadata(data.get("ui"), issues)
    validate_optional_artifact_metadata(data.get("artifacts"), issues)
    validate_optional_permissions(data.get("permissions"), issues)
    scan_declared_paths(data, "tool.yaml", issues)
    return issues


def load_yaml_mapping(path: Path, issues: list[Issue]) -> Mapping[str, Any] | None:
    """Load YAML and require a mapping root."""
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        issues.append(Issue("error", str(path), f"YAML parse error: {exc}"))
        return None
    if not isinstance(loaded, Mapping):
        issues.append(Issue("error", str(path), "tool.yaml must parse to a mapping"))
        return None
    return loaded


def validate_top_level(data: Mapping[str, Any], issues: list[Issue]) -> None:
    """Validate required and unknown top-level fields."""
    missing = sorted(REQUIRED_TOP_LEVEL - set(data))
    for key in missing:
        issues.append(Issue("error", f"tool.yaml.{key}", "missing required field"))

    for key in sorted(set(data) - ALLOWED_TOP_LEVEL):
        issues.append(Issue("error", f"tool.yaml.{key}", "unknown top-level field"))

    for key in ("name", "version", "type", "description", "author", "status"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            issues.append(Issue("error", f"tool.yaml.{key}", "must be a non-blank string"))

    status = data.get("status")
    if isinstance(status, str) and status not in ALLOWED_STATUS:
        issues.append(
            Issue("error", "tool.yaml.status", f"unsupported lifecycle status {status!r}")
        )

    tool_type = data.get("type")
    if isinstance(tool_type, str) and tool_type not in ALLOWED_TYPES:
        issues.append(
            Issue("warning", "tool.yaml.type", f"unrecognized tool type {tool_type!r}")
        )

    if not isinstance(data.get("compatible_domains"), list):
        issues.append(
            Issue("error", "tool.yaml.compatible_domains", "must be a list")
        )
    if not isinstance(data.get("requires"), Mapping):
        issues.append(Issue("error", "tool.yaml.requires", "must be a mapping"))


def validate_entrypoint(
    package_path: Path, entrypoint: object, issues: list[Issue]
) -> None:
    """Validate `relative/path.py:ClassName` and target path locality."""
    if not isinstance(entrypoint, str) or ":" not in entrypoint:
        issues.append(
            Issue(
                "error",
                "tool.yaml.entrypoint",
                "must use relative/path.py:ClassName format",
            )
        )
        return

    module_path, class_name = entrypoint.rsplit(":", 1)
    if not class_name or not ENTRYPOINT_RE.match(class_name):
        issues.append(
            Issue("error", "tool.yaml.entrypoint", f"invalid class name {class_name!r}")
        )
    validate_relative_path(module_path, "tool.yaml.entrypoint", issues)
    if not module_path.endswith(".py"):
        issues.append(
            Issue("error", "tool.yaml.entrypoint", "module path must end with .py")
        )
        return

    target = package_path / module_path
    if not target.is_file():
        issues.append(
            Issue("error", "tool.yaml.entrypoint", f"entrypoint file missing: {module_path}")
        )


def validate_ports(value: object, field_name: str, issues: list[Issue]) -> None:
    """Validate `inputs` or `outputs` port lists."""
    if not isinstance(value, list) or not value:
        issues.append(Issue("error", f"tool.yaml.{field_name}", "must be a non-empty list"))
        return

    seen: set[str] = set()
    for index, port in enumerate(value):
        location = f"tool.yaml.{field_name}[{index}]"
        if not isinstance(port, Mapping):
            issues.append(Issue("error", location, "port must be a mapping"))
            continue

        for key in ("name", "type", "description"):
            if not isinstance(port.get(key), str) or not str(port.get(key)).strip():
                issues.append(Issue("error", f"{location}.{key}", "must be non-blank"))

        name = port.get("name")
        if isinstance(name, str):
            if name in seen:
                issues.append(Issue("error", f"{location}.name", f"duplicate port {name!r}"))
            seen.add(name)

        port_type = port.get("type")
        if isinstance(port_type, str) and port_type not in ALLOWED_PORT_TYPES:
            issues.append(
                Issue("warning", f"{location}.type", f"unrecognized port type {port_type!r}")
            )
        if port_type == "array":
            units = port.get("units")
            if not isinstance(units, str) or not units.strip():
                issues.append(
                    Issue(
                        "error",
                        f"{location}.units",
                        "array input/output ports must declare units",
                    )
                )


def validate_validation_block(
    package_path: Path, value: object, issues: list[Issue]
) -> None:
    """Validate declared test/reference paths."""
    if not isinstance(value, Mapping):
        issues.append(Issue("error", "tool.yaml.validation", "must be a mapping"))
        return

    tests = value.get("tests")
    if not isinstance(tests, list) or not tests:
        issues.append(
            Issue("error", "tool.yaml.validation.tests", "must list at least one test")
        )
    else:
        validate_existing_relative_paths(
            package_path, tests, "tool.yaml.validation.tests", issues
        )

    reference_cases = value.get("reference_cases", [])
    if not isinstance(reference_cases, list):
        issues.append(
            Issue("error", "tool.yaml.validation.reference_cases", "must be a list")
        )
    else:
        validate_existing_relative_paths(
            package_path,
            reference_cases,
            "tool.yaml.validation.reference_cases",
            issues,
        )


def validate_package_docs(package_path: Path, issues: list[Issue]) -> None:
    """Validate README and warn on optional docs/tests/examples gaps."""
    if not (package_path / "README.md").is_file():
        issues.append(Issue("error", "README.md", "missing package README"))

    for directory in ("tests", "examples", "docs"):
        if not (package_path / directory).exists():
            issues.append(
                Issue(
                    "warning",
                    directory,
                    f"missing {directory}/ directory; add it for new tools when feasible",
                )
            )

    for filename in ("assumptions.md", "changelog.md"):
        if not (package_path / filename).is_file():
            issues.append(
                Issue(
                    "warning",
                    filename,
                    f"missing {filename}; add it before lifecycle promotion",
                )
            )


def validate_optional_ui_metadata(value: object, issues: list[Issue]) -> None:
    """Validate optional UI hints if present."""
    if value is None:
        return
    if not isinstance(value, Mapping):
        issues.append(Issue("error", "tool.yaml.ui", "must be a mapping when present"))
        return

    scan_for_dangerous_metadata(value, "tool.yaml.ui", issues)

    input_groups = value.get("input_groups", [])
    if input_groups and not isinstance(input_groups, list):
        issues.append(Issue("error", "tool.yaml.ui.input_groups", "must be a list"))
    elif isinstance(input_groups, list):
        for index, group in enumerate(input_groups):
            location = f"tool.yaml.ui.input_groups[{index}]"
            if not isinstance(group, Mapping):
                issues.append(Issue("error", location, "must be a mapping"))
                continue
            for key in ("id", "title"):
                if not isinstance(group.get(key), str) or not group.get(key, "").strip():
                    issues.append(Issue("error", f"{location}.{key}", "must be non-blank"))
            if "ports" in group and not all_string_list(group["ports"]):
                issues.append(Issue("error", f"{location}.ports", "must be a list of strings"))

    output_views = value.get("output_views", [])
    if output_views and not isinstance(output_views, list):
        issues.append(Issue("error", "tool.yaml.ui.output_views", "must be a list"))
    elif isinstance(output_views, list):
        for index, view in enumerate(output_views):
            validate_output_view(view, f"tool.yaml.ui.output_views[{index}]", issues)


def validate_output_view(value: object, location: str, issues: list[Issue]) -> None:
    """Validate one UI output view declaration."""
    if not isinstance(value, Mapping):
        issues.append(Issue("error", location, "must be a mapping"))
        return

    renderer = value.get("renderer")
    if not isinstance(renderer, str) or not renderer.strip():
        issues.append(Issue("error", f"{location}.renderer", "must be non-blank"))
        return

    normalized = normalize_token(renderer)
    if normalized in DANGEROUS_RENDERERS:
        issues.append(Issue("error", f"{location}.renderer", f"unsafe renderer {renderer!r}"))
    elif renderer not in ALLOWED_RENDERERS:
        issues.append(Issue("error", f"{location}.renderer", f"unsupported renderer {renderer!r}"))


def validate_optional_artifact_metadata(value: object, issues: list[Issue]) -> None:
    """Validate optional artifact metadata if present."""
    if value is None:
        return
    if not isinstance(value, Mapping):
        issues.append(
            Issue("error", "tool.yaml.artifacts", "must be a mapping when present")
        )
        return

    scan_for_dangerous_metadata(value, "tool.yaml.artifacts", issues)

    outputs = value.get("outputs", [])
    if outputs and not isinstance(outputs, list):
        issues.append(Issue("error", "tool.yaml.artifacts.outputs", "must be a list"))
        return
    if not isinstance(outputs, list):
        return

    for index, output in enumerate(outputs):
        location = f"tool.yaml.artifacts.outputs[{index}]"
        if not isinstance(output, Mapping):
            issues.append(Issue("error", location, "must be a mapping"))
            continue
        for key in ("name", "kind"):
            if not isinstance(output.get(key), str) or not output.get(key, "").strip():
                issues.append(Issue("error", f"{location}.{key}", "must be non-blank"))

        kind = output.get("kind")
        if isinstance(kind, str) and kind not in ALLOWED_ARTIFACT_KINDS:
            issues.append(Issue("error", f"{location}.kind", f"unsupported kind {kind!r}"))

        mime_type = output.get("mime_type")
        if isinstance(mime_type, str) and mime_type.lower() in DANGEROUS_MIME_TYPES:
            issues.append(
                Issue("error", f"{location}.mime_type", f"unsafe MIME type {mime_type!r}")
            )


def validate_optional_permissions(value: object, issues: list[Issue]) -> None:
    """Validate optional permissions metadata if present."""
    if value is None:
        return
    if not isinstance(value, Mapping):
        issues.append(
            Issue("error", "tool.yaml.permissions", "must be a mapping when present")
        )
        return

    high_risk = value.get("high_risk_actions", [])
    if high_risk and not isinstance(high_risk, list):
        issues.append(
            Issue("error", "tool.yaml.permissions.high_risk_actions", "must be a list")
        )
        return
    approvals = value.get("approval_required", [])
    if approvals and not isinstance(approvals, list):
        issues.append(
            Issue("error", "tool.yaml.permissions.approval_required", "must be a list")
        )
        return
    if high_risk and not approvals:
        issues.append(
            Issue(
                "error",
                "tool.yaml.permissions.approval_required",
                "high-risk actions must list approval declarations",
            )
        )
        return
    if isinstance(high_risk, list) and isinstance(approvals, list):
        missing = sorted(set(map(str, high_risk)) - set(map(str, approvals)))
        if missing:
            issues.append(
                Issue(
                    "error",
                    "tool.yaml.permissions.approval_required",
                    f"missing approval declarations for {missing!r}",
                )
            )


def validate_existing_relative_paths(
    package_path: Path,
    paths: Sequence[object],
    location: str,
    issues: list[Issue],
) -> None:
    """Validate path strings and require each target to exist."""
    for index, item in enumerate(paths):
        item_location = f"{location}[{index}]"
        if not isinstance(item, str):
            issues.append(Issue("error", item_location, "must be a string path"))
            continue
        if validate_relative_path(item, item_location, issues):
            if not (package_path / item).is_file():
                issues.append(Issue("error", item_location, f"declared file missing: {item}"))


def validate_relative_path(value: str, location: str, issues: list[Issue]) -> bool:
    """Validate an obvious-safe package-relative path string."""
    valid = True
    if not value.strip():
        issues.append(Issue("error", location, "path must not be blank"))
        return False
    if "\x00" in value:
        issues.append(Issue("error", location, "path contains a null byte"))
        valid = False
    if value.startswith("~"):
        issues.append(Issue("error", location, "path must not use home expansion"))
        valid = False
    if URL_SCHEME_RE.match(value):
        issues.append(Issue("error", location, "path must not use a URL or drive scheme"))
        valid = False
    if PurePosixPath(value).is_absolute() or PureWindowsPath(value).is_absolute():
        issues.append(Issue("error", location, "path must be relative"))
        valid = False

    parts = PurePosixPath(value.replace("\\", "/")).parts
    if ".." in parts:
        issues.append(Issue("error", location, "path traversal is not allowed"))
        valid = False
    return valid


def scan_declared_paths(value: object, location: str, issues: list[Issue]) -> None:
    """Recursively scan declared path-like fields for traversal patterns."""
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_str = str(key)
            child_location = f"{location}.{key_str}"
            key_lower = key_str.lower()
            if key_lower in PATH_FIELD_NAMES or key_lower.endswith("_path"):
                validate_path_value(item, child_location, issues)
            else:
                scan_declared_paths(item, child_location, issues)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            scan_declared_paths(item, f"{location}[{index}]", issues)


def validate_path_value(value: object, location: str, issues: list[Issue]) -> None:
    """Validate a path-like field that may be a string or list of strings."""
    if isinstance(value, str):
        validate_relative_path(value, location, issues)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            validate_path_value(item, f"{location}[{index}]", issues)
    elif value is not None:
        issues.append(Issue("error", location, "path-like field must be a string or list"))


def scan_for_dangerous_metadata(value: object, location: str, issues: list[Issue]) -> None:
    """Reject client-owned security facts and executable UI hints."""
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_str = str(key)
            key_token = normalize_token(key_str)
            child_location = f"{location}.{key_str}"
            if key_token in DANGEROUS_KEYS:
                issues.append(
                    Issue(
                        "error",
                        child_location,
                        "client-owned security/storage/UI field is not allowed",
                    )
                )
            scan_for_dangerous_metadata(item, child_location, issues)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            scan_for_dangerous_metadata(item, f"{location}[{index}]", issues)


def normalize_token(value: str) -> str:
    """Normalize a metadata token for deny-list checks."""
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def all_string_list(value: object) -> bool:
    """Return true when value is a list of strings."""
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


if __name__ == "__main__":
    raise SystemExit(main())
