"""Deterministic seed handling.

Every run derives its RNG state from a base seed (default in
``configs/default.yaml``) and a stable run identifier. Same base + same run
id → same trajectory on the same backend, so a run can be replayed exactly
from its `provenance.lock`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SeedSet:
    """A bundle of derived seeds for one run.

    ``base_seed`` is the project-wide default; ``run_id`` is the stable
    identifier of this run; ``physics`` and ``solver`` are derived per-stream
    seeds so the runtime can swap one without disturbing the other.
    """

    base_seed: int
    run_id: str
    physics: int
    solver: int

    def numpy_generator(self, stream: str = "physics") -> np.random.Generator:
        """Return a NumPy ``Generator`` for the named stream.

        Streams: ``"physics"`` (Monte Carlo, stochastic ICs), ``"solver"``
        (solver-internal randomization, e.g. randomized linear-algebra).
        """
        if stream == "physics":
            return np.random.default_rng(self.physics)
        if stream == "solver":
            return np.random.default_rng(self.solver)
        raise ValueError(
            f"Unknown seed stream {stream!r}; known streams are 'physics' and 'solver'."
        )


def derive(base_seed: int, run_id: str) -> SeedSet:
    """Derive a deterministic ``SeedSet`` from ``base_seed`` and ``run_id``.

    Hash-based derivation is stable across Python sessions and platforms
    (BLAKE2 is keyed and fixed-size). Same inputs always produce the same
    integer outputs in [0, 2**63).
    """
    return SeedSet(
        base_seed=base_seed,
        run_id=run_id,
        physics=_derive_one(base_seed, run_id, "physics"),
        solver=_derive_one(base_seed, run_id, "solver"),
    )


def _derive_one(base_seed: int, run_id: str, stream: str) -> int:
    payload = f"{base_seed}|{run_id}|{stream}".encode()
    digest = hashlib.blake2b(payload, digest_size=8).digest()
    # Mask top bit so the result fits in a signed 63-bit int (numpy-friendly).
    return int.from_bytes(digest, "big") & ((1 << 63) - 1)


__all__ = ["SeedSet", "derive"]
