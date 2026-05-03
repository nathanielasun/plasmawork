"""Phase 4B — Equation extraction.

Default implementation is regex-based and deterministic: scans for LaTeX
display blocks (``$$...$$``), inline math (``$...$``), and `\\begin
{equation}...\\end{equation}` environments. Each hit becomes an
``ExtractedEquation`` with a stable id, the source line, and a
confidence score that depends on the pattern and length of the match.

Real interpretation needs an LLM. The extractor is structured as an ABC
so a future LLM-backed implementation can replace the default without
changing the pipeline. The default ships because the workbench must
remain runnable without an external API key (plan §1 — local-first).
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from pathlib import Path

from .paper import ExtractedEquation


class EquationExtractor(ABC):
    """Pluggable equation extractor."""

    @abstractmethod
    def extract(self, text: str, *, source_file: str = "") -> list[ExtractedEquation]:
        """Return one ``ExtractedEquation`` per detected equation."""


# ---------------------------------------------------------------------------
# Default regex-based implementation.
# ---------------------------------------------------------------------------

_DISPLAY = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
_INLINE = re.compile(r"(?<!\$)\$([^$\n]+)\$(?!\$)")
_ENV = re.compile(
    r"\\begin\{equation\*?\}(.+?)\\end\{equation\*?\}", re.DOTALL
)


class RegexEquationExtractor(EquationExtractor):
    """Default extractor — regex-based; deterministic and offline-safe."""

    def extract(self, text: str, *, source_file: str = "") -> list[ExtractedEquation]:
        equations: list[ExtractedEquation] = []
        seen_at: list[tuple[int, str]] = []  # (offset, body) — dedupe
        for pattern, kind, conf in (
            (_ENV, "env", 0.9),
            (_DISPLAY, "display", 0.8),
            (_INLINE, "inline", 0.6),
        ):
            for match in pattern.finditer(text):
                body = match.group(1).strip()
                start = match.start()
                if (start, body) in seen_at:
                    continue
                seen_at.append((start, body))
                line_no = text.count("\n", 0, start) + 1
                # Inline equations with too few mathy characters get a
                # confidence haircut — `$x$` alone is rarely useful.
                conf_adj = conf
                if kind == "inline" and len(body) < 4:
                    conf_adj = 0.3
                equations.append(
                    ExtractedEquation(
                        id=f"eq_{len(equations) + 1:03d}",
                        text=body,
                        latex=body,
                        source_line=line_no,
                        source_file=source_file,
                        confidence=conf_adj,
                        notes=f"detected via {kind} pattern",
                    )
                )
        # Stable ordering by source line so re-runs produce identical output.
        equations.sort(key=lambda e: e.source_line)
        # Reassign ids in line-order so eq_001 is always the first equation.
        for i, eq in enumerate(equations, start=1):
            eq.id = f"eq_{i:03d}"
        return equations


def extract_from_file(
    paper_path: str | Path,
    *,
    extractor: EquationExtractor | None = None,
) -> list[ExtractedEquation]:
    """Read the paper file and return extracted equations."""
    path = Path(paper_path)
    text = path.read_text(encoding="utf-8", errors="replace")
    extractor = extractor or RegexEquationExtractor()
    rel = path.name if not path.is_absolute() else path.name
    return extractor.extract(text, source_file=rel)


__all__ = ["EquationExtractor", "RegexEquationExtractor", "extract_from_file"]
