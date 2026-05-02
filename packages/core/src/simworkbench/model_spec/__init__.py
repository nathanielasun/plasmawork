"""ModelSpec — structured intermediate representation between papers and code.

Per ADR-0003, all paper-derived simulations pass through a structured ModelSpec
before code generation. This package exposes the Pydantic-typed schema, YAML
loader, and JSON-Schema export.

Typical use::

    from simworkbench.model_spec import load_yaml, save_yaml, ModelSpec
    spec = load_yaml("examples/simple_rate_equations/model.yaml")
    print(spec.model.name, spec.geometry.dimensionality)
    save_yaml(spec, "/tmp/roundtrip.yaml")
"""

from __future__ import annotations

from .loader import (
    ModelSpecError,
    from_dict,
    load_yaml,
    load_yaml_str,
    save_yaml,
    to_dict,
    to_yaml,
)
from .schema import get_json_schema, get_json_schema_text
from .types import (
    SCHEMA_VERSION,
    BoundaryCondition,
    Diagnostic,
    Equation,
    FieldDef,
    Geometry,
    Interaction,
    Model,
    ModelSpec,
    PaperSource,
    Quantity,
    SolverRecommendation,
    Solvers,
    Sources,
    Species,
    Validation,
)

__all__ = [
    "BoundaryCondition",
    "Diagnostic",
    "Equation",
    "FieldDef",
    "Geometry",
    "Interaction",
    "Model",
    "ModelSpec",
    "ModelSpecError",
    "PaperSource",
    "Quantity",
    "SCHEMA_VERSION",
    "SolverRecommendation",
    "Solvers",
    "Sources",
    "Species",
    "Validation",
    "from_dict",
    "get_json_schema",
    "get_json_schema_text",
    "load_yaml",
    "load_yaml_str",
    "save_yaml",
    "to_dict",
    "to_yaml",
]
