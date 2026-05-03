"""Phase 6E — Validation Run.

Plan §Phase 6 / 6E enumerates five task bullets:

  1. Run small simulation.
  2. Collect diagnostics.
  3. Generate plots.
  4. Generate validation summary.
  5. Mark validation status.

Output lives under ``<capsule>/validation/`` (sandbox-allowed root):

  - ``validation/validation_summary.md`` — Markdown report covering each
    of the five §6E bullets.
  - ``validation/status.yaml`` — machine-readable validation status
    (``passed`` / ``failed`` / ``incomplete``) the UI consumes.
  - ``validation/plots/<diagnostic>.csv`` — series the UI plotting layer
    can render. We emit CSV (not PNG) so the runner stays
    matplotlib-free; the visualization role plots from the CSV.

The runner **executes the generated** ``<capsule>/src/generated/run.py``
so a corrupted generated artifact actually fails validation. Earlier
the validator reloaded ``model/model_spec.yaml`` and ran ``Runner``
directly — bypassing the generated code entirely. Carries
`agent_error_patterns.md` "Validation runs the source-of-truth, not
the generated artifact".

Plan §15.2: the generated experiment uses the project's vetted Phase-1
``Runner`` — NEVER a hand-rolled timestep loop. We don't validate
that here (the test generator's smoke test does); we just exec
``run.py`` and surface whatever happens.
"""

from __future__ import annotations

import runpy
from datetime import UTC, datetime
from pathlib import Path

import yaml

from .sandbox import sandboxed_write


class ValidationRunner:
    """Execute the generated experiment and write a validation summary.

    We import the generated ``src/generated/run.py`` via ``runpy`` so
    syntax errors, import errors, runtime exceptions all bubble up as
    ``failed`` validation status. The earlier implementation bypassed
    the generated artifact entirely.
    """

    def run(self, capsule_dir: str | Path) -> Path:
        capsule = Path(capsule_dir)
        spec_path = capsule / "model" / "model_spec.yaml"
        if not spec_path.is_file():
            raise FileNotFoundError(
                f"No ModelSpec under {capsule}; run CodeGenerator first."
            )
        generated = capsule / "src" / "generated"
        experiment_module = generated / "experiment.py"
        if not experiment_module.is_file():
            raise FileNotFoundError(
                f"No generated experiment at {experiment_module}; "
                "run CodeGenerator first."
            )

        # Read spec for header/summary metadata only — the actual run goes
        # through the generated artifact below.
        from simworkbench.model_spec import load_yaml

        spec = load_yaml(spec_path)

        # Execute the generated experiment.py through runpy so syntax /
        # import / runtime errors in the generated tree show up as a
        # validation failure. ``experiment.py`` uses absolute imports
        # (``from simworkbench…``) so it runs cleanly without being
        # mounted as a package.
        try:
            namespace = runpy.run_path(
                str(experiment_module), run_name="__capsule_validation__"
            )
            run_fn = namespace.get("run")
            if not callable(run_fn):
                raise RuntimeError(
                    "Generated experiment.py did not expose a callable "
                    "'run'. Regenerate before re-running validation."
                )
            _experiment, result = run_fn()
            run_state = result.state.value
            elapsed = result.elapsed_seconds
            t_final = result.final_simulation_time
            diagnostics = {k: list(v) for k, v in result.diagnostics.items()}
            placeholders = list(result.placeholders)
            failure: str | None = None
        except Exception as exc:  # noqa: BLE001 — every failure mode is "failed".
            run_state = "failed"
            elapsed = 0.0
            t_final = 0.0
            diagnostics = {}
            placeholders = []
            failure = f"{type(exc).__name__}: {exc}"

        # 6E.3 — write each diagnostic as CSV under validation/plots/.
        plot_paths: list[str] = []
        for name, series in diagnostics.items():
            if name == "time_seconds" or not isinstance(series, list):
                continue
            times = diagnostics.get("time_seconds") or list(range(len(series)))
            csv = "t_seconds,value\n" + "\n".join(
                f"{t},{v}" for t, v in zip(times, series, strict=False)
            ) + "\n"
            relative = f"validation/plots/{_safe(name)}.csv"
            sandboxed_write(capsule, relative, csv)
            plot_paths.append(relative)

        # 6E.5 — validation status (machine-readable).
        if failure is not None:
            status = "failed"
        elif placeholders:
            status = "incomplete"
        else:
            status = "passed"

        status_yaml = yaml.safe_dump(
            {
                "validation_status": status,
                "ran_at": _utc_now_iso(),
                "final_simulation_time_seconds": t_final,
                "elapsed_seconds": elapsed,
                "run_state": run_state,
                "placeholders": placeholders,
                "failure": failure or "",
                "plots": plot_paths,
            },
            sort_keys=False,
        )
        sandboxed_write(capsule, "validation/status.yaml", status_yaml)

        # 6E.4 — Markdown summary.
        summary = _render_summary(
            spec_name=spec.model.name,
            domain=spec.model.domain,
            run_state=run_state,
            t_final=t_final,
            elapsed=elapsed,
            diagnostics=diagnostics,
            placeholders=placeholders,
            plot_paths=plot_paths,
            status=status,
            failure=failure,
        )
        return sandboxed_write(capsule, "validation/validation_summary.md", summary)


def _render_summary(
    *,
    spec_name: str,
    domain: str,
    run_state: str,
    t_final: float,
    elapsed: float,
    diagnostics: dict[str, list[float]],
    placeholders: list[str],
    plot_paths: list[str],
    status: str,
    failure: str | None,
) -> str:
    diag_lines = (
        "\n".join(
            f"- `{name}` — {len(series)} samples"
            for name, series in diagnostics.items()
            if name != "time_seconds"
        )
        or "_No diagnostics emitted; reviewer adds before promotion._"
    )
    plot_lines = (
        "\n".join(f"- `{p}`" for p in plot_paths)
        or "_No plots emitted (no series-shaped diagnostics)._"
    )
    placeholder_block = (
        "Placeholder coefficients used: "
        + ", ".join(f"`{p}`" for p in placeholders)
        if placeholders
        else "No placeholder coefficients used."
    )
    failure_block = (
        f"\n\n## Failure\n\n```\n{failure}\n```\n" if failure else ""
    )
    return (
        f"# Validation summary — {spec_name}\n\n"
        f"- Domain: `{domain}`\n"
        f"- Run state: `{run_state}`\n"
        f"- Final simulation time: {t_final:.6g} s\n"
        f"- Wallclock: {elapsed:.3f} s\n\n"
        "## Run\n\n"
        "Phase-1 `Runner` on `python_cpu` backend (plan §15.2: scipy-vetted "
        "LSODA, never a hand-rolled timestep loop).\n\n"
        "## Diagnostics\n\n"
        f"{diag_lines}\n\n"
        f"{placeholder_block}\n\n"
        "## Plots\n\n"
        f"{plot_lines}\n\n"
        "## Validation status\n\n"
        f"`{status}`\n\n"
        + (
            "Placeholder coefficients ⇒ `incomplete`. Reviewer must source "
            "real values before promotion to `passed`.\n"
            if status == "incomplete"
            else "" if status != "failed"
            else "Run failed; see Failure section.\n"
        )
        + failure_block
    )


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in name)


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


__all__ = ["ValidationRunner"]
