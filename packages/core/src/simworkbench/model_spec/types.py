"""ModelSpec — structured intermediate representation between papers and code.

Schema follows ADR-0003 and plan §8.1. Every physical quantity is unit-aware
through ``simworkbench.units`` — raw floats for physical values are rejected
at the boundary per plan §22 / ADR-0003.

The IR is YAML at rest and Pydantic-typed in memory. Loading is in
``simworkbench.model_spec.loader``; JSON-schema export is in
``simworkbench.model_spec.schema``.
"""

from __future__ import annotations

import re
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

_NUMERIC_STRING_RE = re.compile(
    r"^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$"
)

KNOWN_BACKENDS = frozenset(
    {
        "python_cpu",
        "numba_cpu",
        "cpp",
        "fortran",
        "cuda",
        "kokkos",
        "petsc",
        "amrex",
        "external_pic",
    }
)

KNOWN_VALID_REGIME_KEYS = frozenset(
    {
        "density_min",
        "density_max",
        "intensity_min",
        "intensity_max",
        "temperature_min",
        "temperature_max",
        "pressure_min",
        "pressure_max",
        "wavelength_min",
        "wavelength_max",
        "photon_energy_min",
        "photon_energy_max",
        "time_min",
        "time_max",
        "duration_min",
        "duration_max",
        "frequency_min",
        "frequency_max",
        "notes",
    }
)

# ---------------------------------------------------------------------------
# Custom Pydantic field type: Quantity
# ---------------------------------------------------------------------------

def _parse_quantity(value: Any) -> pint.Quantity:
    """Pydantic before-validator: accept str / pint.Quantity, reject anything else."""
    if isinstance(value, pint.Quantity):
        quantity = Q(value)  # rebind to workbench registry
        if quantity.dimensionless:
            raise UnitsError(
                f"Physical quantities must carry explicit units; got {value!s}."
            )
        return quantity
    if isinstance(value, str):
        quantity = Q(value)
        if quantity.dimensionless and _NUMERIC_STRING_RE.match(value):
            raise UnitsError(
                f"Physical quantity {value!r} is missing units. Use a unit string "
                "such as '0 m' or explicitly declare dimensionless where supported."
            )
        return quantity
    if isinstance(value, (int, float)):
        # Raw numeric: forbidden at the ModelSpec boundary (plan §22).
        raise UnitsError(
            f"Raw number {value!r} is not allowed for a physical quantity — wrap with units, "
            f"e.g. {value!r} 1/m^3."
        )
    raise UnitsError(
        f"Cannot parse Quantity from {type(value).__name__}: {value!r}"
    )


def _serialize_quantity(value: pint.Quantity) -> str:
    return f"{value.magnitude} {value.units:~}"  # ``~`` short-form units


def _validate_parameter_tree(
    value: Any,
    *,
    path: str,
    allowed_keys: frozenset[str] | None,
) -> None:
    """Validate arbitrary ModelSpec parameter maps for unit boundary leaks.

    Purpose: catch physical values stored inside flexible dict sections such as
    `fields.initialization` and `interactions.valid_regime`.
    Inputs: `value` may be a nested YAML-derived value; numeric physical leaves
    must be unit strings or quantities. `path` has no units and is diagnostic
    text. `allowed_keys` optionally constrains a mapping's key vocabulary.
    Outputs: returns `None`; raises `ValueError` / `UnitsError` on invalid data.
    Assumptions: booleans and textual descriptors are metadata, not physical
    quantities. Numeric leaves in these sections are physical unless explicitly
    encoded as unit-aware strings.
    References: plan §8.2, §8.3; ADR-0003; ADR-0004.
    """
    if isinstance(value, dict):
        if allowed_keys is not None:
            unknown = [k for k in value if k not in allowed_keys]
            if unknown:
                raise ValueError(
                    f"{path} contains unknown validity-regime key(s) {unknown}. "
                    f"Known keys: {sorted(allowed_keys)}."
                )
        for key, child in value.items():
            _validate_parameter_tree(
                child,
                path=f"{path}.{key}",
                allowed_keys=None,
            )
        return

    if isinstance(value, list):
        for idx, child in enumerate(value):
            _validate_parameter_tree(child, path=f"{path}[{idx}]", allowed_keys=None)
        return

    if value is None or isinstance(value, bool):
        return

    if isinstance(value, pint.Quantity):
        quantity = Q(value)
        if quantity.dimensionless:
            raise UnitsError(
                f"{path} must carry explicit units; got dimensionless quantity {value!s}."
            )
        return

    if isinstance(value, (int, float)):
        raise UnitsError(
            f"{path} uses raw number {value!r}. ModelSpec physical parameters must "
            "be unit-aware strings such as '248 nm' or '1.0e10 W/m^2'."
        )

    if isinstance(value, str):
        if _NUMERIC_STRING_RE.match(value):
            raise UnitsError(
                f"{path} uses numeric string {value!r} without units. "
                "Use a unit-aware string such as '0 m' or '1 dimensionless'."
            )
        return

    raise UnitsError(
        f"{path} has unsupported parameter value {value!r} "
        f"({type(value).__name__})."
    )


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
    def _check_bc_consistency(self) -> Geometry:
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
    def _check_units(self) -> Species:
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

    @model_validator(mode="after")
    def _check_initialization_units(self) -> FieldDef:
        _validate_parameter_tree(
            self.initialization,
            path=f"fields.{self.name}.initialization",
            allowed_keys=None,
        )
        return self


class Interaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    participants: list[str]
    equation_refs: list[str] = Field(default_factory=list)
    coefficient_sources: list[str] = Field(default_factory=list)
    valid_regime: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_valid_regime_units(self) -> Interaction:
        _validate_parameter_tree(
            self.valid_regime,
            path=f"interactions.{self.name}.valid_regime",
            allowed_keys=KNOWN_VALID_REGIME_KEYS,
        )
        return self


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
    def _check_schema_version(self) -> ModelSpec:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported schema_version {self.schema_version!r}; "
                f"this build understands {SCHEMA_VERSION!r}. "
                "Add a migration in simworkbench.model_spec.migrations."
            )
        return self

    @model_validator(mode="after")
    def _check_interaction_participants(self) -> ModelSpec:
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
    def _check_species_present(self) -> ModelSpec:
        if not self.species:
            raise ValueError("ModelSpec must define at least one species.")
        return self

    @model_validator(mode="after")
    def _check_boundary_requirements(self) -> ModelSpec:
        if self.geometry.dimensionality >= 1 and not self.geometry.boundary_conditions:
            raise ValueError(
                "Models with dimensionality >= 1 must declare geometry.boundary_conditions."
            )
        if self.geometry.dimensionality >= 1 and self.geometry.domain_bounds is None:
            raise ValueError(
                "Models with dimensionality >= 1 must declare geometry.domain_bounds."
            )
        return self

    @model_validator(mode="after")
    def _check_interaction_equation_refs_and_sources(self) -> ModelSpec:
        equation_ids = {eq.id for eq in self.equations}
        for ix in self.interactions:
            missing_refs = [ref for ref in ix.equation_refs if ref not in equation_ids]
            if missing_refs:
                raise ValueError(
                    f"Interaction {ix.name!r} references unknown equation id(s) "
                    f"{missing_refs}. Known equations: {sorted(equation_ids)}."
                )
            if not ix.coefficient_sources:
                raise ValueError(
                    f"Interaction {ix.name!r} must list coefficient_sources. "
                    "Use an explicit placeholder entry if data is exploratory."
                )
        return self

    @model_validator(mode="after")
    def _check_solver_backend_compatibility(self) -> ModelSpec:
        for solver in self.solvers.recommended:
            if not solver.backend_compatibility:
                raise ValueError(
                    f"Solver recommendation {solver.name!r} must list backend_compatibility."
                )
            unknown = [
                backend
                for backend in solver.backend_compatibility
                if backend not in KNOWN_BACKENDS
            ]
            if unknown:
                raise ValueError(
                    f"Solver recommendation {solver.name!r} references unsupported "
                    f"backend(s) {unknown}. Known backends: {sorted(KNOWN_BACKENDS)}."
                )
        return self

    @model_validator(mode="after")
    def _check_diagnostic_quantities(self) -> ModelSpec:
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
    def _check_equation_assumptions_present_for_units_checked(self) -> ModelSpec:
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
