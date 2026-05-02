"""ModelSpec — structured intermediate representation between papers and code.

Schema follows ADR-0003 and plan §8.1. Every physical quantity is unit-aware
through ``simworkbench.units`` — raw floats for physical values are rejected
at the boundary per plan §22 / ADR-0003.

The IR is YAML at rest and Pydantic-typed in memory. Loading is in
``simworkbench.model_spec.loader``; JSON-schema export is in
``simworkbench.model_spec.schema``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import pint
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    WithJsonSchema,
    model_validator,
)

from simworkbench.units import Q, UnitsError, check_dimensionality

# ---------------------------------------------------------------------------
# Custom Pydantic field type: Quantity
# ---------------------------------------------------------------------------

def _parse_quantity(value: Any) -> pint.Quantity:
    """Pydantic before-validator: accept str / pint.Quantity, reject anything else."""
    if isinstance(value, pint.Quantity):
        return Q(value)  # rebind to workbench registry
    if isinstance(value, str):
        return Q(value)
    if isinstance(value, (int, float)):
        # Raw numeric: forbidden at the ModelSpec boundary (plan §22).
        raise UnitsError(
            f"Raw number {value!r} is not allowed in ModelSpec — wrap with units, "
            f"e.g. {value!r} 1/m^3."
        )
    raise UnitsError(
        f"Cannot parse Quantity from {type(value).__name__}: {value!r}"
    )


def _serialize_quantity(value: pint.Quantity) -> str:
    return f"{value.magnitude} {value.units:~}"  # ``~`` short-form units


Quantity = Annotated[
    pint.Quantity,
    BeforeValidator(_parse_quantity),
    PlainSerializer(_serialize_quantity, return_type=str, when_used="always"),
    WithJsonSchema(
        {
            "type": "string",
            "description": (
                "Physical quantity as a string with units, e.g. '1.5 J', "
                "'1.0e18 1/m^3', '248 nm'. Parsed by simworkbench.units (pint, ADR-0004)."
            ),
            "examples": ["1.5 J", "1.0e18 1/m^3", "248 nm", "25 ns"],
        }
    ),
]


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

CoordinateSystem = Literal["cartesian", "cylindrical", "spherical"]
SpeciesType = Literal["atom", "ion", "molecule", "electron", "photon", "quasi_particle"]
FieldType = Literal["electric", "magnetic", "electromagnetic", "scalar", "laser"]


class Model(BaseModel):
    """Top-level identification of the model."""

    model_config = ConfigDict(extra="forbid")

    name: str
    version: str = "0.1.0"
    domain: str
    description: str = ""


class PaperSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    doi: str | None = None
    local_path: str | None = None
    extracted_sections: list[str] = Field(default_factory=list)


class Sources(BaseModel):
    model_config = ConfigDict(extra="forbid")

    papers: list[PaperSource] = Field(default_factory=list)


class BoundaryCondition(BaseModel):
    """Boundary condition descriptor.

    The ``kind`` is a free string until the relevant physics module declares an
    enum (Phase 7 — Workstream 7C). For Phase 1 we accept any string.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    kind: str
    notes: str = ""


