"""Phase 10 / 10E — Approval gate enforcement regressions.

Pins the contract laid out in plan §Phase 10 / 10E + the hard
"no client-supplied actor identity" rule from the Phase-6 audit:

  - Every gate action requires an out-of-band token.
  - Tokens are single-use.
  - Tokens are action-scoped AND subject-scoped (a token for action A
    on subject X does NOT unlock action A on subject Y).
  - Every action listed in `configs/agents.yaml`'s
    `human_approval_gates` block is recognised by the gate.
"""

from __future__ import annotations

import pytest
import yaml
from simworkbench.autonomy import (
    ApprovalGate,
    ApprovalRequiredError,
    grant_autonomy_approval,
)
from simworkbench.autonomy.approval_gates import KNOWN_ACTIONS
from simworkbench.paths import repo_root


def test_consume_without_grant_refuses(tmp_path):
    gate = ApprovalGate(state_dir=tmp_path / "approvals")
    with pytest.raises(ApprovalRequiredError, match="No human-approval token"):
        gate.consume(action="trusted_promotion", subject="some_module")


def test_grant_then_single_use_consume(tmp_path):
    state_dir = tmp_path / "approvals"
    grant_autonomy_approval(
        action="expensive_run",
        subject="capsule_42",
        reviewer="pytest",
        state_dir=state_dir,
    )
    gate = ApprovalGate(state_dir=state_dir)
    record = gate.consume(action="expensive_run", subject="capsule_42")
    assert record.reviewer == "pytest"
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="expensive_run", subject="capsule_42")


def test_token_is_subject_scoped(tmp_path):
    state_dir = tmp_path / "approvals"
    grant_autonomy_approval(
        action="external_export",
        subject="capsule_a",
        reviewer="pytest",
        state_dir=state_dir,
    )
    gate = ApprovalGate(state_dir=state_dir)
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="external_export", subject="capsule_b")


def test_token_is_action_scoped(tmp_path):
    state_dir = tmp_path / "approvals"
    grant_autonomy_approval(
        action="external_export",
        subject="capsule_a",
        reviewer="pytest",
        state_dir=state_dir,
    )
    gate = ApprovalGate(state_dir=state_dir)
    with pytest.raises(ApprovalRequiredError):
        gate.consume(action="destructive_edits", subject="capsule_a")


def test_unknown_action_refused(tmp_path):
    state_dir = tmp_path / "approvals"
    with pytest.raises(ApprovalRequiredError, match="Unknown approval action"):
        grant_autonomy_approval(
            action="totally_invalid",
            subject="capsule",
            reviewer="pytest",
            state_dir=state_dir,
        )


def test_empty_subject_refused(tmp_path):
    state_dir = tmp_path / "approvals"
    with pytest.raises(ApprovalRequiredError, match="non-empty"):
        grant_autonomy_approval(
            action="trusted_promotion",
            subject="",
            reviewer="pytest",
            state_dir=state_dir,
        )


def test_empty_reviewer_refused(tmp_path):
    state_dir = tmp_path / "approvals"
    with pytest.raises(ApprovalRequiredError, match="Reviewer name required"):
        grant_autonomy_approval(
            action="trusted_promotion",
            subject="some_module",
            reviewer="",
            state_dir=state_dir,
        )


def test_yaml_human_approval_gates_match_known_actions():
    """Every entry under `configs/agents.yaml` `human_approval_gates`
    is recognised by the autonomy gate. The two are kept in lockstep
    (Phase-5 audit lesson: "cross-cutting always-on prose has a
    regression test")."""
    config = yaml.safe_load(
        (repo_root() / "configs" / "agents.yaml").read_text(encoding="utf-8")
    )
    documented = set(config.get("human_approval_gates", {}).keys())
    leaks = documented - KNOWN_ACTIONS
    assert not leaks, (
        f"configs/agents.yaml documents approval gates the gate code "
        f"doesn't recognise: {leaks}. Add them to "
        "simworkbench.autonomy.approval_gates.KNOWN_ACTIONS."
    )
