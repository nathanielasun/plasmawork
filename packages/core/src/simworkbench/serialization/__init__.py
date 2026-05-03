"""Serialization APIs for workbench objects.

Phase 1A provided experiment YAML save/load. Phase 1's minimal capsule
save/reload landed in ``capsule.py``. Phase 2A adds the canonical manifest
schema (``manifest.py``), the directory validator (``validator.py``), the
HDF5 bulk-data writer (``bulk_data.py``), and the migration registry
(``migrations/``). Per ADR-0002 (Accepted), HDF5 is the bulk-data format.
"""

from __future__ import annotations

from .bulk_data import read_diagnostics_h5, write_diagnostics_h5
from .capsule import (
    CAPSULE_FORMAT_VERSION,
    LoadedCapsule,
    load_capsule,
    save_capsule,
)
from .experiment import load_experiment, save_experiment
from .export import EXPORT_KINDS, ExportResult, export_capsule
from .fork import fork_capsule
from .manifest import (
    CapsuleSection,
    Manifest,
    ModelSection,
    PaperSection,
    ProvenanceSection,
    RuntimeSection,
    load_manifest,
    write_manifest,
)
from .validator import (
    CapsuleValidator,
    ValidationReport,
    Violation,
)

__all__ = [
    "CAPSULE_FORMAT_VERSION",
    "CapsuleSection",
    "CapsuleValidator",
    "EXPORT_KINDS",
    "ExportResult",
    "LoadedCapsule",
    "Manifest",
    "ModelSection",
    "PaperSection",
    "ProvenanceSection",
    "RuntimeSection",
    "ValidationReport",
    "Violation",
    "export_capsule",
    "fork_capsule",
    "load_capsule",
    "load_experiment",
    "load_manifest",
    "read_diagnostics_h5",
    "save_capsule",
    "save_experiment",
    "write_diagnostics_h5",
    "write_manifest",
]
