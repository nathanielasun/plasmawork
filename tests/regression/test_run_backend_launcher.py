"""Regression coverage for the cross-shell backend launcher."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SH_WRAPPER = REPO_ROOT / "scripts" / "dev" / "run_backend.sh"
PY_LAUNCHER = REPO_ROOT / "scripts" / "dev" / "run_backend.py"


def make_capture_interpreter(tmp_path: Path) -> tuple[Path, Path]:
    capture_path = tmp_path / "argv.json"
    fake_python = tmp_path / "fake_python.py"
    fake_python.write_text(
        "\n".join(
            [
                "#!/usr/bin/env python3",
                "from __future__ import annotations",
                "import json",
                "import os",
                "import sys",
                "from pathlib import Path",
                "Path(os.environ['SIMWORKBENCH_ARGV_CAPTURE']).write_text(",
                "    json.dumps(sys.argv[1:]),",
                "    encoding='utf-8',",
                ")",
                "raise SystemExit(0)",
                "",
            ]
        ),
        encoding="utf-8",
    )
    fake_python.chmod(fake_python.stat().st_mode | stat.S_IXUSR)
    return fake_python, capture_path


@pytest.mark.skipif(os.name == "nt", reason="Unix shell wrapper is not used on Windows")
def test_unix_backend_wrapper_accepts_no_passthrough_args(tmp_path: Path) -> None:
    fake_python, capture_path = make_capture_interpreter(tmp_path)
    env = {
        **os.environ,
        "SIMWORKBENCH_PYTHON": str(fake_python),
        "SIMWORKBENCH_ARGV_CAPTURE": str(capture_path),
    }

    proc = subprocess.run(
        [str(SH_WRAPPER)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert json.loads(capture_path.read_text(encoding="utf-8")) == [
        "-m",
        "uvicorn",
        "simworkbench.api.server:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
        "--log-level",
        "info",
    ]


def test_python_launcher_preserves_passthrough_argument_boundaries(
    tmp_path: Path,
) -> None:
    fake_python, capture_path = make_capture_interpreter(tmp_path)
    env = {
        **os.environ,
        "SIMWORKBENCH_PYTHON": str(fake_python),
        "SIMWORKBENCH_ARGV_CAPTURE": str(capture_path),
    }

    proc = subprocess.run(
        [
            sys.executable,
            str(PY_LAUNCHER),
            "--host",
            "0.0.0.0",
            "--port",
            "8123",
            "--reload",
            "--",
            "--proxy-headers",
            "--root-path",
            "/plasma work",
        ],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert json.loads(capture_path.read_text(encoding="utf-8")) == [
        "-m",
        "uvicorn",
        "simworkbench.api.server:app",
        "--host",
        "0.0.0.0",
        "--port",
        "8123",
        "--log-level",
        "info",
        "--reload",
        "--proxy-headers",
        "--root-path",
        "/plasma work",
    ]


def test_backend_launcher_starts_api_server_not_example_runner(tmp_path: Path) -> None:
    fake_python, capture_path = make_capture_interpreter(tmp_path)
    env = {
        **os.environ,
        "SIMWORKBENCH_PYTHON": str(fake_python),
        "SIMWORKBENCH_ARGV_CAPTURE": str(capture_path),
    }

    proc = subprocess.run(
        [sys.executable, str(PY_LAUNCHER)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    command = json.loads(capture_path.read_text(encoding="utf-8"))
    assert "simworkbench.api.server:app" in command
    assert not any("examples/simple_rate_equations/run.py" in arg for arg in command)


def test_backend_shell_wrappers_delegate_to_python_launcher() -> None:
    sh_text = SH_WRAPPER.read_text(encoding="utf-8")
    assert "EXTRA_ARGS" not in sh_text
    assert "[@]" not in sh_text
    assert "run_backend.py" in sh_text
    assert (REPO_ROOT / "scripts" / "dev" / "run_backend.ps1").is_file()
    assert (REPO_ROOT / "scripts" / "dev" / "run_backend.cmd").is_file()
