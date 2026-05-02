"""Core package for the Scientific Simulation Workbench.

Phase 1 (Manual Workbench) is currently active. The submodules below land
incrementally during Phase 1:

- ``simworkbench.units``       — Phase 1B (ADR-0004, pint wrapper). Available.
- ``simworkbench.model_spec``  — Phase 1A (ADR-0003, Pydantic IR). Available.
- ``simworkbench.runtime``     — Phase 1C. Pending.
- ``simworkbench.serialization`` — Phase 1A / Phase 2. Capsule save/load. Pending.
- ``simworkbench.diagnostics`` — Phase 1E. Pending.
- ``simworkbench.validation``  — Phase 1A onwards. Pending.
- ``simworkbench.registry``    — Phase 3. Pending.
- ``simworkbench.provenance``  — Phase 2. Pending.
- ``simworkbench.tools``       — Phase 3. Pending.
- ``simworkbench.api``         — Phase 1F. Pending.
- ``simworkbench.paths``       — workbench path helpers. Pending.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
