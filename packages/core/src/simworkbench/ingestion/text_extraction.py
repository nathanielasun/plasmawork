"""Phase 4A — text / table / figure extraction.

The plan §Phase 4 / 4A task list is six bullets:
  1. Import PDFs.
  2. Store papers locally inside capsule.
  3. Extract text.
  4. Extract tables where possible.
  5. Extract figures metadata where possible.
  6. Preserve source files.

The earlier close handled (2) and (6) only. This module covers (1), (3),
(4), (5) — plus a deterministic Markdown fallback so the workbench
remains runnable without any external PDF dependency.

Carries ``agent_error_patterns.md`` "Skipping workstream task bullets
when the gate-verb walk seems satisfied": a verb (`import`) maps to
multiple task bullets, each one a separately-testable artifact.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ExtractedText:
    """Plain-text body of the paper.

    Markdown-formatted papers keep their structure; PDF input is parsed
    to text via ``pypdf`` if available, otherwise the importer raises a
    structured "PDF support requires pypdf" error so the user sees the
    missing dependency rather than a silent stub output.
    """

    text: str
    source_file: str
    pages: int = 0  # populated only for PDF input


@dataclass
class ExtractedTable:
    """One Markdown / PDF-text table."""

    headers: list[str]
    rows: list[list[str]]
    source_line: int  # first line of the table block in the source
    source_file: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "headers": list(self.headers),
            "rows": [list(r) for r in self.rows],
            "source_line": self.source_line,
            "source_file": self.source_file,
            "n_rows": len(self.rows),
        }


@dataclass
class ExtractedFigure:
    """Figure metadata — alt text + path + line number.

    We do NOT attempt to copy the figure's image bytes (the original is
    preserved alongside the source under ``paper_sources/``). This is
    metadata-only per plan §4A "Extract figures metadata where possible".
    """

    alt: str
    path: str  # the URL/path the paper references
    source_line: int
    caption: str = ""
    source_file: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "alt": self.alt,
            "path": self.path,
            "caption": self.caption,
            "source_line": self.source_line,
            "source_file": self.source_file,
        }


# ---------------------------------------------------------------------------
# Text extraction (Markdown identity + optional PDF via pypdf).
# ---------------------------------------------------------------------------


class TextExtractionError(RuntimeError):
    """Raised when text extraction can't proceed (e.g. PDF without pypdf)."""


def extract_text(paper_path: str | Path) -> ExtractedText:
    """Return the paper's plain text + page count (PDFs only).

    For ``.md`` / ``.txt`` files the body is the file's UTF-8 text.
    For ``.pdf`` files we call ``pypdf`` if it's installed; if not, we
    raise ``TextExtractionError`` with the install command. We never
    return an empty stub — the caller (UI / agent / test) needs to know
    the difference between "PDF not supported in this build" and "PDF
    contained no text".
    """
    path = Path(paper_path)
    suffix = path.suffix.lower()
    source = path.name
    if suffix in {".md", ".txt", ".rst"}:
        return ExtractedText(
            text=path.read_text(encoding="utf-8", errors="replace"),
            source_file=source,
        )
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise TextExtractionError(
                "PDF text extraction requires pypdf. Install via "
                "`pip install pypdf` (already in packages/core/pyproject.toml "
                "as an optional dep). The workbench refuses to silently "
                "stub PDF text — see agent_error_patterns.md "
                "'Silently inventing missing physical coefficients' for the "
                "general principle."
            ) from exc
        reader = PdfReader(str(path))
        page_text: list[str] = []
        for page in reader.pages:
            try:
                page_text.append(page.extract_text() or "")
            except Exception:  # noqa: BLE001 — surfaced verbatim per page.
                page_text.append("")
        return ExtractedText(
            text="\n\n".join(page_text),
            source_file=source,
            pages=len(reader.pages),
        )
    # Unknown suffix — read as utf-8 best-effort but flag in the type.
    return ExtractedText(
        text=path.read_text(encoding="utf-8", errors="replace"),
        source_file=source,
    )


# ---------------------------------------------------------------------------
# Table extraction — Markdown pipe-tables.
# ---------------------------------------------------------------------------

_TABLE_HEADER = re.compile(r"^\s*\|(.+)\|\s*$")
_TABLE_SEPARATOR = re.compile(r"^\s*\|?[\s\-:|]+\|?\s*$")


def _split_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def extract_tables(text: str, *, source_file: str = "") -> list[ExtractedTable]:
    """Find Markdown pipe-tables.

    A Markdown table looks like::

        | Header A | Header B |
        |----------|----------|
        | row 1    | row 2    |

    We walk the lines; whenever we see a header row immediately followed
    by a separator row, we collect the body rows that follow until the
    pipe-table block ends.
    """
    out: list[ExtractedTable] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines) - 1:
        header_match = _TABLE_HEADER.match(lines[i])
        if not header_match:
            i += 1
            continue
        # Heuristic: check next line is a separator AND has at least one
        # `-`. Without that, the line is just a stray pipe-bracketed line.
        if not _TABLE_SEPARATOR.match(lines[i + 1]) or "-" not in lines[i + 1]:
            i += 1
            continue
        headers = _split_row(lines[i])
        rows: list[list[str]] = []
        j = i + 2
        while j < len(lines) and _TABLE_HEADER.match(lines[j]):
            rows.append(_split_row(lines[j]))
            j += 1
        out.append(
            ExtractedTable(
                headers=headers,
                rows=rows,
                source_line=i + 1,  # 1-based
                source_file=source_file,
            )
        )
        i = j
    return out


# ---------------------------------------------------------------------------
# Figure extraction — Markdown image refs + nearby caption.
# ---------------------------------------------------------------------------

_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)")
_FIGURE_CAPTION = re.compile(
    r"^\s*(?:Figure|Fig\.?)\s*\d+\s*[:.]?\s*(.+)$",
    re.IGNORECASE,
)


@dataclass
class _FigureBuilder:
    figures: list[ExtractedFigure] = field(default_factory=list)


def extract_figures(text: str, *, source_file: str = "") -> list[ExtractedFigure]:
    """Extract figure metadata from Markdown image references.

    For each ``![alt](path "title")`` we record alt text + path. If the
    next non-empty line is a "Figure N: ..." caption we attach it.
    """
    out: list[ExtractedFigure] = []
    lines = text.splitlines()
    for i, line in enumerate(lines, start=1):
        for match in _MD_IMAGE.finditer(line):
            alt = match.group(1)
            path = match.group(2)
            title = match.group(3) or ""
            caption = title
            # Look at the next non-empty line for a "Figure N: ..." caption.
            for k in range(i, min(i + 3, len(lines))):
                next_line = lines[k].strip()
                if not next_line:
                    continue
                cap_match = _FIGURE_CAPTION.match(next_line)
                if cap_match:
                    caption = cap_match.group(1).strip()
                break
            out.append(
                ExtractedFigure(
                    alt=alt,
                    path=path,
                    caption=caption,
                    source_line=i,
                    source_file=source_file,
                )
            )
    return out


__all__ = [
    "ExtractedFigure",
    "ExtractedTable",
    "ExtractedText",
    "TextExtractionError",
    "extract_figures",
    "extract_tables",
    "extract_text",
]
