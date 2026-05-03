"""``python -m simworkbench.tools.refresh_registry`` entrypoint.

Walks the registry, validates every ``tool.yaml``, and rewrites
``packages/internal_tools/registry/index.yaml`` from the fresh listing.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

from simworkbench.paths import repo_root

from .registry import ToolRegistry


def main() -> int:
    registry = ToolRegistry()
    registry.refresh()
    index = {
        "format_version": "0.1",
        "tools": registry.index(),
    }
    target = repo_root() / "packages" / "internal_tools" / "registry" / "index.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "# Internal Tool Registry — generated index.\n"
        "#\n"
        "# Regenerate via `scripts/dev/refresh_registry.sh`. Do not hand-edit;\n"
        "# changes here are overwritten on the next refresh. The source of truth\n"
        "# is each tool's `tool.yaml`.\n\n"
    )
    body = yaml.safe_dump(index, sort_keys=False)
    target.write_text(header + body, encoding="utf-8")
    print(f"[refresh_registry] {len(registry)} tool(s) → {target.relative_to(repo_root())}")
    for entry in registry:
        rel = Path(entry.directory).relative_to(repo_root())
        print(f"  - {entry.name} ({entry.metadata.type}, {entry.status.value}) — {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
