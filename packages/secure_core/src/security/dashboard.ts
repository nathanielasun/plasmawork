import type { AuditLogType, VerifyFailureReason } from "../audit/index.js";

export const SECURITY_DASHBOARD_THRESHOLDS = Object.freeze({
  warningAnchorLagMs: 5 * 60_000,
  criticalAnchorLagMs: 15 * 60_000,
  deniedSpikeWarningCount: 10,
  deniedSpikeCriticalCount: 50,
  sandboxViolationWarningCount: 1,
  sandboxViolationCriticalCount: 5,
});

export type SecurityDashboardStatus = "healthy" | "warning" | "critical";

export interface ChainHealthSignal {
  readonly logType: AuditLogType;
  readonly ok: boolean;
  readonly rowsVerified: number;
  readonly tipHash: string | null;
  readonly failureReason?: VerifyFailureReason;
  readonly latestAnchorCommittedAt: string | null;
  readonly latestExternalAnchorUri: string | null;
}

export interface SecurityCounterSignal {
  readonly name: string;
  readonly count: number;
  readonly windowMs: number;
}

export interface SecurityDashboardInput {
  readonly now: Date;
  readonly chains: readonly ChainHealthSignal[];
  readonly deniedAccess: readonly SecurityCounterSignal[];
  readonly sandboxViolations: readonly SecurityCounterSignal[];
}

export interface ChainHealthSummary extends ChainHealthSignal {
  readonly anchorLagMs: number | null;
  readonly status: SecurityDashboardStatus;
}

export interface SecurityCounterSummary extends SecurityCounterSignal {
  readonly status: SecurityDashboardStatus;
}

export interface SecurityDashboardSnapshot {
  readonly generatedAt: string;
  readonly status: SecurityDashboardStatus;
  readonly chains: readonly ChainHealthSummary[];
  readonly deniedAccess: readonly SecurityCounterSummary[];
  readonly sandboxViolations: readonly SecurityCounterSummary[];
}

export interface SecurityDashboardReader {
  getSecurityDashboard(): Promise<SecurityDashboardSnapshot>;
}

function maxStatus(
  values: readonly SecurityDashboardStatus[],
): SecurityDashboardStatus {
  if (values.includes("critical")) return "critical";
  if (values.includes("warning")) return "warning";
  return "healthy";
}

function chainStatus(
  signal: ChainHealthSignal,
  anchorLagMs: number | null,
): SecurityDashboardStatus {
  if (!signal.ok) return "critical";
  if (signal.latestAnchorCommittedAt === null) return "warning";
  if (
    anchorLagMs !== null &&
    anchorLagMs >= SECURITY_DASHBOARD_THRESHOLDS.criticalAnchorLagMs
  ) {
    return "critical";
  }
  if (
    anchorLagMs !== null &&
    anchorLagMs >= SECURITY_DASHBOARD_THRESHOLDS.warningAnchorLagMs
  ) {
    return "warning";
  }
  return "healthy";
}

function counterStatus(
  count: number,
  warning: number,
  critical: number,
): SecurityDashboardStatus {
  if (count >= critical) return "critical";
  if (count >= warning) return "warning";
  return "healthy";
}

function anchorLag(now: Date, committedAt: string | null): number | null {
  if (committedAt === null) return null;
  const parsed = new Date(committedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, now.getTime() - parsed.getTime());
}

export function buildSecurityDashboard(
  input: SecurityDashboardInput,
): SecurityDashboardSnapshot {
  const chains = input.chains.map((signal): ChainHealthSummary => {
    const lag = anchorLag(input.now, signal.latestAnchorCommittedAt);
    return {
      ...signal,
      anchorLagMs: lag,
      status: chainStatus(signal, lag),
    };
  });

  const deniedAccess = input.deniedAccess.map(
    (counter): SecurityCounterSummary => ({
      ...counter,
      status: counterStatus(
        counter.count,
        SECURITY_DASHBOARD_THRESHOLDS.deniedSpikeWarningCount,
        SECURITY_DASHBOARD_THRESHOLDS.deniedSpikeCriticalCount,
      ),
    }),
  );

  const sandboxViolations = input.sandboxViolations.map(
    (counter): SecurityCounterSummary => ({
      ...counter,
      status: counterStatus(
        counter.count,
        SECURITY_DASHBOARD_THRESHOLDS.sandboxViolationWarningCount,
        SECURITY_DASHBOARD_THRESHOLDS.sandboxViolationCriticalCount,
      ),
    }),
  );

  return {
    generatedAt: input.now.toISOString(),
    status: maxStatus([
      ...chains.map((c) => c.status),
      ...deniedAccess.map((c) => c.status),
      ...sandboxViolations.map((c) => c.status),
    ]),
    chains,
    deniedAccess,
    sandboxViolations,
  };
}
