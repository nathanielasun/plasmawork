"""Phase 5 — ModelSpec Generation and Module Mapping.

Public API::

    from simworkbench.modeling import (
        ModelSpecGenerator, ModelSpecGenerationError,
        ModuleMatcher, ModuleMatchReport,
        GapAnalyzer, GapReport,
        ExperimentProposer,
        repair, RepairError,
    )

The four classes correspond to plan §Phase 5 / 5A-5D. The default
implementations are deterministic and offline-safe; subclass each ABC
to plug in LLM-backed alternatives.
"""

from __future__ import annotations

from .experiment_proposal import ExperimentProposer
from .gap_analysis import GapAnalyzer, GapReport
from .generator import ModelSpecGenerationError, ModelSpecGenerator
from .module_match import ModuleMatch, ModuleMatcher, ModuleMatchReport
from .repair import RepairError, repair

__all__ = [
    "ExperimentProposer",
    "GapAnalyzer",
    "GapReport",
    "ModelSpecGenerationError",
    "ModelSpecGenerator",
    "ModuleMatch",
    "ModuleMatchReport",
    "ModuleMatcher",
    "RepairError",
    "repair",
]
