# TOOL-VALIDATION and TOOL-PROMOTION Validation Checklist

Run this checklist before closing a tool task or requesting promotion.

## Contract Checks

- `tool.yaml` exists and parses to a mapping.
- Required fields are present and non-blank.
- Unknown top-level keys fail unless intentionally added to the schema.
- `entrypoint` has `relative/path.py:ClassName` format and resolves inside
  the package.
- Every array input/output declares units.
- Validation test paths exist and remain inside the package.
- README exists. Tests, examples, docs, assumptions, and changelog are present
  where feasible.

## Implementation Checks

- Tool subclasses `BaseTool`.
- `validate_inputs` rejects malformed inputs before `run`.
- `run` returns declared outputs only.
- No raw floats cross scientific boundaries without units.
- No path traversal, absolute path, or home-directory expansion is accepted.
- Missing coefficients or unsupported regimes are surfaced explicitly.

## UI Checks

- UI controls derive from the contract.
- API calls go through the typed client.
- Table and diagram outputs render without overlap.
- Unsupported renderers fail safely.
- Disabled controls explain missing permission, approval, validation, or
  backend availability.

## Security Checks

- No client-supplied actor, workspace, storage, hash, status, or timestamp is
  trusted.
- High-risk actions consume approval before side effects.
- Artifact writes reserve quota and clean up on failure.
- Audit/provenance records are emitted for create, deny, fail, complete,
  export, and promotion request.

## Commands

```bash
.agents/skills/simworkbench-tool-construction/scripts/check_tool_package.py packages/internal_tools/registry/<tool_name>
pytest packages/internal_tools/registry/<tool_name>/tests
scripts/dev/check_repo_conventions.sh
```
