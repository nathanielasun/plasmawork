# TOOL-UI-BINDING and TOOL-ARTIFACT-IO UI Binding Contract

The UI binds to a normalized, validated tool contract. Components do not infer
privileged behavior from free-form strings and do not call `fetch` directly.

## Input Binding

Render inputs from declared ports:

- `scalar`: numeric field; show units when declared.
- `array`: artifact/file selector with preview and unit validation.
- `table`: CSV/JSON artifact selector, schema preview, and column mapper.
- `string`: text field or editor based on `ui.widget`.
- `bool`: checkbox.
- `enum`: select.
- `file`: artifact picker/upload; never raw server paths in secure mode.
- `capsule`: workspace-scoped capsule selector.

Validation errors must remain visible. Long labels wrap; tables scroll inside
their panel; disabled controls state the reason.

## Output Binding

Render outputs by declared kind:

- `scalar`: metric card with units.
- `table`: table viewer with column metadata and export action.
- `timeseries`: line plot.
- `heatmap`: matrix/field plot.
- `particle_scatter`: scatter renderer.
- `image`: safe image artifact display.
- `diagram`: structured JSON graph, flow, schema, or pipeline renderer.
- `file`: artifact card with hash, MIME type, size, and provenance.
- `report`: sanitized Markdown preview.
- `json`: collapsible JSON tree.

Unknown output kinds render a safe unsupported-state panel. Raw HTML,
executable JavaScript, iframes, and arbitrary SVG payloads are refused.

## Metadata Shape

Optional Stage-2 metadata may include:

```yaml
ui:
  display_name: Cross-section Table Importer
  input_groups:
    - id: source
      title: Source Data
      ports: [file, units, column_map]
  output_views:
    - port: normalized_table
      renderer: table

artifacts:
  outputs:
    - name: normalized_table
      kind: table
      mime_type: application/json
```

Metadata describes UI affordances and output kinds. The server still derives
storage paths, content hashes, actor identity, workspace scope, timestamps, and
object state.
