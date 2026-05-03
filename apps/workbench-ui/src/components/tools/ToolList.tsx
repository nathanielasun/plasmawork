/**
 * ToolList — Phase 3D top-level tools panel.
 *
 * Lists registered tools (from GET /api/tools) and drills into a selected
 * tool's detail panel. The list is grouped by `type` so users can find
 * diagnostics / visualizations / etc. quickly.
 */
import { useCallback, useEffect, useState } from "react";
import { apiClient, type ToolIndexRow } from "../../api/client";
import ToolDetail from "./ToolDetail";

export default function ToolList() {
  const [tools, setTools] = useState<ToolIndexRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    apiClient
      .listTools()
      .then((rows) => setTools(rows))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error)
    return (
      <article>
        <h2>Internal Tools</h2>
        <p className="placeholder">Backend unavailable: {error}</p>
      </article>
    );
  if (tools === null) return <p className="placeholder">Loading tools…</p>;

  const byType = new Map<string, ToolIndexRow[]>();
  for (const row of tools) {
    if (!byType.has(row.type)) byType.set(row.type, []);
    byType.get(row.type)!.push(row);
  }

  return (
    <article>
      <h2>Internal Tools</h2>
      <p>
        Tools registered under <code>packages/internal_tools/registry/</code>
        and the user-imported cache at{" "}
        <code>local_cache/imported_tools/</code>. Click a tool to see its
        full metadata, lifecycle, and documentation.
      </p>

      {tools.length === 0 && (
        <p className="placeholder">
          No tools registered yet. Copy a template from{" "}
          <code>packages/internal_tools/templates/</code> into the registry
          and run <code>./scripts/dev/refresh_registry.sh</code>.
        </p>
      )}

      {Array.from(byType.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, rows]) => (
          <section key={type}>
            <h3>{type}</h3>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelected(row.name)}
                        className="text-button"
                        aria-pressed={selected === row.name}
                      >
                        <code>{row.name}</code>
                      </button>
                    </td>
                    <td>{row.version}</td>
                    <td>
                      <span className={`badge badge-${row.status}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

      {selected && (
        <section>
          <ToolDetail toolName={selected} onStatusChanged={refresh} />
        </section>
      )}
    </article>
  );
}
