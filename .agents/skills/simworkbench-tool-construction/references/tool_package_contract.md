# TOOL-CONTRACT Tool Package Contract

Internal tools live under `packages/internal_tools/registry/<tool_name>/`.
Use the closest template from `packages/internal_tools/templates/` and keep
all paths package-relative.

## Required Package Shape

```text
tool.yaml
README.md
src/
tests/
docs/        # recommended until Stage 2 makes this schema-backed
examples/    # recommended until Stage 2 makes this schema-backed
assumptions.md
changelog.md
```

`tool.yaml` is the contract. Source code implements it; UI and API surfaces
derive from it. Do not let implementation behavior drift from the metadata.

## Required `tool.yaml` Fields

- `name`: registry identifier, lowercase snake case preferred.
- `version`: semantic version string.
- `type`: import, diagnostic, visualization, validation, export, solver,
  physics, paper_extraction, or automation.
- `description`: user-facing purpose.
- `author`: creator or owner.
- `status`: `draft`, `candidate`, `validated`, `trusted`, or `deprecated`.
- `entrypoint`: `relative/path.py:ClassName`.
- `inputs`: list of ports.
- `outputs`: list of ports.
- `compatible_domains`: list of domain identifiers.
- `requires`: dependency declaration.
- `validation`: test/reference-case declaration.

## Port Rules

Each input/output port declares `name`, `type`, and `description`.

Array ports must declare `units`, including `dimensionless` when appropriate.
Raw unitless arrays are not allowed at scientific boundaries.

Prefer these port types:

- `scalar`
- `array`
- `table`
- `timeseries`
- `heatmap`
- `particle_scatter`
- `image`
- `diagram`
- `file`
- `json`
- `report`
- `string`
- `bool`
- `enum`
- `capsule`

## Paths

Declared paths are package-relative. Reject absolute paths, `~`, URL schemes,
null bytes, and any `..` path segment. Do not put server storage paths,
content hashes, actors, workspace ids, or lifecycle state in request bodies or
client-owned metadata.

## Lifecycle

Agents can create `draft` and `candidate` tools. Promotion to `validated` or
`trusted` requires registry/service enforcement, validation evidence, and
human approval where required. Do not expose `skip_approval`, `run_tests=false`,
or similar bypasses.
