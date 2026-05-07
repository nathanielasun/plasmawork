/**
 * SecurityOperationsPanel — frontend binding for secure-core health.
 *
 * The panel reads server-derived session and dashboard state first. If those
 * routes are not mounted in the local dev environment, it falls back to
 * explicit fixtures so layout and capability affordances remain reviewable.
 */
import { useEffect, useMemo, useState } from "react";
import {
  SECURE_CORE_UI_ROUTES,
  secureCoreDashboardFixture,
  secureCoreSessionFixture,
} from "../../api/secureCoreFixtures";
import {
  SecureCoreHttpError,
  secureCoreClient,
  type CurrentSessionResponse,
  type SecureCoreRouteContract,
  type SecureRouteReadiness,
  type SecurityDashboardResponse,
  type SecurityDashboardStatus,
} from "../../api/secureCoreClient";
import { Card, Kpi, Pill, type PillKind } from "../ui";

type LoadMode = "loading" | "live" | "fixture";

interface SecurityState {
  readonly mode: LoadMode;
  readonly session: CurrentSessionResponse | null;
  readonly dashboard: SecurityDashboardResponse | null;
  readonly error: string | null;
}

function statusPillKind(status: SecurityDashboardStatus): PillKind {
  if (status === "healthy") return "trusted";
  if (status === "warning") return "warning";
  return "deprecated";
}

