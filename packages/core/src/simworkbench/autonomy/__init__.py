"""Phase 10 — Autonomous Computational Experiment Design.

Public API for the autonomy layer. Every privileged action funnels
through the approval gate; every autonomous output is data, never a
silent mutation of the user's tree.

Plan §Phase 10 workstreams covered:
  10A — ``ExperimentDesigner`` / ``ExperimentPlan``
  10B — ``SmokeRunner`` / ``SmokeReport``
  10C — ``ControlledSweepAgent`` / ``ControlledSweepResult``
  10D — ``ScientificReviewer`` / ``ScientificReview``
  10E — ``ApprovalGate`` / ``grant_autonomy_approval`` /
        ``ApprovalRequiredError``
"""

from __future__ import annotations

from .approval_gates import (
    KNOWN_ACTIONS,
    ApprovalGate,
    ApprovalRecord,
    ApprovalRequiredError,
    grant_autonomy_approval,
)
from .experiment_design import (
    CapsuleStatus,
    CostEstimate,
    ExperimentDesigner,
    ExperimentPlan,
    FidelityStep,
    capsule_status_for_plan,
)
from .scientific_review import ScientificReview, ScientificReviewer
from .smoke_runs import SmokeReport, SmokeRunner
from .sweep_agent import ControlledSweepAgent, ControlledSweepResult

__all__ = [
    "ApprovalGate",
    "ApprovalRecord",
    "ApprovalRequiredError",
    "CapsuleStatus",
    "ControlledSweepAgent",
    "ControlledSweepResult",
    "CostEstimate",
    "ExperimentDesigner",
    "ExperimentPlan",
    "FidelityStep",
    "KNOWN_ACTIONS",
    "ScientificReview",
    "ScientificReviewer",
    "SmokeReport",
    "SmokeRunner",
    "capsule_status_for_plan",
    "grant_autonomy_approval",
]
