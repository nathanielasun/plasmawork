/**
 * ToolList — Phase 3D top-level tools panel.
 *
 * Lists registered tools (from GET /api/tools) and drills into a selected
 * tool's detail panel. The list is grouped by `type` so users can find
 * diagnostics / visualizations / etc. quickly.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient, type ToolIndexRow, type ToolStatus as Status } from "../../api/client";
import { Card, Kpi, Pill, type PillKind } from "../ui";
import ToolDetail from "./ToolDetail";
import ToolWorkbench from "./ToolWorkbench";

function statusKind(status: Status): PillKind {
  if (status === "trusted") return "trusted";
  if (status === "validated") return "validated";
  if (status === "candidate") return "candidate";
  if (status === "deprecated") return "deprecated";
  return "draft";
}

export default function ToolList() {
  const [tools, setTools] = useState<ToolIndexRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  useEffect(() => {
    if (selected !== null || tools === null || tools.length === 0) return;
    setSelected(tools[0].name);
  }, [selected, tools]);

  const importExternal = async () => {
    if (!importPath.trim() || !importName.trim()) {
      setImportStatus("Both source path and target name are required.");
      return;
    }
    setImportStatus("Importing…");
    try {
      await apiClient.importTool(importPath.trim(), importName.trim());
      setImportStatus(`Imported as ${importName.trim()}.`);
      setImportPath("");
      setImportName("");
      refresh();
    } catch (e) {
      setImportStatus(`Import failed: ${e}`);
    }
  };

  const filteredTools = useMemo(() => {
    if (tools === null) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tools;
    return tools.filter((tool) =>
      [tool.name, tool.type, tool.version, tool.status, tool.directory]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, tools]);

  const byType = useMemo(() => {
    const grouped = new Map<string, ToolIndexRow[]>();
    for (const row of filteredTools) {
      if (!grouped.has(row.type)) grouped.set(row.type, []);
      grouped.get(row.type)!.push(row);
    }
    return grouped;
  }, [filteredTools]);

  const selectedTool =
    tools?.find((tool) => tool.name === selected) ??
    filteredTools[0] ??
    null;
  const statusCounts = useMemo(() => {
    const rows = tools ?? [];
    return {
      total: rows.length,
      trusted: rows.filter((tool) => tool.status === "trusted").length,
      validated: rows.filter((tool) => tool.status === "validated").length,
      candidate: rows.filter((tool) => tool.status === "candidate").length,
      draft: rows.filter((tool) => tool.status === "draft").length,
    };
  }, [tools]);

  if (error) {
    return (
      <article className="page-stack">
        <header className="hero">
          <p className="hero-eyebrow">Phase 3D · Internal tools</p>
          <h1 className="hero-title">Tool registry unavailable</h1>
          <p className="hero-subtitle">
            The panel could not load the registry-backed tool list.
          </p>
        </header>
        <p className="error" role="alert">
          Backend unavailable: {error}
        </p>
      </article>
    );
  }
  if (tools === null) return <p className="placeholder">Loading tools…</p>;

  return (
    <article className="page-stack">
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Phase 3D · Internal tools</p>
            <h1 className="hero-title">Tools and tool construction</h1>
            <p className="hero-subtitle">
              Registry tools remain inspectable, testable, exportable, and
              lifecycle-gated. User imports copy into{" "}
              <code>local_cache/imported_tools/</code>; promotion still uses
              server-side approval evidence, never client-supplied actor claims.
            </p>
          </div>
          <div className="action-row">
            <button type="button" className="primary" onClick={refresh}>
              Refresh registry
            </button>
          </div>
        </div>
      </header>

      <div className="kpi-strip kpi-strip-wide">
        <Kpi label="Registered tools" value={statusCounts.total} />
        <Kpi label="Trusted" value={statusCounts.trusted} />
        <Kpi label="Validated" value={statusCounts.validated} />
        <Kpi label="Candidates" value={statusCounts.candidate} />
        <Kpi label="Drafts" value={statusCounts.draft} />
      </div>

      {tools.length === 0 && (
        <p className="placeholder">
          No tools registered yet. Copy a template from{" "}
          <code>packages/internal_tools/templates/</code> into the registry
          and run <code>./scripts/dev/refresh_registry.sh</code>.
        </p>
      )}

      <div className="tools-layout">
        <Card
          title="Tool library"
          subtitle="Search and select a registry entry."
          className="tools-library"
        >
          <div className="form-grid form-grid-single">
            <label>
              <span className="eyebrow">Search tools</span>
              <input
                type="search"
                placeholder="name, type, status, version"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search tools"
              />
            </label>
          </div>

          <div className="stack">
            {Array.from(byType.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([type, rows]) => (
                <section className="tool-group" key={type}>
                  <div className="row-between">
                    <h3>{type}</h3>
                    <Pill kind="diagnostic">{rows.length}</Pill>
                  </div>
                  <div className="list-stack">
                    {rows.map((row) => (
                      <button
                        key={row.name}
                        type="button"
                        onClick={() => setSelected(row.name)}
                        className={`list-row${selectedTool?.name === row.name ? " list-row-active" : ""}`}
                        aria-pressed={selectedTool?.name === row.name}
                      >
                        <span className="list-row-main">
                          <strong>{row.name}</strong>
                          <span className="muted">{row.type} · {row.version}</span>
                        </span>
                        <Pill kind={statusKind(row.status)}>{row.status}</Pill>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        </Card>

        <div className="stack">
          <Card
            title="Import external tool"
            subtitle="Copies a tool tree into local_cache/imported_tools/ after backend path validation."
          >
            <div className="form-grid">
              <label>
                <span className="eyebrow">Source path</span>
                <input
                  type="text"
                  placeholder="/path/to/external/tool"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  aria-label="Source path"
                />
              </label>
              <label>
                <span className="eyebrow">Target name</span>
                <input
                  type="text"
                  placeholder="my_imported_tool"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  aria-label="Target name"
                />
              </label>
            </div>
            <div className="action-row action-row-start">
              <button type="button" className="primary" onClick={importExternal}>
                Import
              </button>
              <span className="muted">
                Requires <code>tool.yaml</code>; path escapes are refused.
              </span>
            </div>
            {importStatus && <p className="muted">{importStatus}</p>}
          </Card>

          {selectedTool ? (
            <ToolWorkbench toolName={selectedTool.name} />
          ) : (
            <Card title="Tool workbench" subtitle="Select a tool to load schema-bound controls.">
              <p className="placeholder">No tool selected.</p>
            </Card>
          )}

          {selectedTool ? (
            <ToolDetail toolName={selectedTool.name} onStatusChanged={refresh} />
          ) : (
            <Card title="Tool contract">
              <p className="placeholder">Select a tool to inspect metadata.</p>
            </Card>
          )}
        </div>
      </div>
    </article>
  );
}
