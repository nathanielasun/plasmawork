# Diagnostic tool template

Starting point for a diagnostic tool — peak finders, energy budgets,
density histograms, etc. Diagnostic tools read run diagnostics and emit
derived metrics; they typically don't write back to the capsule.

## Quickstart

1. Copy this directory into the registry:
   ```bash
   cp -r packages/internal_tools/templates/diagnostic \
         packages/internal_tools/registry/<your_tool_name>
   ```
   (or use `ToolRegistry.register_from_template` from a Python REPL / the UI.)
2. Edit `tool.yaml`: set `name`, `description`, `inputs`, `outputs`.
3. Edit `src/tool.py`: rename `DiagnosticTemplate` to your tool's class name
   and update `tool.yaml`'s `entrypoint:` accordingly.
4. Add tests under `tests/`; the registry's promotion-to-validated check
   runs every entry in `validation.tests`.
5. Refresh: `./scripts/dev/refresh_registry.sh`.
