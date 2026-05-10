/**
 * Workbench app shell. Layout is a collapsible left sidebar + main
 * content area. The sidebar links use React Router's NavLink so the
 * active panel is highlighted; collapsed state persists across reloads
 * via localStorage.
 *
 * Phase 0.5 / Phase F-rest-final (2026-05-09): the protected app shell
 * is wrapped in SessionGuard so unauthenticated users are redirected
 * to /login. The /login route is registered OUTSIDE the guard so it
 * can render for unauthenticated users without an infinite redirect
 * loop.
 */
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
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
import SecurityOperationsPanel from "./components/security/SecurityOperationsPanel";
import LoginPage from "./app/login/page";
import { SessionGuard } from "./components/auth/SessionGuard";
import { WorkspaceSwitcher } from "./components/auth/WorkspaceSwitcher";
import { LogoutButton } from "./components/auth/LogoutButton";

interface NavEntry {
  readonly to: string;
  readonly label: string;
  readonly icon: string; // shown when sidebar is collapsed
}

const NAV: readonly NavEntry[] = [
  { to: "/examples", label: "Examples", icon: "◇" },
  { to: "/simulations", label: "Simulations", icon: "◎" },
  { to: "/runs", label: "Run Controls", icon: "▷" },
  { to: "/code", label: "Code Viewer", icon: "⌘" },
  { to: "/diagnostics", label: "Diagnostics", icon: "∿" },
  { to: "/plots", label: "Plots", icon: "⌁" },
  { to: "/capsules", label: "Capsules", icon: "▣" },
  { to: "/tools", label: "Tools", icon: "⚒" },
  { to: "/papers", label: "Papers", icon: "¶" },
  { to: "/proposals", label: "Proposals", icon: "△" },
  { to: "/codegen", label: "Generated Code", icon: "⌬" },
  { to: "/comparisons", label: "Comparisons", icon: "≋" },
  { to: "/autonomy", label: "Autonomy", icon: "∞" },
  { to: "/security", label: "Security Ops", icon: "§" },
  { to: "/docs", label: "Documentation", icon: "▤" },
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

/**
 * The authenticated app shell — sidebar with workspace switcher and
 * sign-out button, plus the main content area with the protected
 * routes. Rendered inside SessionGuard so useSession() resolves and
 * the workspace context is populated before any /api/:slug/... call
 * fires.
 */
function AppShell(): JSX.Element {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);
  const isDocsRoute =
    location.pathname === "/docs" || location.pathname.startsWith("/docs/");

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
        {!collapsed && (
          <div className="sidebar-workspace">
            <WorkspaceSwitcher />
          </div>
        )}
        <nav>
          <ul>
            {NAV.map((entry) => (
              <li key={entry.to}>
                <NavLink
                  to={entry.to}
                  className={({ isActive }) => (isActive ? "active" : undefined)}
                  aria-label={collapsed ? entry.label : undefined}
                  title={collapsed ? entry.label : undefined}
                >
                  {collapsed ? (
                    <span className="sidebar-icon" aria-hidden="true">
                      {entry.icon}
                    </span>
                  ) : (
                    entry.label
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {!collapsed && <p className="phase-tag">Phase 10</p>}
        {!collapsed && (
          <div className="sidebar-footer">
            <LogoutButton />
          </div>
        )}
      </aside>
      <main className={isDocsRoute ? "main-docs" : undefined}>
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
          <Route path="/security" element={<SecurityOperationsPanel />} />
          <Route path="/docs" element={<DocsViewer />} />
          <Route path="/docs/:slug" element={<DocsViewer />} />
          <Route path="*" element={<Navigate to="/examples" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <SessionGuard>
            <AppShell />
          </SessionGuard>
        }
      />
    </Routes>
  );
}