function readinessPillKind(readiness: SecureRouteReadiness): PillKind {
  if (readiness === "ready") return "trusted";
  if (readiness === "fail_closed") return "deprecated";
  if (readiness === "deployment_gated") return "warning";
  return "draft";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "No anchor";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatWindow(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function summarizeSecurityError(error: unknown): string {
  if (error instanceof SecureCoreHttpError) {
    const requestId = error.requestId ? ` request_id=${error.requestId}` : "";
    const code = error.code ? ` ${error.code}` : "";
    return `secure-core returned ${error.status}${code}:${requestId} ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function readinessRows(
  routes: readonly SecureCoreRouteContract[],
): Record<SecureRouteReadiness, number> {
  return routes.reduce(
    (acc, route) => {
      acc[route.readiness] += 1;
      return acc;
    },
    { ready: 0, fail_closed: 0, deployment_gated: 0, planned: 0 },
  );
}

function RouteContractTable({
  routes,
}: {
  routes: readonly SecureCoreRouteContract[];
}): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Route</th>
            <th>Auth</th>
            <th>CSRF</th>
            <th>Approval</th>
            <th>Readiness</th>
            <th>UI surface</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => (
            <tr key={route.id}>
              <td>
                <div className="stack-tight">
                  <strong>{route.id}</strong>
                  <code>
                    {route.method} {route.path}
                  </code>
                  <span className="muted">{route.notes}</span>
                </div>
              </td>
              <td>{route.auth}</td>
              <td>{route.csrf}</td>
              <td>{route.approval}</td>
              <td>
                <Pill kind={readinessPillKind(route.readiness)}>
                  {route.readiness}
                </Pill>
              </td>
              <td>{route.uiSurface}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SecurityOperationsPanel(): JSX.Element {
  const [state, setState] = useState<SecurityState>({
    mode: "loading",
    session: null,
    dashboard: null,
    error: null,
  });

  const refresh = (): void => {
    const controller = new AbortController();
    setState((current) => ({ ...current, mode: "loading", error: null }));
    Promise.all([
      secureCoreClient.currentSession(controller.signal),
      secureCoreClient.securityDashboard(controller.signal),
    ])
      .then(([session, dashboard]) => {
        if (controller.signal.aborted) return;
        setState({ mode: "live", session, dashboard, error: null });
      })
      .catch((error: unknown) => {
        setState({
          mode: "fixture",
          session: secureCoreSessionFixture,
          dashboard: secureCoreDashboardFixture,
          error: summarizeSecurityError(error),
        });
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, mode: "loading", error: null }));
    Promise.all([
      secureCoreClient.currentSession(controller.signal),
      secureCoreClient.securityDashboard(controller.signal),
    ])
      .then(([session, dashboard]) => {
        setState({ mode: "live", session, dashboard, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          mode: "fixture",
          session: secureCoreSessionFixture,
          dashboard: secureCoreDashboardFixture,
          error: summarizeSecurityError(error),
        });
      });
    return () => controller.abort();
  }, []);

  const routeCounts = useMemo(
    () => readinessRows(SECURE_CORE_UI_ROUTES),
    [],
  );
  const session = state.session;
  const dashboard = state.dashboard;
  const primaryMembership = session?.memberships[0] ?? null;
  const highestAnchorLag =
    dashboard?.chains.reduce<number | null>((max, chain) => {
      if (chain.anchorLagMs === null) return max;
      if (max === null) return chain.anchorLagMs;
      return Math.max(max, chain.anchorLagMs);
    }, null) ?? null;
  const deniedTotal =
    dashboard?.deniedAccess.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const sandboxTotal =
    dashboard?.sandboxViolations.reduce((sum, row) => sum + row.count, 0) ?? 0;

  return (
    <article className="page-stack">
      <header className="hero">
        <div className="hero-row">
          <div>
            <p className="hero-eyebrow">Secure multi-user operations</p>
            <h1 className="hero-title">Audit health, session authority, and fail-closed surfaces</h1>
            <p className="hero-subtitle">
              This page binds to secure-core read paths only. Identity,
              workspace memberships, and capabilities are server-derived; the
              UI never accepts actor, role, workspace, or approval claims from
              editable controls.
            </p>
          </div>
          <div className="action-row">
            <Pill kind={state.mode === "live" ? "trusted" : "warning"}>
              {state.mode === "loading"
                ? "loading"
                : state.mode === "live"
                  ? "live backend"
                  : "fixture fallback"}
            </Pill>
            <button type="button" onClick={refresh}>
              Refresh
            </button>
          </div>
        </div>
      </header>

      {state.error && (
        <p className="error" role="alert">
          Secure-core endpoint unavailable; rendering fixture data for layout
          review. {state.error}
        </p>
      )}

      <div className="kpi-strip kpi-strip-wide">
        <Kpi
          label="Dashboard status"
          value={
            dashboard ? (
              <Pill kind={statusPillKind(dashboard.status)}>
                {dashboard.status}
              </Pill>
            ) : (
              "loading"
            )
          }
        />
        <Kpi label="Highest anchor lag" value={formatDuration(highestAnchorLag)} />
        <Kpi label="Denied events" value={deniedTotal} />
        <Kpi label="Sandbox violations" value={sandboxTotal} />
        <Kpi label="Ready routes" value={routeCounts.ready} />
        <Kpi label="Disabled routes" value={routeCounts.fail_closed + routeCounts.deployment_gated + routeCounts.planned} />
      </div>

      <div className="dashboard-grid dashboard-grid-2">
        <Card
          title="Server-derived session"
          subtitle="Capabilities below are display-only. Backend middleware still enforces every route."
          action={
            session ? (
              <Pill kind={session.assurance_level === "aal1" ? "warning" : "trusted"}>
                {session.assurance_level}
              </Pill>
            ) : undefined
          }
        >
          {session ? (
            <div className="stack">
              <div className="detail-grid">
                <span>User</span>
                <code>{session.user_id}</code>
                <span>Session</span>
                <code>{session.session_id}</code>
                <span>Actor type</span>
                <span>{session.actor_type}</span>
                <span>Workspace</span>
                <span>{primaryMembership?.workspace_name ?? "No workspace"}</span>
                <span>Role</span>
                <span>{primaryMembership?.role_name ?? "No role"}</span>
              </div>
              <div className="token-cloud">
                {(primaryMembership?.capabilities ?? []).map((capability) => (
                  <Pill key={capability} kind="model">
                    {capability}
                  </Pill>
                ))}
              </div>
            </div>
          ) : (
            <p className="placeholder">Loading session.</p>
          )}
        </Card>

        <Card
          title="Disabled and gated UI surfaces"
          subtitle="Visible by design so stubs are not confused with missing implementation."
        >
          <div className="stack">
            {SECURE_CORE_UI_ROUTES.filter(
              (route) => route.readiness !== "ready",
            ).map((route) => (
              <div className="route-card route-card-disabled" key={route.id}>
                <div className="route-card-main">
                  <div>
                    <p className="route-card-title">{route.id}</p>
                    <p className="route-card-path">
                      {route.method} {route.path}
                    </p>
                  </div>
                  <Pill kind={readinessPillKind(route.readiness)}>
                    {route.readiness}
                  </Pill>
                </div>
                <p className="route-card-note">{route.notes}</p>
                <button type="button" disabled>
                  Disabled until backend readiness changes
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card
        title="Audit and provenance chain health"
        subtitle="Anchor lag is calculated by secure-core; external WORM readback remains a deployment gate."
      >
        {dashboard ? (
          <div className="dashboard-grid dashboard-grid-3">
            {dashboard.chains.map((chain) => (
              <div className="route-card" key={chain.logType}>
                <div className="route-card-main">
                  <div>
                    <p className="route-card-title">{chain.logType}</p>
                    <p className="route-card-path">
                      {chain.rowsVerified.toLocaleString()} rows verified
                    </p>
                  </div>
                  <Pill kind={statusPillKind(chain.status)}>
                    {chain.status}
                  </Pill>
                </div>
                <div className="detail-grid detail-grid-compact">
                  <span>Anchor lag</span>
                  <span>{formatDuration(chain.anchorLagMs)}</span>
                  <span>Tip hash</span>
                  <code>{chain.tipHash ?? "missing"}</code>
                  <span>External anchor</span>
                  <code>{chain.latestExternalAnchorUri ?? "missing"}</code>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="placeholder">Loading dashboard.</p>
        )}
      </Card>

      <div className="dashboard-grid dashboard-grid-2">
        <Card title="Denied access spikes" subtitle="Counters are keyed by secure-core policy names.">
          {dashboard && dashboard.deniedAccess.length > 0 ? (
            <div className="stack">
              {dashboard.deniedAccess.map((counter) => (
                <div className="counter-row" key={counter.name}>
                  <span>
                    <strong>{counter.name}</strong>
                    <span className="muted"> / {formatWindow(counter.windowMs)}</span>
                  </span>
                  <span className="counter-value">
                    {counter.count}
                    <Pill kind={statusPillKind(counter.status)}>
                      {counter.status}
                    </Pill>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="placeholder">No denied access counters.</p>
          )}
        </Card>

        <Card title="Sandbox violations" subtitle="Any non-zero count must remain highly visible.">
          {dashboard && dashboard.sandboxViolations.length > 0 ? (
            <div className="stack">
              {dashboard.sandboxViolations.map((counter) => (
                <div className="counter-row" key={counter.name}>
                  <span>
                    <strong>{counter.name}</strong>
                    <span className="muted"> / {formatWindow(counter.windowMs)}</span>
                  </span>
                  <span className="counter-value">
                    {counter.count}
                    <Pill kind={statusPillKind(counter.status)}>
                      {counter.status}
                    </Pill>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="placeholder">No sandbox violation counters.</p>
          )}
        </Card>
      </div>

      <Card
        title="Frontend route readiness contract"
        subtitle="The UI can render ready read paths and must keep fail-closed or deployment-gated paths disabled."
      >
        <RouteContractTable routes={SECURE_CORE_UI_ROUTES} />
      </Card>
    </article>
  );
}
