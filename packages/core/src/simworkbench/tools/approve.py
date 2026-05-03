"""Local CLI for granting single-use tool-promotion approvals.

Usage::

    python -m simworkbench.tools.approve <name> <to_status> [--from <status>] [--reviewer <name>]

Writes a single-use token under
``<repo>/local_cache/tool_approvals/<name>__<from>-to-<to>.approval``.
The HTTP API consumes (reads + deletes) the token on the next
``POST /api/tools/<name>/status`` for the matching transition.

This is the deliberate path for human-only promotions:
``validated`` and ``trusted``. It exists so the HTTP endpoint never
trusts a client-supplied actor field — see
`agent_error_patterns.md` "Trusting a client-supplied actor identity
for a privileged check".
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from .approval import grant_approval
from .registry import ToolRegistry


def _parse(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="simworkbench.tools.approve",
        description=(
            "Grant a single-use approval token for a tool lifecycle "
            "promotion. The HTTP API consumes the token on the next "
            "matching POST /api/tools/<name>/status request."
        ),
    )
    parser.add_argument("name", help="Tool name (as listed in the registry).")
    parser.add_argument(
        "to_status",
        choices=["validated", "trusted", "deprecated"],
        help="Target lifecycle state.",
    )
    parser.add_argument(
        "--from",
        dest="from_status",
        default=None,
        help=(
            "Override the source lifecycle state. Defaults to the tool's "
            "current state in the registry."
        ),
    )
    parser.add_argument(
        "--reviewer",
        default="local",
        help=(
            "Reviewer identifier recorded in the token (auditable). "
            "The agent's own identity is not a valid reviewer."
        ),
    )
    return parser.parse_args(list(argv))


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse(argv if argv is not None else sys.argv[1:])
    from_status = args.from_status
    if from_status is None:
        registry = ToolRegistry()
        try:
            entry = registry.get(args.name)
        except Exception as exc:  # noqa: BLE001
            print(f"error: {exc}", file=sys.stderr)
            return 2
        from_status = entry.status.value
    target = grant_approval(
        args.name,
        from_status=from_status,
        to_status=args.to_status,
        reviewer=args.reviewer,
    )
    print(f"granted: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
