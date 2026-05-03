"""Phase 4C — Parameter extraction.

Default implementation scans for ``name = value [unit]`` lines (Markdown
list items, ``key = value`` config-style rows, and bullet lists are all
handled). Rows without a recognizable unit token are flagged with
``missing_units = True`` — the runtime later refuses unsourced rates,
so flagging here is the first place a missing unit becomes visible.

Per plan §22 / `agent_error_patterns.md` "Silently inventing missing
physical coefficients", the extractor MUST NOT fabricate units. When
units are absent, the row carries ``unit=""`` and ``missing_units=True``
so the review UI / human reviewer can fill them in (and the edit lands
in provenance).
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from pathlib import Path

from .paper import ExtractedParameter


class ParameterExtractor(ABC):
    @abstractmethod
    def extract(
        self, text: str, *, source_file: str = ""
    ) -> list[ExtractedParameter]:
        """Return one ``ExtractedParameter`` per detected parameter row."""


# ---------------------------------------------------------------------------
# Default regex-based implementation.
# ---------------------------------------------------------------------------

# Match `- name = value [tail]`. The unit is the first whitespace-
# delimited token of tail, vetted by ``_extract_unit``. We pull the
# whole tail rather than embedding the unit pattern in the line regex
# because real units (like ``1/s`` or ``MW/cm^2``) start with digits or
# punctuation, and a tight regex tends to either reject them or to
# fabricate units out of arbitrary prose.
_PARAM_LINE = re.compile(
    r"""
    ^[\s\-\*]*                            # optional bullet
    (?P<name>[A-Za-z][A-Za-z0-9_]*)       # identifier
    \s*=\s*
    (?P<value>
        -?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?  # number incl. scientific
        | "[^"]+"                          # quoted string
    )
    (?P<tail>.*)$
    """,
    re.VERBOSE,
)

# Tokens that look like sentence-fragment prose rather than a real unit.
_NON_UNIT_TOKENS = frozenset(
    {"the", "and", "or", "of", "is", "are", "be", "for", "with", "in", "on", "a"}
)

# Allowed shape of a unit token: starts with a letter or digit; rest can
# include letters, digits, slashes, powers, multiplications, dots, dashes.
_UNIT_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/\^\*\.\-]*$")


def _extract_unit(tail: str) -> str:
    """Return the unit substring from remainder-of-line, or "".

    Rule: the unit is the FIRST whitespace-delimited token of ``tail``,
    and only if that token looks like a real unit (matches
    ``_UNIT_TOKEN``, isn't a stop-word, isn't an obvious prose fragment).
    Tokens after the first are ignored — we never glue prose into units
    (carries plan §22 / `agent_error_patterns.md` "Silently inventing
    missing physical coefficients").
    """
    stripped = tail.strip()
    if not stripped:
        return ""
    first = stripped.split(maxsplit=1)[0]
    if first.lower() in _NON_UNIT_TOKENS:
        return ""
    if not _UNIT_TOKEN.match(first):
        return ""
    # Long all-alphabetic tokens are almost certainly prose, not units
    # (e.g. "describes"). Real units are short symbols (s, m, K, Hz, J/s).
    if first.isalpha() and len(first) > 6:
        return ""
    return first


class RegexParameterExtractor(ParameterExtractor):
    """Default extractor — regex over text lines; deterministic."""

    def extract(
        self, text: str, *, source_file: str = ""
    ) -> list[ExtractedParameter]:
        out: list[ExtractedParameter] = []
        for line_no, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith("#") or line.startswith("//"):
                continue
            match = _PARAM_LINE.match(line)
            if not match:
                continue
            name = match.group("name")
            value_str = match.group("value")
            tail = match.group("tail") or ""
            try:
                value: float | str = float(value_str)
            except ValueError:
                value = value_str.strip('"')
            unit = _extract_unit(tail)
            missing_units = (
                isinstance(value, float) and unit == ""
            )
            out.append(
                ExtractedParameter(
                    name=name,
                    value=value,
                    unit=unit,
                    missing_units=missing_units,
                    source_line=line_no,
                    source_file=source_file,
                    confidence=0.7 if unit else 0.4,
                    notes=(
                        "unit absent — needs human review (plan §22)"
                        if missing_units
                        else ""
                    ),
                )
            )
        return out


def extract_from_file(
    paper_path: str | Path,
    *,
    extractor: ParameterExtractor | None = None,
) -> list[ExtractedParameter]:
    path = Path(paper_path)
    text = path.read_text(encoding="utf-8", errors="replace")
    extractor = extractor or RegexParameterExtractor()
    rel = path.name if not path.is_absolute() else path.name
    return extractor.extract(text, source_file=rel)


__all__ = [
    "ParameterExtractor",
    "RegexParameterExtractor",
    "extract_from_file",
]
