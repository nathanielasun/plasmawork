"""Sandbox launcher for tool-authoring preview.

Production preview must not execute authored Python through the default
interpreter. This module is the narrow boundary between FastAPI and a
configured sandbox launcher. It never inherits the server environment.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from simworkbench.paths import repo_root


class PreviewSandboxUnavailable(RuntimeError):
    """Raised when production preview has no configured sandbox runtime."""


@dataclass(frozen=True)
class PreviewSandboxResult:
    """Result shape compatible with ``subprocess.CompletedProcess`` fields."""

    returncode: int
    stdout: str
    stderr: str


def preview_sandbox_configured() -> bool:
    """Return true when a production preview sandbox launcher is configured."""
    return bool(os.environ.get("WORKBENCH_PREVIEW_SANDBOX_COMMAND")) or (
        os.environ.get("WORKBENCH_PREVIEW_SANDBOX_RUNTIME") == "runsc"
    )


def run_preview_in_configured_sandbox(
    *,
    draft_root: Path,
    harness: str,
    result_path: Path,
    timeout_seconds: int,
) -> PreviewSandboxResult:
    """Run the preview through the configured sandbox launcher.

    ``WORKBENCH_PREVIEW_SANDBOX_COMMAND`` is an absolute/argv-style command
    for deployments that wrap gVisor elsewhere. It receives explicit paths
    and must write ``result_path``. ``WORKBENCH_PREVIEW_SANDBOX_RUNTIME=runsc``
    uses the local ``runsc`` binary directly.
    """
    command = os.environ.get("WORKBENCH_PREVIEW_SANDBOX_COMMAND")
    if command:
        return _run_external_launcher(
            command=command,
            draft_root=draft_root,
            harness=harness,
            result_path=result_path,
            timeout_seconds=timeout_seconds,
        )
    if os.environ.get("WORKBENCH_PREVIEW_SANDBOX_RUNTIME") == "runsc":
        return _run_runsc_launcher(
            draft_root=draft_root,
            harness=harness,
            result_path=result_path,
            timeout_seconds=timeout_seconds,
        )
    raise PreviewSandboxUnavailable(
        "Tool draft preview requires WORKBENCH_PREVIEW_SANDBOX_COMMAND or "
        "WORKBENCH_PREVIEW_SANDBOX_RUNTIME=runsc in gateway-required mode."
    )


def _closed_env() -> dict[str, str]:
    """Closed environment for trusted launchers; no server secrets inherit."""
    return {"PATH": "/usr/bin:/bin"}


def _core_src() -> Path:
    return repo_root() / "packages" / "core" / "src"


def _run_external_launcher(
    *,
    command: str,
    draft_root: Path,
    harness: str,
    result_path: Path,
    timeout_seconds: int,
) -> PreviewSandboxResult:
    argv = shlex.split(command)
    if not argv:
        raise PreviewSandboxUnavailable("WORKBENCH_PREVIEW_SANDBOX_COMMAND is empty.")
    raw_executable = Path(argv[0])
    executable = (
        str(raw_executable)
        if raw_executable.is_absolute() and raw_executable.is_file()
        else shutil.which(argv[0])
    )
    if executable is None:
        raise PreviewSandboxUnavailable(
            f"Preview sandbox launcher not found: {argv[0]!r}."
        )
    completed = subprocess.run(
        [
            executable,
            *argv[1:],
            "--draft-root",
            str(draft_root),
            "--harness",
            harness,
            "--result-path",
            str(result_path),
            "--core-src",
            str(_core_src()),
            "--runner-module",
            "simworkbench.tools.authoring_preview",
        ],
        cwd=str(repo_root()),
        env=_closed_env(),
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout_seconds,
    )
    return PreviewSandboxResult(
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def _run_runsc_launcher(
    *,
    draft_root: Path,
    harness: str,
    result_path: Path,
    timeout_seconds: int,
) -> PreviewSandboxResult:
    runsc = os.environ.get("WORKBENCH_RUNSC_BIN", "runsc")
    raw_executable = Path(runsc)
    executable = (
        str(raw_executable)
        if raw_executable.is_absolute() and raw_executable.is_file()
        else shutil.which(runsc)
    )
    if executable is None:
        raise PreviewSandboxUnavailable(
            "runsc binary not found; set WORKBENCH_RUNSC_BIN or "
            "WORKBENCH_PREVIEW_SANDBOX_COMMAND."
        )
    work_root = result_path.parent
    argv = [
        executable,
        "run",
        "--network=none",
        "--no-new-privs",
        f"--bundle={work_root}",
        f"--mount=type=bind,src={draft_root},dst=/draft,ro",
        f"--mount=type=bind,src={_core_src()},dst=/core,ro",
        f"--mount=type=bind,src={work_root},dst=/work",
        f"--wall-time={timeout_seconds}",
        "--",
        sys.executable,
        "-m",
        "simworkbench.tools.authoring_preview",
        "/draft",
        harness,
        "/work/result.json",
    ]
    completed = subprocess.run(
        argv,
        cwd=str(repo_root()),
        env=_closed_env(),
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout_seconds,
    )
    return PreviewSandboxResult(
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )
