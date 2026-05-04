"""Local CLI for granting single-use module-promotion approvals.

Usage::

    python -m simworkbench.modules.approve <name> <to_status> [--from <status>] [--reviewer <name>]

Writes a single-use token under
``<repo>/local_cache/module_approvals/<name>__<from>-to-<to>.approval``.
``ModuleRegistry.set_status`` consumes the token at the same mutation
boundary that rewrites ``module.yaml``.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from .approval import grant_module_approval
from .registry import ModuleRegistry


def _parse(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="simworkbench.modules.approve",
        description=(
            "Grant a single-use approval token for a module lifecycle "
            "promotion. ModuleRegistry.set_status consumes the token on "
            "the next matching transition."
        ),
    )
    parser.add_argument("name", help="Module name as listed in the registry.")
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
            "Override the source lifecycle state. Defaults to the module's "
            "current state in the registry."
        ),
    )
    parser.add_argument(
        "--reviewer",
        default="local",
        help=(
            "Reviewer identifier recorded in the token. The agent's own "
            "identity is not a valid reviewer."
        ),
    )
    return parser.parse_args(list(argv))


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse(argv if argv is not None else sys.argv[1:])
    from_status = args.from_status
    if from_status is None:
        registry = ModuleRegistry()
        try:
            entry = registry.get(args.name)
        except Exception as exc:  # noqa: BLE001
            print(f"error: {exc}", file=sys.stderr)
            return 2
        from_status = entry.status.value
    target = grant_module_approval(
        args.name,
        from_status=from_status,
        to_status=args.to_status,
        reviewer=args.reviewer,
    )
    print(f"granted: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
