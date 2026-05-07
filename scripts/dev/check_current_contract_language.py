#!/usr/bin/env python3
"""Scan current user-facing surfaces for deprecated phase-state language.

Historical provenance files intentionally preserve old wording. This scanner
only covers current contract zones: user docs, command output/help, UI copy,
runtime errors, and current module/tool/backend metadata.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


CURRENT_ZONE_PATHS = (
    "README.md",
    "LIMITATIONS.md",
    "AGENTS.md",
    "CLAUDE.md",
    "docs_site/src/content",
    "apps/workbench-ui/src",
    "scripts",
    "packages",
)

HISTORICAL_OR_GENERATED_PARTS = {
    "program_development",
    "bugs_and_fixes",
    "tests",
    "node_modules",
    "__pycache__",
    ".git",
    "dist",
    "build",
}

IGNORED_RELATIVE_PATHS = {
    # These files own the scanner/checker/test vocabulary and intentionally
    # contain the patterns they guard against.
    "scripts/dev/check_current_contract_language.py",
    "scripts/dev/check_repo_conventions.sh",
}

TEXT_SUFFIXES = {
    "",
    ".bash",
    ".cmd",
    ".css",
    ".json",
    ".md",
    ".mdx",
    ".mjs",
    ".py",
    ".ps1",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}


@dataclass(frozen=True)
class ForbiddenPattern:
    name: str
    regex: re.Pattern[str]
    guidance: str


FORBIDDEN_PATTERNS = (
    ForbiddenPattern(
        name="active-old-phase",
        regex=re.compile(r"\bcurrently active\b", re.IGNORECASE),
        guidance="describe current capability/status directly",
    ),
    ForbiddenPattern(
        name="pending-status",
        regex=re.compile(r"\bPending\."),
        guidance="use current status labels: candidate, deployment-gated, unsupported",
    ),
    ForbiddenPattern(
        name="unimplemented-success-stub",
        regex=re.compile(r"\bnot implemented yet\b", re.IGNORECASE),
        guidance="fail closed with a current blocker instead of phase-era stub text",
    ),
    ForbiddenPattern(
        name="scheduled-phase",
        regex=re.compile(r"\bscheduled for Phase\b", re.IGNORECASE),
        guidance="current commands cannot advertise old scheduled phase stubs",
    ),
    ForbiddenPattern(
        name="future-phase-promise",
        regex=re.compile(r"\blands? in Phase\b", re.IGNORECASE),
        guidance="current surfaces should state capability or limitation now",
    ),
    ForbiddenPattern(
        name="wait-for-phase",
        regex=re.compile(r"\bwait for Phase\b", re.IGNORECASE),
        guidance="route users to a current module/backend/workaround",
    ),
    ForbiddenPattern(
        name="phase-zero-placeholder",
        regex=re.compile(r"\bPhase 0 placeholder\b", re.IGNORECASE),
        guidance="shipped UI/code should not present as Phase-0 placeholder",
    ),
    ForbiddenPattern(
        name="ui-placeholder",
        regex=re.compile(r"\bUI placeholder\b", re.IGNORECASE),
        guidance="UI surfaces should bind to an API or render disabled state",
    ),
    ForbiddenPattern(
        name="shell-skeleton",
        regex=re.compile(r"\bworkbench shell skeleton\b", re.IGNORECASE),
        guidance="current UI copy should not call shipped panels skeletons",
    ),
    ForbiddenPattern(
        name="old-backend-fetch-copy",
        regex=re.compile(r"\bBackend file fetch lands\b", re.IGNORECASE),
        guidance="current code viewers should use the capsule file API",
    ),
    ForbiddenPattern(
        name="old-file-fetch-copy",
        regex=re.compile(r"\bfile content fetching is wired\b", re.IGNORECASE),
        guidance="current code viewers should use the capsule file API",
    ),
    ForbiddenPattern(
        name="phase-pending-row",
        regex=re.compile(r"\bPhase\s+\d+[A-Z]?\b.{0,80}\bPending\b", re.IGNORECASE),
        guidance="phase status tables in current docs must be up to date",
    ),
    ForbiddenPattern(
        name="phase-next-row",
        regex=re.compile(r"\|\s*10\s*\|\s*Next\s*\|", re.IGNORECASE),
        guidance="Phase 10 is closed in the current contract",
    ),
    ForbiddenPattern(
        name="old-workstream-1c-runtime-copy",
        regex=re.compile(r"\bRuntime execution lands in Workstream 1C\b"),
        guidance="runtime execution is current behavior, not future work",
    ),
    ForbiddenPattern(
        name="nonexistent-krf-capsule-example",
        regex=re.compile(r"examples/krf_excimer/krf_excimer\.lxp"),
        guidance="examples should reference real paths or generated placeholders",
    ),
    ForbiddenPattern(
        name="old-capsule-export-contract",
        regex=re.compile(r"\./scripts/export/capsule\.sh <capsule_name>"),
        guidance="export command requires capsule_dir and target_dir",
    ),
    ForbiddenPattern(
        name="old-autonomy-endpoint-count",
        regex=re.compile(r"\bdrives three new endpoints\b", re.IGNORECASE),
        guidance="autonomy docs must include the smoke endpoint",
    ),
)


def _is_ignored(path: Path) -> bool:
    rel = path.relative_to(REPO_ROOT).as_posix()
    if rel in IGNORED_RELATIVE_PATHS:
        return True
    return any(part in HISTORICAL_OR_GENERATED_PARTS for part in path.parts)


def _iter_current_files() -> list[Path]:
    files: list[Path] = []
    for zone in CURRENT_ZONE_PATHS:
        root = REPO_ROOT / zone
        if root.is_file():
            candidates = [root]
        elif root.is_dir():
            candidates = [p for p in root.rglob("*") if p.is_file()]
        else:
            continue
        for path in candidates:
            if _is_ignored(path):
                continue
            if path.suffix not in TEXT_SUFFIXES:
                continue
            files.append(path)
    return sorted(files)


def main() -> int:
    violations: list[str] = []
    for path in _iter_current_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            for pattern in FORBIDDEN_PATTERNS:
                if pattern.regex.search(line):
                    violations.append(
                        f"{rel}:{line_no}: {pattern.name}: {pattern.guidance}\n"
                        f"    {line.strip()}"
                    )

    if violations:
        print("Deprecated phase-state language found in current contract zones:")
        print("\n".join(violations))
        return 1

    print("Current contract language check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
