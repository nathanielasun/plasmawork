"""Phase 1A — ModelSpec tests.

Cover:
- Quantity field accepts strings and pint quantities, rejects raw numbers.
- Round-trip: YAML -> ModelSpec -> YAML reloads identically.
- Schema version mismatch raises.
- Cross-section validators catch unknown participants and unknown diagnostics.
- 0D geometry rejects boundary conditions.
- Equation with units_checked=True must list assumptions.
- Example YAML at examples/simple_rate_equations/model.yaml loads and validates.
- JSON-Schema export is non-empty and includes required top-level fields.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import yaml

from simworkbench.model_spec import (
    ModelSpec,
    ModelSpecError,
    SCHEMA_VERSION,
    from_dict,
    get_json_schema,
    load_yaml,
    load_yaml_str,
    save_yaml,
    to_dict,
    to_yaml,
)
from simworkbench.units import Q


# ---------------------------------------------------------------------------
# Minimum-viable spec used as the basis for many tests
# ---------------------------------------------------------------------------

MINIMAL_SPEC: dict = {
    "schema_version": SCHEMA_VERSION,
    "model": {"name": "tiny", "domain": "laser_species"},
    "geometry": {"dimensionality": 0},
    "species": [
        {"name": "A", "type": "atom", "initial_density": "1.0e18 1/m^3"},
        {"name": "B", "type": "atom", "initial_density": "0 1/m^3"},
    ],
}


def test_minimal_spec_loads():
    spec = from_dict(MINIMAL_SPEC)
    assert spec.model.name == "tiny"
    assert spec.geometry.dimensionality == 0
    assert len(spec.species) == 2


def test_quantity_field_accepts_string():
    spec = from_dict(MINIMAL_SPEC)
    A = spec.species[0]
    assert A.initial_density.magnitude == pytest.approx(1.0e18)
    assert str(A.initial_density.units) == "1 / meter ** 3"


def test_quantity_field_accepts_pint_quantity():
    data = deepcopy(MINIMAL_SPEC)
    data["species"] = [
        {"name": "A", "type": "atom", "initial_density": Q(1.0e18, "1/m^3")},
        {"name": "B", "type": "atom", "initial_density": Q(0.0, "1/m^3")},
    ]
    spec = from_dict(data)
    assert spec.species[0].initial_density.magnitude == pytest.approx(1.0e18)


def test_quantity_field_rejects_raw_float():
    data = deepcopy(MINIMAL_SPEC)
    data["species"] = [
        {"name": "A", "type": "atom", "initial_density": 1.0e18},  # raw — forbidden
        {"name": "B", "type": "atom", "initial_density": "0 1/m^3"},
    ]
    with pytest.raises(ModelSpecError, match="Raw number"):
        from_dict(data)


def test_quantity_field_dimensionality_check_on_density():
    data = deepcopy(MINIMAL_SPEC)
    data["species"] = [
        # Density quoted in seconds — wrong dimensionality.
        {"name": "A", "type": "atom", "initial_density": "1.0e18 second"},
        {"name": "B", "type": "atom", "initial_density": "0 1/m^3"},
    ]
    with pytest.raises(ModelSpecError, match="Dimensionality mismatch"):
        from_dict(data)


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

def test_yaml_roundtrip_preserves_quantities():
    spec = from_dict(MINIMAL_SPEC)
    yaml_text = to_yaml(spec)
    reloaded = load_yaml_str(yaml_text)
    assert reloaded.species[0].initial_density.magnitude == pytest.approx(1.0e18)
    # And the dimensionality survives.
    assert reloaded.species[0].initial_density.dimensionality == \
        spec.species[0].initial_density.dimensionality


def test_to_dict_emits_quantity_strings():
    spec = from_dict(MINIMAL_SPEC)
    data = to_dict(spec)
    initial_density = data["species"][0]["initial_density"]
    assert isinstance(initial_density, str)
    # Pint's short-form serialization: "1e+18 1 / m ** 3" (with spaces).
    # Either spelling is acceptable as long as it's a string with magnitude
    # and an inverse-volume unit.
    assert "1e+18" in initial_density or "1.0e+18" in initial_density
    assert "m" in initial_density and ("**" in initial_density or "^" in initial_density)


# ---------------------------------------------------------------------------
# Schema version
# ---------------------------------------------------------------------------

def test_schema_version_mismatch_raises():
    data = deepcopy(MINIMAL_SPEC)
    data["schema_version"] = "0.99"
    with pytest.raises(ModelSpecError, match="Unsupported schema_version"):
        from_dict(data)


def test_default_schema_version_when_omitted():
    data = {k: v for k, v in MINIMAL_SPEC.items() if k != "schema_version"}
    spec = from_dict(data)
    assert spec.schema_version == SCHEMA_VERSION


# ---------------------------------------------------------------------------
# Cross-section validators per plan §8.2
# ---------------------------------------------------------------------------

def test_unknown_interaction_participant_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["interactions"] = [
        {
            "name": "bogus",
            "participants": ["A", "C"],  # C is undefined
            "equation_refs": [],
            "coefficient_sources": [],
        }
    ]
    with pytest.raises(ModelSpecError, match="unknown participant"):
        from_dict(data)


def test_unknown_diagnostic_quantity_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["diagnostics"] = [
        {"name": "ghost", "quantity": "Z", "output_format": "parquet"}
    ]
    with pytest.raises(ModelSpecError, match="unknown quantity"):
        from_dict(data)


def test_diagnostic_quantity_matching_equation_id_accepted():
    data = deepcopy(MINIMAL_SPEC)
    data["equations"] = [
        {
            "id": "eq1",
            "latex": "dA/dt = 0",
            "description": "trivial",
            "assumptions": [],
            "units_checked": False,
        }
    ]
    data["diagnostics"] = [
        {"name": "trace_eq1", "quantity": "eq1", "output_format": "parquet"}
    ]
    # Should not raise — eq1 is a known equation id.
    from_dict(data)


def test_zero_d_with_boundary_conditions_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["geometry"] = {
        "dimensionality": 0,
        "boundary_conditions": [{"name": "left", "kind": "dirichlet"}],
    }
    with pytest.raises(ModelSpecError, match="0D models cannot declare boundary conditions"):
        from_dict(data)


def test_units_checked_requires_assumptions():
    data = deepcopy(MINIMAL_SPEC)
    data["equations"] = [
        {
            "id": "eq1",
            "latex": "dA/dt = 0",
            "description": "trivial",
            "assumptions": [],
            "units_checked": True,  # claims units checked but no assumptions
        }
    ]
    with pytest.raises(ModelSpecError, match="units_checked=True but no assumptions"):
        from_dict(data)


def test_extra_fields_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["mystery_key"] = 42
    with pytest.raises(ModelSpecError):
        from_dict(data)


def test_missing_species_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["species"] = []
    with pytest.raises(ModelSpecError, match="at least one species"):
        from_dict(data)


def test_unknown_equation_ref_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["interactions"] = [
        {
            "name": "bad_ref",
            "participants": ["A"],
            "equation_refs": ["missing_eq"],
            "coefficient_sources": ["placeholder: test"],
        }
    ]
    with pytest.raises(ModelSpecError, match="unknown equation id"):
        from_dict(data)


def test_missing_coefficient_sources_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["interactions"] = [
        {
            "name": "missing_sources",
            "participants": ["A"],
            "equation_refs": [],
            "coefficient_sources": [],
        }
    ]
    with pytest.raises(ModelSpecError, match="coefficient_sources"):
        from_dict(data)


def test_unsupported_backend_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["solvers"] = {
        "recommended": [
            {
                "name": "bad_backend_solver",
                "backend_compatibility": ["made_up_backend"],
            }
        ]
    }
    with pytest.raises(ModelSpecError, match="unsupported backend"):
        from_dict(data)


def test_solver_backend_compatibility_required():
    data = deepcopy(MINIMAL_SPEC)
    data["solvers"] = {
        "recommended": [
            {
                "name": "solver_without_backends",
                "backend_compatibility": [],
            }
        ]
    }
    with pytest.raises(ModelSpecError, match="backend_compatibility"):
        from_dict(data)


def test_unknown_valid_regime_key_rejected():
    data = deepcopy(MINIMAL_SPEC)
    data["interactions"] = [
        {
            "name": "bad_regime",
            "participants": ["A"],
            "equation_refs": [],
            "coefficient_sources": ["placeholder: test"],
            "valid_regime": {"vibes_max": "10 dimensionless"},
        }
    ]
    with pytest.raises(ModelSpecError, match="unknown validity-regime key"):
        from_dict(data)


def test_field_initialization_rejects_raw_float():
    data = deepcopy(MINIMAL_SPEC)
    data["fields"] = [
        {
            "name": "laser",
            "type": "laser",
            "initialization": {"wavelength": 248.0},
        }
    ]
    with pytest.raises(ModelSpecError, match="raw number"):
        from_dict(data)


def test_interaction_valid_regime_rejects_raw_float():
    data = deepcopy(MINIMAL_SPEC)
    data["interactions"] = [
        {
            "name": "raw_regime",
            "participants": ["A"],
            "equation_refs": [],
            "coefficient_sources": ["placeholder: test"],
            "valid_regime": {"density_max": 1.0e24},
        }
    ]
    with pytest.raises(ModelSpecError, match="raw number"):
        from_dict(data)


def test_domain_bounds_reject_dimensionless_strings():
    data = deepcopy(MINIMAL_SPEC)
    data["geometry"] = {
        "dimensionality": 1,
        "domain_bounds": {"x": ["0", "1"]},
        "boundary_conditions": [{"name": "left", "kind": "dirichlet"}],
    }
    with pytest.raises(ModelSpecError, match="missing units"):
        from_dict(data)


def test_spatial_model_requires_boundary_conditions():
    data = deepcopy(MINIMAL_SPEC)
    data["geometry"] = {
        "dimensionality": 1,
        "domain_bounds": {"x": ["0 m", "1 m"]},
        "boundary_conditions": [],
    }
    with pytest.raises(ModelSpecError, match="boundary_conditions"):
        from_dict(data)


def test_spatial_model_requires_domain_bounds():
    data = deepcopy(MINIMAL_SPEC)
    data["geometry"] = {
        "dimensionality": 1,
        "boundary_conditions": [{"name": "left", "kind": "dirichlet"}],
    }
    with pytest.raises(ModelSpecError, match="domain_bounds"):
        from_dict(data)


# ---------------------------------------------------------------------------
# Example YAML at examples/simple_rate_equations/model.yaml
# ---------------------------------------------------------------------------

def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


def test_example_simple_rate_equations_loads():
    spec = load_yaml(_example_path())
    assert spec.model.name == "simple_rate_equations"
    assert spec.model.domain == "laser_species"
    assert spec.geometry.dimensionality == 0
    assert {s.name for s in spec.species} == {"A", "B"}
    assert spec.species[0].initial_density.magnitude == pytest.approx(1.0e18)
    assert {f.name for f in spec.fields_} == {"laser_pulse"}
    assert spec.solvers.recommended[0].name == "scipy_ivp_lsoda"


def test_example_roundtrip_writes_valid_yaml(tmp_path):
    spec = load_yaml(_example_path())
    out = tmp_path / "roundtrip.yaml"
    save_yaml(spec, out)
    text = out.read_text()
    # Reload and confirm it still validates and matches the original.
    reloaded = load_yaml(out)
    assert reloaded.model.name == spec.model.name
    assert reloaded.geometry.dimensionality == spec.geometry.dimensionality
    # The roundtrip is lossless w.r.t. magnitudes.
    for orig, rt in zip(spec.species, reloaded.species, strict=True):
        assert rt.initial_density.magnitude == pytest.approx(orig.initial_density.magnitude)
    # And the YAML is parseable on its own.
    parsed = yaml.safe_load(text)
    assert parsed["model"]["name"] == "simple_rate_equations"


# ---------------------------------------------------------------------------
# JSON Schema export
# ---------------------------------------------------------------------------

def test_json_schema_has_top_level_fields():
    schema = get_json_schema()
    assert "properties" in schema
    props = schema["properties"]
    for required in (
        "schema_version",
        "model",
        "sources",
        "geometry",
        "species",
        "fields",
        "interactions",
        "equations",
        "solvers",
        "diagnostics",
        "validation",
    ):
        assert required in props, f"JSON schema missing top-level field {required!r}"


def test_json_schema_referenced_from_loader():
    # The schema is generated from the same Pydantic model the loader uses,
    # so making the model invalid in either direction would break this.
    schema = get_json_schema()
    assert isinstance(schema, dict)
    assert schema.get("title") == "ModelSpec"


# ---------------------------------------------------------------------------
# ModelSpec construction in code (not via YAML)
# ---------------------------------------------------------------------------

def test_construct_modelspec_in_code():
    spec = ModelSpec(
        model={"name": "code_built", "domain": "laser_species"},
        geometry={"dimensionality": 0},
        species=[
            {"name": "A", "type": "atom", "initial_density": Q(1.0e18, "1/m^3")},
        ],
    )
    assert spec.model.name == "code_built"
    assert len(spec.species) == 1
