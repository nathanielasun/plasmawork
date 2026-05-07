#!/usr/bin/env python3
"""Cross-shell backend launcher for Scientific Simulation Workbench.

This script owns backend launcher argument parsing so platform-specific shell
wrappers can stay small. It runs an example under `examples/<name>/run.py`
using the project Python interpreter selected in this order:

1. SIMWORKBENCH_PYTHON
2. .venv/Scripts/python.exe or .venv/bin/python
3. the current Python executable, then bare `python`
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

DEFAULT_EXAMPLE = "simple_rate_equations"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def usage() -> str:
    return f"""scripts/dev/run_backend.py

Run a workbench backend example end-to-end.

Usage:
  python scripts/dev/run_backend.py [--example NAME] [-- EXAMPLE_ARGS...]
  python scripts/dev/run_backend.py --example {DEFAULT_EXAMPLE} --max-steps 25 --no-capsule

Shell wrappers:
  macOS/Linux/Git Bash: ./scripts/dev/run_backend.sh
  PowerShell:           ./scripts/dev/run_backend.ps1
  cmd.exe:              scripts\\dev\\run_backend.cmd
"""


def parse_args(argv: list[str]) -> tuple[str, list[str]]:
    example = DEFAULT_EXAMPLE
    passthrough: list[str] = []
    idx = 0
    while idx < len(argv):
        arg = argv[idx]
        if arg in {"-h", "--help"}:
            print(usage(), end="")
            raise SystemExit(0)
        if arg == "--example":
            if idx + 1 >= len(argv):
                print("run_backend.py: --example requires a name", file=sys.stderr)
                raise SystemExit(2)
            example = argv[idx + 1]
            idx += 2
            continue
        if arg == "--":
            passthrough.extend(argv[idx + 1 :])
            break
        passthrough.append(arg)
        idx += 1
    return example, passthrough


def resolve_backend_python(root: Path) -> str:
    override = os.environ.get("SIMWORKBENCH_PYTHON", "").strip()
    if override:
        return override

    candidates = [
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "Scripts" / "python",
        root / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    if sys.executable:
        return sys.executable
    return "python"


def list_examples(root: Path) -> str:
    examples_root = root / "examples"
    if not examples_root.is_dir():
        return "<examples directory missing>"
    return ", ".join(sorted(path.name for path in examples_root.iterdir() if path.is_dir()))


def main(argv: list[str] | None = None) -> int:
    root = repo_root()
    example, passthrough = parse_args(list(sys.argv[1:] if argv is None else argv))
    runner = root / "examples" / example / "run.py"
    if not runner.is_file():
        print(f"No runnable example at {runner}", file=sys.stderr)
        print(f"Available: {list_examples(root)}", file=sys.stderr)
        return 1

    backend_python = resolve_backend_python(root)
    command = [backend_python, str(runner), *passthrough]
    try:
        return subprocess.call(command, cwd=root)
    except FileNotFoundError:
        print(f"Python interpreter not found: {backend_python}", file=sys.stderr)
        return 127


if __name__ == "__main__":
    raise SystemExit(main())
