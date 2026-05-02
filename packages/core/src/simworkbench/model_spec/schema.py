"""JSON-Schema export for the ModelSpec.

External tooling (the docs site, IDE plugins, paper-ingestion agents) consumes
the schema rather than reading the Pydantic types directly. The schema is
generated on demand from the live Pydantic model — no hand-written JSON
schema lives in the tree.
"""

from __future__ import annotations

import json
from typing import Any

from .types import ModelSpec


def get_json_schema() -> dict[str, Any]:
    """Return the ModelSpec JSON Schema as a Python dict."""
    return ModelSpec.model_json_schema(by_alias=True)


def get_json_schema_text(indent: int = 2) -> str:
    """Return the ModelSpec JSON Schema as a JSON string."""
    return json.dumps(get_json_schema(), indent=indent, sort_keys=False)


__all__ = ["get_json_schema", "get_json_schema_text"]
