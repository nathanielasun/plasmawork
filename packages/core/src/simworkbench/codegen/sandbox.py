"""Phase 6B — Code-generation sandbox.

The sandbox is the single producer-side gate for every file the code
generator writes. It carries `agent_error_patterns.md`:

- "Overwriting `<capsule>/src/user_edits/`" — every write is checked
  BEFORE the open() call; user_edits/, paper_sources/, and
  provenance/ are off-limits.
- "Side-effecting before validating" — sandboxed_write validates the
  destination first, only then opens the file.
- "Hard rule made optional via a client-controlled API parameter" —
  there is no ``allow_user_edits_overwrite`` knob. Library callers
  cannot opt out; API endpoints don't accept the field.
"""

from __future__ import annotations

from pathlib import Path

ALLOWED_GENERATED_SUBDIR = Path("src") / "generated"
ALLOWED_VALIDATION_SUBDIR = Path("validation")

OFF_LIMITS_SUBDIRS: tuple[Path, ...] = (
    Path("src") / "user_edits",
    Path("paper_sources"),
    Path("provenance"),
)


class SandboxViolation(PermissionError):
    """Raised when the generator tries to write outside its allowed area."""


def _resolve_under(capsule: Path, target: Path) -> Path:
    """Return ``target`` resolved under ``capsule``; raise on path escape.

    Honors agent_error_patterns.md "Side-effecting before validating".
    """
    capsule_resolved = capsule.resolve()
    target_resolved = target.resolve() if target.is_absolute() else (
        capsule_resolved / target
    ).resolve()
    try:
        target_resolved.relative_to(capsule_resolved)
    except ValueError as exc:
        raise SandboxViolation(
            f"Refusing to write outside the capsule: {target_resolved} "
            f"is not under {capsule_resolved}."
        ) from exc
    return target_resolved


def _is_under(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def sandboxed_write(
    capsule_dir: Path,
    relative_path: str | Path,
    content: str,
    *,
    allowed_roots: tuple[Path, ...] = (
        ALLOWED_GENERATED_SUBDIR,
        ALLOWED_VALIDATION_SUBDIR,
    ),
) -> Path:
    """Write ``content`` to ``capsule_dir / relative_path``, refusing
    paths that fall outside the allowed roots or land in any off-limits
    subtree (user_edits/, paper_sources/, provenance/).

    Returns the absolute path written.
    """
    capsule = Path(capsule_dir)
    target = Path(relative_path)
    if target.is_absolute():
        raise SandboxViolation(
            f"sandboxed_write expects a capsule-relative path; got absolute "
            f"{target}."
        )

    resolved = _resolve_under(capsule, target)
    capsule_resolved = capsule.resolve()
    relative_resolved = resolved.relative_to(capsule_resolved)

    # Off-limits check fires before the allowed-roots check so the error
    # message names user_edits/ specifically (the most common mistake).
    for forbidden in OFF_LIMITS_SUBDIRS:
        if _is_under(capsule_resolved / relative_resolved, capsule_resolved / forbidden):
            raise SandboxViolation(
                f"Refusing to write under {forbidden}/: {relative_resolved}. "
                "The code-generation sandbox treats user_edits/, paper_sources/, "
                "and provenance/ as off-limits."
            )

    if not any(
        _is_under(capsule_resolved / relative_resolved, capsule_resolved / root)
        for root in allowed_roots
    ):
        raise SandboxViolation(
            f"Refusing to write outside the code-generation allowed roots "
            f"{[str(r) for r in allowed_roots]}: {relative_resolved}."
        )

    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(content, encoding="utf-8")
    return resolved


__all__ = [
    "ALLOWED_GENERATED_SUBDIR",
    "ALLOWED_VALIDATION_SUBDIR",
    "OFF_LIMITS_SUBDIRS",
    "SandboxViolation",
    "sandboxed_write",
]