class Geometry(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    dimensionality: Literal[0, 1, 2, 3]
    coordinate_system: CoordinateSystem = "cartesian"
    domain_bounds: dict[str, list[Quantity]] | None = None
    boundary_conditions: list[BoundaryCondition] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_bc_consistency(self) -> "Geometry":
        if self.dimensionality == 0 and self.boundary_conditions:
            raise ValueError(
                "0D models cannot declare boundary conditions; "
                "remove geometry.boundary_conditions or raise dimensionality."
            )
        if self.dimensionality >= 1 and self.domain_bounds is None:
            # Permit None during early authoring; loader emits a warning at
            # validate-strict time. We don't raise here so a paper-derived
            # ModelSpec can be loaded for review even if bounds are missing.
            pass
        return self


class Species(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    name: str
    type: SpeciesType
    charge: float = 0.0
    mass: Quantity | None = None
    internal_states: list[str] = Field(default_factory=list)
    initial_density: Quantity

    @model_validator(mode="after")
    def _check_units(self) -> "Species":
        check_dimensionality(self.initial_density, "1 / [length] ** 3")
        if self.mass is not None:
            check_dimensionality(self.mass, "[mass]")
        return self


class FieldDef(BaseModel):
    """A field on the simulation domain (electric, magnetic, laser, scalar)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    type: FieldType
    initialization: dict[str, Any] = Field(default_factory=dict)
    evolution_equation: str | None = None


class Interaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    participants: list[str]
    equation_refs: list[str] = Field(default_factory=list)
    coefficient_sources: list[str] = Field(default_factory=list)
    valid_regime: dict[str, Any] = Field(default_factory=dict)


class Equation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    latex: str
    description: str = ""
    assumptions: list[str] = Field(default_factory=list)
    units_checked: bool = False


class SolverRecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    reason: str = ""
    backend_compatibility: list[str] = Field(default_factory=list)


class Solvers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommended: list[SolverRecommendation] = Field(default_factory=list)


class Diagnostic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    quantity: str
    output_format: str = "parquet"
    visualization: str | None = None


class Validation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_limits: list[str] = Field(default_factory=list)
    paper_figures_to_reproduce: list[str] = Field(default_factory=list)
    conservation_laws: list[str] = Field(default_factory=list)
    convergence_requirements: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-level ModelSpec
# ---------------------------------------------------------------------------

SCHEMA_VERSION = "0.1"


class ModelSpec(BaseModel):
    """Top-level structured representation of a paper-derived experiment."""

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    schema_version: str = SCHEMA_VERSION
    model: Model
    sources: Sources = Field(default_factory=Sources)
    geometry: Geometry
    species: list[Species] = Field(default_factory=list)
    # ``fields`` collides with pydantic's own attribute namespace, so the
    # IR uses ``fields_`` in Python and ``fields`` in YAML.
    fields_: list[FieldDef] = Field(default_factory=list, alias="fields")
    interactions: list[Interaction] = Field(default_factory=list)
    equations: list[Equation] = Field(default_factory=list)
    solvers: Solvers = Field(default_factory=Solvers)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    validation: Validation = Field(default_factory=Validation)

    # ---- cross-section validation per plan §8.2 -----------------------

    @model_validator(mode="after")
    def _check_schema_version(self) -> "ModelSpec":
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported schema_version {self.schema_version!r}; "
                f"this build understands {SCHEMA_VERSION!r}. "
                "Add a migration in simworkbench.model_spec.migrations."
            )
        return self

    @model_validator(mode="after")
    def _check_interaction_participants(self) -> "ModelSpec":
        known = {s.name for s in self.species} | {f.name for f in self.fields_}
        for ix in self.interactions:
            unknown = [p for p in ix.participants if p not in known]
            if unknown:
                raise ValueError(
                    f"Interaction {ix.name!r} references unknown participant(s) "
                    f"{unknown}. Known species/fields: {sorted(known)}."
                )
        return self

    @model_validator(mode="after")
    def _check_diagnostic_quantities(self) -> "ModelSpec":
        known = {s.name for s in self.species} | {f.name for f in self.fields_}
        for d in self.diagnostics:
            # Diagnostics may also reference equation IDs or derived quantities;
            # we accept those if they match an equation id, otherwise we expect
            # the name to be a species or field. Free strings are not allowed.
            if d.quantity in known:
                continue
            equation_ids = {eq.id for eq in self.equations}
            if d.quantity in equation_ids:
                continue
            raise ValueError(
                f"Diagnostic {d.name!r} references unknown quantity {d.quantity!r}. "
                f"Known species/fields: {sorted(known)}; equations: {sorted(equation_ids)}."
            )
        return self

    @model_validator(mode="after")
    def _check_equation_assumptions_present_for_units_checked(self) -> "ModelSpec":
        # If an equation declares units_checked=True, it must list at least
        # one explicit assumption — silent unit checks have burned us before.
        for eq in self.equations:
            if eq.units_checked and not eq.assumptions:
                raise ValueError(
                    f"Equation {eq.id!r} has units_checked=True but no assumptions; "
                    "list the regime under which the unit check holds."
                )
        return self


__all__ = [
    "BoundaryCondition",
    "Diagnostic",
    "Equation",
    "FieldDef",
    "Geometry",
    "Interaction",
    "Model",
    "ModelSpec",
    "PaperSource",
    "Quantity",
    "SCHEMA_VERSION",
    "SolverRecommendation",
    "Solvers",
    "Sources",
    "Species",
    "Validation",
]
