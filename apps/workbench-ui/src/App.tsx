/**
 * Phase 1F workbench app shell.
 *
 * Routes by panel: simulations, runs, code viewer, docs, diagnostics, plots,
 * capsules. Layout is a left sidebar + main content. The sidebar links use
 * React Router's NavLink so the active panel is highlighted.
 */
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

const NAV: { to: string; label: string }[] = [
  { to: "/simulations", label: "Simulations" },
  { to: "/runs", label: "Run Controls" },
  { to: "/code", label: "Code Viewer" },
  { to: "/diagnostics", label: "Diagnostics" },
  { to: "/plots", label: "Plots" },
  { to: "/capsules", label: "Capsules" },
  { to: "/tools", label: "Tools" },
  { to: "/papers", label: "Papers" },
  { to: "/proposals", label: "Proposals" },
  { to: "/docs", label: "Documentation" },
];

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Scientific Simulation Workbench</h1>
        <nav>
          <ul>
            {NAV.map((entry) => (
              <li key={entry.to}>
                <NavLink
                  to={entry.to}
                  className={({ isActive }) => (isActive ? "active" : undefined)}
                >
                  {entry.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <p className="phase-tag">Phase 1F</p>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/simulations" replace />} />
          <Route path="/simulations" element={<SimulationList />} />
          <Route path="/runs" element={<RunControls />} />
          <Route path="/code" element={<CodeViewer />} />
          <Route path="/diagnostics" element={<DiagnosticsPanel />} />
          <Route path="/plots" element={<PlotPanel />} />
          <Route path="/capsules" element={<CapsuleExplorer />} />
          <Route path="/tools" element={<ToolList />} />
          <Route path="/papers" element={<PaperReview />} />
          <Route path="/proposals" element={<ExperimentProposal />} />
          <Route path="/docs" element={<DocsViewer />} />
          <Route path="/docs/:slug" element={<DocsViewer />} />
          <Route path="*" element={<Navigate to="/simulations" replace />} />
        </Routes>
      </main>
    </div>
  );
}
