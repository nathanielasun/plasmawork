"""Regression for the post-Phase-5-close finding "security_sandbox role
remains disabled despite its own 'Always-on once any agent is enabled' rule".

`configs/agents.yaml` declares::

    - role: security_sandbox
      description: Prevents unsafe file or execution behavior.
                   Always-on once any agent is enabled.

For multiple phase closes the prose said "always-on" but no code
enforced it. As soon as Phase-4 / Phase-5 enabled paper_ingestion +
physics_interpretation + model_spec + module_retrieval, the
security_sandbox role should have flipped to enabled too. It didn't.

This test enforces the rule: if any non-sandbox role has
``enabled: true``, ``security_sandbox`` must also be ``enabled: true``.
"""

from __future__ import annotations

from pathlib import Path

import yaml

CONFIG = (
    Path(__file__).resolve().parents[2] / "configs" / "agents.yaml"
)


def _load_roles() -> list[dict]:
    data = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    return list(data.get("agents", []))


def test_security_sandbox_is_enabled_when_any_other_role_is_enabled():
    roles = _load_roles()
    enabled = {r["role"] for r in roles if r.get("enabled") is True}
    other_enabled = enabled - {"security_sandbox"}
    sandbox_enabled = "security_sandbox" in enabled
    if other_enabled:
        assert sandbox_enabled, (
            f"agents.yaml declares security_sandbox 'Always-on once any "
            f"agent is enabled' but {sorted(other_enabled)} are enabled "
            "and security_sandbox is not. Flip its `enabled:` to true."
        )


def test_security_sandbox_role_exists_in_yaml():
    roles = _load_roles()
    assert any(r["role"] == "security_sandbox" for r in roles), (
        "agents.yaml is missing the security_sandbox role; the always-on "
        "veto agent must be declared even if no other agent is enabled."
    )


def test_currently_phase_5_state_matches_invariant():
    """Smoke check: the current state of agents.yaml must satisfy the
    always-on invariant. Catches regressions where someone disables
    security_sandbox without disabling all the agents it covers."""
    roles = _load_roles()
    enabled_names = {r["role"] for r in roles if r.get("enabled") is True}
    if enabled_names - {"security_sandbox"}:
        assert "security_sandbox" in enabled_names
