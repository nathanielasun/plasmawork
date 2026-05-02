"""Experiment serialization helpers.

These functions keep Phase 1A save/load import paths stable while the fuller
capsule serializer is deferred to Phase 2.
"""

from __future__ import annotations

from pathlib import Path

from simworkbench.experiment import Experiment


def save_experiment(experiment: Experiment, path: str | Path) -> None:
    """Save an experiment to YAML.

    Purpose: persist an inspectable Phase 1A experiment.
    Inputs: `experiment` contains unit-aware ModelSpec/RunConfig data; `path`
    is a filesystem path with no units.
    Outputs: writes YAML and returns `None`.
    Assumptions: this is not a full capsule export; Phase 2 owns capsule
    archive semantics.
    References: plan Phase 1A and Phase 2.
    """
    experiment.save_yaml(path)


def load_experiment(path: str | Path) -> Experiment:
    """Load an experiment from YAML.

    Purpose: restore a Phase 1A experiment from a saved YAML representation.
    Inputs: `path` is a filesystem path with no units.
    Outputs: a validated `Experiment`.
    Assumptions: the YAML uses the current Phase 1A schema.
    References: plan Phase 1A.
    """
    return Experiment.load_yaml(path)


__all__ = ["load_experiment", "save_experiment"]
