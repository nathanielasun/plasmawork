"""Phase 5A — ModelSpec repair loop.

When a generated ModelSpec fails Pydantic validation, the repair loop
applies a small set of deterministic fixes (default values for missing
required fields, schema-version normalization, dimensionality coercion)
and retries. If repair can't make the spec valid, the original error
surfaces with a list of attempted fixes.

Stays minimal on purpose. Real semantic repair (e.g. inferring units
from context) belongs to a Phase 5+ LLM-backed implementation; this
default fixes only the structural issues a regex generator can leave
behind.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from simworkbench.model_spec import ModelSpec, from_dict


class RepairError(RuntimeError):
    """Raised when the repair loop cannot produce a valid ModelSpec."""


def repair(spec_dict: dict[str, Any], *, max_attempts: int = 5) -> ModelSpec:
    """Attempt to coerce ``spec_dict`` into a valid ModelSpec.

    Each iteration: try ``from_dict``; if it raises ``ValidationError``,
    inspect the error and apply one targeted fix. Stop on success or
    when ``max_attempts`` is exceeded.
    """
    fixes: list[str] = []
    data = dict(spec_dict)
    last_error: Exception | None = None
    for _ in range(max_attempts):
        try:
            return from_dict(data)
        except ValidationError as exc:
            last_error = exc
            applied = _apply_one_fix(data, exc, fixes)
            if not applied:
                break
        except Exception as exc:  # noqa: BLE001 — surfaced verbatim.
            last_error = exc
            break
    raise RepairError(
        f"ModelSpec repair failed after {max_attempts} attempts. "
        f"Fixes applied: {fixes!r}. Last error: {last_error}"
    )


def _apply_one_fix(
    data: dict[str, Any], error: ValidationError, fixes: list[str]
) -> bool:
    """Apply ONE deterministic fix per call, return True if data changed.

    Looking at error.errors() and patching the most-common shapes:
      * missing required field → insert a sensible default
      * extra forbidden field → drop it
      * schema_version wrong → coerce to current
    """
    changed = False
    for err in error.errors():
        loc = err["loc"]
        kind = err["type"]
        if kind == "missing" and loc:
            inserted = _insert_default(data, list(loc))
            if inserted is not None:
                fixes.append(f"insert default at {'.'.join(map(str, loc))}: {inserted!r}")
                changed = True
                break
        if kind == "extra_forbidden" and loc:
            dropped = _drop_path(data, list(loc))
            if dropped:
                fixes.append(f"drop forbidden field at {'.'.join(map(str, loc))}")
                changed = True
                break
        if kind == "value_error" and "schema_version" in str(err.get("msg", "")):
            data["schema_version"] = "0.1"
            fixes.append("coerce schema_version → 0.1")
            changed = True
            break
    return changed


_DEFAULTS = {
    "geometry": {"dimensionality": 0, "coordinate_system": "cartesian"},
    "model": {"name": "untitled", "domain": "species"},
    "schema_version": "0.1",
}


def _insert_default(data: dict[str, Any], loc: list[str | int]) -> Any:
    if not loc:
        return None
    key = loc[0]
    if isinstance(key, str) and key in _DEFAULTS and key not in data:
        data[key] = _DEFAULTS[key]
        return _DEFAULTS[key]
    return None


def _drop_path(data: dict[str, Any], loc: list[str | int]) -> bool:
    if not loc:
        return False
    if isinstance(loc[0], str) and loc[0] in data:
        del data[loc[0]]
        return True
    return False


__all__ = ["RepairError", "repair"]
