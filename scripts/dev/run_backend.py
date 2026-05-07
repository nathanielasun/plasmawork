#!/usr/bin/env python3
"""Cross-shell backend API launcher for Scientific Simulation Workbench.

This script owns backend launcher argument parsing so platform-specific shell
wrappers can stay small. It starts the FastAPI workbench backend with uvicorn
using the project Python interpreter selected in this order:

1. SIMWORKBENCH_PYTHON
2. .venv/Scripts/python.exe or .venv/bin/python
3. the current Python executable, then bare `python`
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_APP = "simworkbench.api.server:app"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="scripts/dev/run_backend.py",
        description="Run the workbench FastAPI backend with uvicorn.",
        epilog=(
            "Simulation examples are separate. "
            "Use `python examples/<name>/run.py` for one-off runs."
        ),
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--log-level", default="info")
    parser.add_argument(
        "uvicorn_args",
        nargs=argparse.REMAINDER,
        help="extra arguments forwarded to uvicorn; prefix with --",
    )
    args = parser.parse_args(argv)
    if args.uvicorn_args[:1] == ["--"]:
        args.uvicorn_args = args.uvicorn_args[1:]
    return args



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


def main(argv: list[str] | None = None) -> int:
    root = repo_root()
    args = parse_args(list(sys.argv[1:] if argv is None else argv))

    backend_python = resolve_backend_python(root)
    command = [
        backend_python,
        "-m",
        "uvicorn",
        DEFAULT_APP,
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--log-level",
        args.log_level,
    ]
    if args.reload:
        command.append("--reload")
    command.extend(args.uvicorn_args)
    try:
        return subprocess.call(command, cwd=root)
    except FileNotFoundError:
        print(f"Python interpreter not found: {backend_python}", file=sys.stderr)
        return 127


if __name__ == "__main__":
    raise SystemExit(main())
