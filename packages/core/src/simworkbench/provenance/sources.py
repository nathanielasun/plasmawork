"""Phase 2B — Source-file hash registry.

Tracks SHA-256 hashes of capsule files so that ``provenance.lock`` can
record an integrity stamp and so that fork chains have a stable parent
identifier. Hashes the *input-side* subtrees: paper sources, model spec,
configs, and source code. Output-side subtrees (results/, validation/,
notebooks/) are deliberately excluded — re-running a capsule must not
shift its identity hash.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

# Subtrees the registry hashes by default. ``paper_sources/`` is included so
# editing the source paper shifts the capsule's identity hash — without it,
# a paper edit would be invisible in the provenance chain (regression for
# the post-Phase-2-close finding "source hashing ignores paper_sources/").
# ``results/`` is intentionally excluded so re-running a capsule's diagnostics
# (which is expected, idempotent) doesn't shift the identity hash.
DEFAULT_SUBTREES: tuple[str, ...] = (
    "paper_sources",
    "model",
    "configs",
    "src",
)


@dataclass(frozen=True)
class FileHash:
    """One file's hash record."""

    path: str  # capsule-relative
    sha256: str
    size_bytes: int


class SourceRegistry:
    """Computes and serializes per-file hashes for a capsule's source subtrees."""

    def __init__(self, capsule_dir: str | Path) -> None:
        self.capsule_dir = Path(capsule_dir)

    def hash_files(
        self,
        subtrees: Iterable[str] = DEFAULT_SUBTREES,
    ) -> tuple[FileHash, ...]:
        """Return file hashes for every regular file under each subtree.

        ``.gitkeep`` placeholders are included so empty Phase-2-deferred
        subdirs still appear in the registry — the empty-marker file is
        part of the capsule's identity.
        """
        out: list[FileHash] = []
        for sub in subtrees:
            base = self.capsule_dir / sub
            if not base.is_dir():
                continue
            for f in _iter_files(base):
                rel = f.relative_to(self.capsule_dir).as_posix()
                out.append(_hash_one(self.capsule_dir, rel))
        # Stable ordering — capsule diffs are reproducible.
        out.sort(key=lambda h: h.path)
        return tuple(out)

    def aggregate_hash(
        self,
        subtrees: Iterable[str] = DEFAULT_SUBTREES,
    ) -> str:
        """Combine per-file hashes into a single SHA-256 over
        ``"<path> <sha256>\n"`` lines. Used as the parent_capsule_hash on a
        fork."""
        rows = "\n".join(
            f"{h.path} {h.sha256}" for h in self.hash_files(subtrees=subtrees)
        )
        return hashlib.sha256(rows.encode("utf-8")).hexdigest()

    def find_missing(
        self,
        expected: Iterable[FileHash],
    ) -> tuple[str, ...]:
        """Return the relative paths of expected files that are missing or
        have a hash mismatch on disk."""
        missing: list[str] = []
        for record in expected:
            target = self.capsule_dir / record.path
            if not target.is_file():
                missing.append(record.path)
                continue
            actual = _hash_one(self.capsule_dir, record.path)
            if actual.sha256 != record.sha256:
                missing.append(record.path)
        return tuple(missing)


def _iter_files(base: Path) -> Iterator[Path]:
    for path in base.rglob("*"):
        if path.is_file():
            yield path


def _hash_one(capsule_dir: Path, rel: str) -> FileHash:
    path = capsule_dir / rel
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
            size += len(chunk)
    return FileHash(path=rel, sha256=digest.hexdigest(), size_bytes=size)


__all__ = ["DEFAULT_SUBTREES", "FileHash", "SourceRegistry"]
