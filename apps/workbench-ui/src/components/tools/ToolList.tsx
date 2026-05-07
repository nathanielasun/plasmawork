/**
 * ToolList — top-level internal tools panel.
 *
 * Loads registered tools, presents a compact activity/feature navigator, and
 * gives the schema-bound workbench the main page width.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient, type ToolIndexRow, type ToolStatus as Status } from "../../api/client";
import { Card, Kpi, Pill, type PillKind } from "../ui";
import ToolDetail from "./ToolDetail";
import ToolWorkbench from "./ToolWorkbench";

interface ToolFeatureGroup {
  id: string;
  title: string;
  description: string;
  matchers: string[];
  limit: number;
}

interface ToolLibraryProps {
  tools: ToolIndexRow[];
  selectedTool: ToolIndexRow | null;
  query: string;
  usageCounts: Record<string, number>;
  onQueryChange: (query: string) => void;
  onSelect: (name: string) => void;
}

interface ToolLibraryRowProps {
  row: ToolIndexRow;
  selected: boolean;
  usageCount: number;
  onSelect: (name: string) => void;
}

const TOOL_USAGE_STORAGE_KEY = "workbench:tool-library-usage-counts";
const SEARCH_RESULT_LIMIT = 8;

const TOOL_FEATURE_GROUPS: readonly ToolFeatureGroup[] = [
  {
    id: "data-io",
    title: "Data I/O",
    description: "Importers, exporters, adapters, and file transforms.",
    matchers: ["import", "export", "adapter", "table", "data_io", "dataset"],
    limit: 3,
  },
  {
    id: "diagnostics",
    title: "Diagnostics & analysis",
    description: "Measurement, reports, spectra, and post-run analysis.",
    matchers: ["diagnostic", "analysis", "report", "spectrum", "sensitivity", "measure"],
    limit: 3,
  },
  {
    id: "validation",
    title: "Validation & benchmarks",
    description: "Regression cases, benchmark checks, and promotion evidence.",
    matchers: ["validator", "validation", "benchmark", "test", "shock", "reference"],
    limit: 3,
  },
  {
    id: "visualization",
    title: "Visualization & diagrams",
    description: "Plotters, diagrams, heatmaps, and visual previews.",
    matchers: ["visual", "plot", "diagram", "heatmap", "scatter", "graph"],
    limit: 3,
  },
  {
    id: "physics",
    title: "Physics & solvers",
    description: "Physics helpers, model utilities, and solver-facing tools.",
    matchers: ["physics", "solver", "model", "plasma", "chemistry", "coefficient"],
    limit: 3,
  },
];

const FALLBACK_TOOL_FEATURE_GROUP: ToolFeatureGroup = {
  id: "utilities",
  title: "Utilities",
  description: "General registry, workflow, and automation tools.",
  matchers: [],
  limit: 3,
};

const STATUS_SCORE: Record<Status, number> = {
  trusted: 80,
  validated: 70,
  candidate: 45,
  draft: 20,
  deprecated: -50,
};

function statusKind(status: Status): PillKind {
  if (status === "trusted") return "trusted";
  if (status === "validated") return "validated";
  if (status === "candidate") return "candidate";
  if (status === "deprecated") return "deprecated";
  return "draft";
}

function readToolUsageCounts(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TOOL_USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const counts: Record<string, number> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        counts[name] = Math.min(Math.floor(value), 9999);
      }
    }
    return counts;
  } catch {
    return {};
  }
}

function writeToolUsageCounts(counts: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOOL_USAGE_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // Usage counts are a convenience signal; storage failures must not break selection.
  }
}

function toolSearchText(row: ToolIndexRow): string {
  return [row.name, row.type, row.version, row.status, row.directory].join(" ").toLowerCase();
}

function toolFeatureGroup(row: ToolIndexRow): ToolFeatureGroup {
  const text = toolSearchText(row);
  return (
    TOOL_FEATURE_GROUPS.find((group) =>
      group.matchers.some((matcher) => text.includes(matcher)),
    ) ?? FALLBACK_TOOL_FEATURE_GROUP
  );
}

function toolScore(
  row: ToolIndexRow,
  usageCounts: Record<string, number>,
  selectedName: string | null,
): number {
  const selectedBoost = row.name === selectedName ? 10_000 : 0;
  const usageBoost = (usageCounts[row.name] ?? 0) * 1_000;
  return selectedBoost + usageBoost + STATUS_SCORE[row.status];
}

function sortTools(
  rows: readonly ToolIndexRow[],
  usageCounts: Record<string, number>,
  selectedName: string | null,
): ToolIndexRow[] {
  return [...rows].sort((a, b) => {
    const scoreDelta = toolScore(b, usageCounts, selectedName) - toolScore(a, usageCounts, selectedName);
    if (scoreDelta !== 0) return scoreDelta;
    return a.name.localeCompare(b.name);
  });
}

function ToolLibraryRow({ row, selected, usageCount, onSelect }: ToolLibraryRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.name)}
      className={`list-row tool-library-row${selected ? " list-row-active" : ""}`}
      aria-pressed={selected}
    >
      <span className="list-row-main">
        <strong>{row.name}</strong>
        <span className="muted">{row.type} · {row.version}</span>
      </span>
      <span className="tool-library-row-meta">
        {usageCount > 0 && <span className="tool-usage-badge">{usageCount} use{usageCount === 1 ? "" : "s"}</span>}
        <Pill kind={statusKind(row.status)}>{row.status}</Pill>
      </span>
    </button>
  );
}

function ToolLibrary({
  tools,
  selectedTool,
  query,
  usageCounts,
  onQueryChange,
  onSelect,
}: ToolLibraryProps) {
  const selectedName = selectedTool?.name ?? null;
  const normalizedQuery = query.trim().toLowerCase();

  const searchMatches = useMemo(() => {
    if (!normalizedQuery) return [];
    return sortTools(
      tools.filter((tool) => toolSearchText(tool).includes(normalizedQuery)),
      usageCounts,
      selectedName,
    );
  }, [normalizedQuery, selectedName, tools, usageCounts]);

  const activeAndFrequent = useMemo(() => {
    const rows: ToolIndexRow[] = [];
    const seen = new Set<string>();
    if (selectedTool) {
      rows.push(selectedTool);
      seen.add(selectedTool.name);
    }
    for (const tool of sortTools(
      tools.filter((row) => (usageCounts[row.name] ?? 0) > 0 && !seen.has(row.name)),
      usageCounts,
      selectedName,
    )) {
      rows.push(tool);
      seen.add(tool.name);
      if (rows.length >= 4) break;
    }
    return rows;
  }, [selectedName, selectedTool, tools, usageCounts]);

  const featureBuckets = useMemo(() => {
    const groups = [...TOOL_FEATURE_GROUPS, FALLBACK_TOOL_FEATURE_GROUP];
    return groups
      .map((group) => {
        const matchingRows = tools.filter((tool) => toolFeatureGroup(tool).id === group.id);
        return {
          group,
          total: matchingRows.length,
          rows: sortTools(matchingRows, usageCounts, selectedName).slice(0, group.limit),
        };
      })
      .filter((bucket) => bucket.total > 0);
  }, [selectedName, tools, usageCounts]);

  return (
    <Card
      title="Tool library"
      subtitle="Curated by active use and feature area. Search for exact registry lookup."
      className="tools-library"
    >
      <div className="tool-library-summary">
        <Pill kind="diagnostic">{tools.length} registered</Pill>
        <span>Showing a capped working set instead of the full registry.</span>
      </div>

      <div className="form-grid form-grid-single">
        <label>
          <span className="eyebrow">Search tools</span>
          <input
            type="search"
            placeholder="name, feature, type, status"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Search tools"
          />
        </label>
      </div>

      {normalizedQuery ? (
        <section className="tool-group">
          <div className="row-between">
            <h3>Search matches</h3>
            <Pill kind="diagnostic">{searchMatches.length}</Pill>
          </div>
          <div className="list-stack list-stack-condensed">
            {searchMatches.slice(0, SEARCH_RESULT_LIMIT).map((row) => (
              <ToolLibraryRow
                key={row.name}
                row={row}
                selected={selectedName === row.name}
                usageCount={usageCounts[row.name] ?? 0}
                onSelect={onSelect}
              />
            ))}
            {searchMatches.length === 0 && (
              <p className="tool-library-empty">No matching tools. Try a feature, type, or status.</p>
            )}
            {searchMatches.length > SEARCH_RESULT_LIMIT && (
              <p className="tool-group-more">
                Showing top {SEARCH_RESULT_LIMIT} of {searchMatches.length}; narrow the search to reveal more.
              </p>
            )}
          </div>
        </section>
      ) : (
        <div className="tool-feature-list">
          {activeAndFrequent.length > 0 && (
            <section className="tool-group">
              <div className="row-between">
                <h3>Active & frequent</h3>
                <Pill kind="diagnostic">{activeAndFrequent.length}</Pill>
              </div>
              <div className="list-stack list-stack-condensed">
                {activeAndFrequent.map((row) => (
                  <ToolLibraryRow
                    key={row.name}
                    row={row}
                    selected={selectedName === row.name}
                    usageCount={usageCounts[row.name] ?? 0}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          )}

          {featureBuckets.map((bucket, index) => (
            <details
              key={bucket.group.id}
              className="tool-feature-group"
              open={index < 3 || bucket.rows.some((row) => row.name === selectedName)}
            >
              <summary>
                <span className="tool-feature-heading">
                  <strong>{bucket.group.title}</strong>
                  <span>{bucket.group.description}</span>
                </span>
                <Pill kind="diagnostic">{bucket.total}</Pill>
              </summary>
              <div className="list-stack list-stack-condensed">
                {bucket.rows.map((row) => (
                  <ToolLibraryRow
                    key={row.name}
                    row={row}
                    selected={selectedName === row.name}
                    usageCount={usageCounts[row.name] ?? 0}
                    onSelect={onSelect}
                  />
                ))}
                {bucket.total > bucket.rows.length && (
                  <p className="tool-group-more">
                    {bucket.total - bucket.rows.length} more hidden. Search this feature to narrow the registry.
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function ToolList() {
  const [tools, setTools] = useState<ToolIndexRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>(() => readToolUsageCounts());

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

  const selectTool = useCallback((name: string) => {
    setSelected(name);
    setUsageCounts((current) => {
      const next = { ...current, [name]: (current[name] ?? 0) + 1 };
      writeToolUsageCounts(next);
      return next;
    });
  }, []);

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
          <p className="hero-eyebrow">Internal tools</p>
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
            <p className="hero-eyebrow">Internal tools</p>
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
        <div className="tools-primary-stack">
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

        <aside className="tools-side-rail" aria-label="Tool navigation and imports">
          <ToolLibrary
            tools={tools}
            selectedTool={selectedTool}
            query={query}
            usageCounts={usageCounts}
            onQueryChange={setQuery}
            onSelect={selectTool}
          />

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
        </aside>
      </div>
    </article>
  );
}
