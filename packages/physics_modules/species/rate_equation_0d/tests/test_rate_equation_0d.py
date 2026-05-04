"""Phase 7 unit tests for rate_equation_0d (Registry v1 metadata round-trip)."""

from __future__ import annotations

from pathlib import Path

import yaml


def test_module_yaml_loads_with_registry_v1_fields():
    yaml_path = Path(__file__).resolve().parent.parent / "module.yaml"
    metadata = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    assert metadata["name"] == "rate_equation_0d"
    assert metadata["status"] == "validated"
    assert metadata["benchmarks"], "validated module must declare benchmarks"
    assert "compatibility" in metadata
    assert "python_cpu" in metadata["compatibility"]["backends"]


def test_module_metadata_round_trips_through_pydantic():
    from simworkbench.modules import load_module_yaml

    yaml_path = Path(__file__).resolve().parent.parent / "module.yaml"
    md = load_module_yaml(yaml_path)
    assert md.name == "rate_equation_0d"
    assert md.status == "validated"
    assert md.benchmarks, "validated module must declare benchmarks"
    bench_ids = [b.id for b in md.benchmarks]
    assert "first_order_decay" in bench_ids
    assert "two_species_conversion" in bench_ids
