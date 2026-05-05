/**
 * Workbench app shell. Layout is a collapsible left sidebar + main
 * content area. The sidebar links use React Router's NavLink so the
 * active panel is highlighted; collapsed state persists across reloads
 * via localStorage.
 */
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import SimulationList from "./components/SimulationList";
import RunControls from "./components/RunControls";
import CodeViewer from "./components/CodeViewer";
import DocsViewer from "./components/DocsViewer";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import PlotPanel from "./components/PlotPanel";
import CapsuleExplorer from "./components/CapsuleExplorer";
import ToolList from "./components/tools/ToolList";
import PaperReview from "./components/papers/PaperReview";
import ExperimentProposal from "./components/proposal/ExperimentProposal";
import GeneratedCodeView from "./components/codegen/GeneratedCodeView";
import ComparisonReportPanel from "./components/reports/ComparisonReport";
import AutonomyPanel from "./components/autonomy/AutonomyPanel";
import ExamplesGallery from "./components/examples/ExamplesGallery";

interface NavEntry {
  readonly to: string;
  readonly label: string;
  readonly short: string; // shown when sidebar is collapsed
}

const NAV: readonly NavEntry[] = [
  { to: "/examples", label: "Examples", short: "Ex" },
  { to: "/simulations", label: "Simulations", short: "Sim" },
  { to: "/runs", label: "Run Controls", short: "Run" },
  { to: "/code", label: "Code Viewer", short: "Code" },
  { to: "/diagnostics", label: "Diagnostics", short: "Diag" },
  { to: "/plots", label: "Plots", short: "Plot" },
  { to: "/capsules", label: "Capsules", short: "Caps" },
  { to: "/tools", label: "Tools", short: "Tool" },
  { to: "/papers", label: "Papers", short: "Pap" },
  { to: "/proposals", label: "Proposals", short: "Prop" },
  { to: "/codegen", label: "Generated Code", short: "Gen" },
  { to: "/comparisons", label: "Comparisons", short: "Comp" },
  { to: "/autonomy", label: "Autonomy", short: "Auto" },
  { to: "/docs", label: "Documentation", short: "Docs" },
];

const STORAGE_KEY = "workbench:sidebar-collapsed";

function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function App(): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // localStorage unavailable (private mode, jsdom in test) — ignore.
    }
  }, [collapsed]);

  const toggle = (): void => setCollapsed((v) => !v);

  return (
    <div className={`layout${collapsed ? " layout-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-header">
          {!collapsed && <h1>Scientific Simulation Workbench</h1>}
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
        <nav>
          <ul>
            {NAV.map((entry) => (
              <li key={entry.to}>
                <NavLink
                  to={entry.to}
                  className={({ isActive }) => (isActive ? "active" : undefined)}
                  title={collapsed ? entry.label : undefined}
                >
                  {collapsed ? (
                    <span className="sidebar-short">{entry.short}</span>
                  ) : (
                    entry.label
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {!collapsed && <p className="phase-tag">Phase 10</p>}
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/examples" replace />} />
          <Route path="/examples" element={<ExamplesGallery />} />
          <Route path="/simulations" element={<SimulationList />} />
          <Route path="/runs" element={<RunControls />} />
          <Route path="/code" element={<CodeViewer />} />
          <Route path="/diagnostics" element={<DiagnosticsPanel />} />
          <Route path="/plots" element={<PlotPanel />} />
          <Route path="/capsules" element={<CapsuleExplorer />} />
          <Route path="/tools" element={<ToolList />} />
          <Route path="/papers" element={<PaperReview />} />
          <Route path="/proposals" element={<ExperimentProposal />} />
          <Route path="/codegen" element={<GeneratedCodeView />} />
          <Route path="/comparisons" element={<ComparisonReportPanel />} />
          <Route path="/autonomy" element={<AutonomyPanel />} />
          <Route path="/docs" element={<DocsViewer />} />
          <Route path="/docs/:slug" element={<DocsViewer />} />
          <Route path="*" element={<Navigate to="/examples" replace />} />
        </Routes>
      </main>
    </div>
  );
}
