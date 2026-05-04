"""Phase 7C boundary-condition library — candidate.

Small catalog of supported boundary kinds. Each kind has a free-form
description plus a dimensionalities list; consumers (field solvers,
particle pushers) declare which kinds they accept.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BoundaryKind:
    """One catalog entry."""

    name: str
    description: str
    dimensionalities: tuple[int, ...]


CATALOG: dict[str, BoundaryKind] = {
    "periodic": BoundaryKind(
        name="periodic",
        description="Wraps both fields and particles across the boundary.",
        dimensionalities=(1, 2, 3),
    ),
    "conducting": BoundaryKind(
        name="conducting",
        description=(
            "Perfect electric conductor: tangential E = 0, normal B = 0."
        ),
        dimensionalities=(1, 2, 3),
    ),
    "absorbing": BoundaryKind(
        name="absorbing",
        description=(
            "First-order Mur absorbing boundary; outgoing waves leave "
            "the domain with minimal reflection."
        ),
        dimensionalities=(1, 2, 3),
    ),
    "reflecting": BoundaryKind(
        name="reflecting",
        description=(
            "Particles reflect specularly; fields obey the conducting "
            "wall condition."
        ),
        dimensionalities=(1, 2, 3),
    ),
    "mirror": BoundaryKind(
        name="mirror",
        description=(
            "Symmetry plane: only particles whose normal velocity points "
            "into the domain are integrated."
        ),
        dimensionalities=(2, 3),
    ),
}


def lookup(name: str) -> BoundaryKind:
    """Return a ``BoundaryKind`` by name; raise ``KeyError`` if unknown."""
    if name not in CATALOG:
        raise KeyError(
            f"Unknown boundary kind {name!r}. Known: "
            f"{sorted(CATALOG.keys())}."
        )
    return CATALOG[name]


def kinds_for_dimensionality(dimensionality: int) -> list[str]:
    """List boundary kinds compatible with the given dimensionality."""
    return [
        bk.name for bk in CATALOG.values() if dimensionality in bk.dimensionalities
    ]


__all__ = ["BoundaryKind", "CATALOG", "kinds_for_dimensionality", "lookup"]
