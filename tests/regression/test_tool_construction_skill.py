"""Regression coverage for the repo-local tool-construction skill package."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILL_ROOT = REPO_ROOT / ".agents" / "skills" / "simworkbench-tool-construction"
CHECKER = SKILL_ROOT / "scripts" / "check_tool_package.py"
INSTALLER = REPO_ROOT / "scripts" / "dev" / "install_tool_construction_skill.sh"


def test_tool_construction_skill_shape_is_concise_and_discoverable() -> None:
    skill_md = SKILL_ROOT / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert "name: simworkbench-tool-construction" in text
    assert "description:" in text
    assert len(text.splitlines()) < 500
    assert not (SKILL_ROOT / "README.md").exists()
    assert (SKILL_ROOT / "agents" / "openai.yaml").is_file()

    for relative in (
        "references/tool_package_contract.md",
        "references/tool_ui_binding_contract.md",
        "references/security_and_provenance.md",
        "references/validation_checklist.md",
        "scripts/check_tool_package.py",
    ):
        assert (SKILL_ROOT / relative).is_file()
        assert relative in text

    for tag in (
        "TOOL-CONTRACT",
        "TOOL-UI-BINDING",
        "TOOL-ARTIFACT-IO",
        "TOOL-SECURITY",
        "TOOL-VALIDATION",
        "TOOL-PROMOTION",
    ):
        assert tag in text


def test_tool_package_checker_accepts_current_registry_tool() -> None:
    tool_path = (
        REPO_ROOT
        / "packages"
        / "internal_tools"
        / "registry"
        / "absorption_spectrum_diagnostic"
    )

    result = subprocess.run(
        [sys.executable, str(CHECKER), str(tool_path)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Tool package check passed" in result.stdout
    assert "(0 warning(s))" in result.stdout


def test_tool_package_checker_rejects_unitless_arrays_and_path_traversal(
    tmp_path: Path,
) -> None:
    package = tmp_path / "bad_tool"
    (package / "src").mkdir(parents=True)
    (package / "tests").mkdir()
    (package / "README.md").write_text("# Bad Tool\n", encoding="utf-8")
    (package / "src" / "tool.py").write_text("class BadTool: pass\n", encoding="utf-8")
    (package / "tests" / "test_bad_tool.py").write_text(
        "def test_placeholder():\n    assert True\n",
        encoding="utf-8",
    )
    (package / "tool.yaml").write_text(
        "\n".join(
            [
                "name: bad_tool",
                "version: 0.1.0",
                "type: diagnostic",
                "description: Bad test fixture.",
                "author: local",
                "status: draft",
                "entrypoint: ../outside.py:BadTool",
                "inputs:",
                "  - name: signal",
                "    type: array",
                "    description: Missing units.",
                "outputs:",
                "  - name: result",
                "    type: array",
                "    description: Missing units.",
                "compatible_domains: []",
                "requires:",
                "  python: []",
                "validation:",
                "  tests:",
                "    - ../escape.py",
                "  reference_cases: []",
                "artifacts:",
                "  outputs:",
                "    - name: rendered",
                "      kind: diagram",
                "      mime_type: text/html",
                "ui:",
                "  output_views:",
                "    - port: rendered",
                "      renderer: raw_html",
                "",
            ]
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, str(CHECKER), str(package)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "tool.yaml.entrypoint" in output
    assert "path traversal is not allowed" in output
    assert "array input/output ports must declare units" in output
    assert "unsafe renderer" in output
    assert "unsafe MIME type" in output


@pytest.mark.skipif(os.name == "nt", reason="Unix shell installer is not used on Windows")
def test_skill_installer_dry_run_does_not_mutate_codex_home(tmp_path: Path) -> None:
    codex_home = tmp_path / "codex-home"
    env = {**os.environ, "CODEX_HOME": str(codex_home)}

    result = subprocess.run(
        [str(INSTALLER), "--copy", "--dry-run"],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "dry-run: no files changed" in result.stdout
    assert not (codex_home / "skills" / "simworkbench-tool-construction").exists()
