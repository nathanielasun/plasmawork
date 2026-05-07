import type { SecureCorePool } from "../db/pool.js";
import type {
  AuditChainVerifier,
  AuditLogType,
  VerifyReport,
} from "../audit/index.js";
import {
  buildSecurityDashboard,
  type ChainHealthSignal,
  type SecurityCounterSignal,
  type SecurityDashboardReader,
  type SecurityDashboardSnapshot,
} from "./dashboard.js";

const LOG_TYPES = ["audit", "provenance", "operator"] as const satisfies
  readonly AuditLogType[];

const ANCHOR_LOG_TYPE = Object.freeze({
  audit: "audit_events",
  provenance: "provenance_events",
  operator: "operator_events",
} satisfies Record<AuditLogType, string>);

export const DEFAULT_SECURITY_DASHBOARD_WINDOW_MS = 5 * 60_000;

export const DENIED_ACCESS_DASHBOARD_ACTIONS = [
  "permission.denied",
  "path_access.denied",
  "csrf.failed",
  "origin.mismatch",
  "rate_limit.triggered",
  "worker.upload_denied",
] as const;

export const SANDBOX_DASHBOARD_ACTIONS = [
  "sandbox.violation",
] as const;

export type DashboardAuditAction =
  | (typeof DENIED_ACCESS_DASHBOARD_ACTIONS)[number]
  | (typeof SANDBOX_DASHBOARD_ACTIONS)[number];

export type DashboardVerifierMap = Readonly<
  Record<AuditLogType, Pick<AuditChainVerifier, "verifyAll">>
>;

export interface DashboardAnchorRow {
  readonly committedAt: string | null;
  readonly externalAnchorUri: string | null;
}

export interface DashboardEventCount {
  readonly action: DashboardAuditAction;
  readonly count: number;
}

export interface SecurityDashboardDataSource {
  latestAnchor(logType: AuditLogType): Promise<DashboardAnchorRow>;
  countAuditEvents(
    actions: readonly DashboardAuditAction[],
    since: Date,
  ): Promise<readonly DashboardEventCount[]>;
}

export interface SqlSecurityDashboardDataSourceOptions {
  readonly auditReadPool: SecureCorePool;
}

function coerceCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function isDashboardAuditAction(
  value: unknown,
): value is DashboardAuditAction {
  return (
    typeof value === "string" &&
    ((DENIED_ACCESS_DASHBOARD_ACTIONS as readonly string[]).includes(value) ||
      (SANDBOX_DASHBOARD_ACTIONS as readonly string[]).includes(value))
  );
}

export class SqlSecurityDashboardDataSource
implements SecurityDashboardDataSource {
  readonly #pool: SecureCorePool;

  public constructor(opts: SqlSecurityDashboardDataSourceOptions) {
    if (opts.auditReadPool.role !== "audit_read") {
      throw new Error(
        `SqlSecurityDashboardDataSource requires role="audit_read"; got "${opts.auditReadPool.role}"`,
      );
    }
    this.#pool = opts.auditReadPool;
  }

  public async latestAnchor(
    logType: AuditLogType,
  ): Promise<DashboardAnchorRow> {
    const rows = await this.#pool.sql<
      Array<{
        committed_at: Date;
        external_anchor_uri: string;
      }>
    >`
      SELECT committed_at, external_anchor_uri
      FROM log_chain_anchors
      WHERE log_type = ${ANCHOR_LOG_TYPE[logType]}
      ORDER BY committed_at DESC, id DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) {
      return { committedAt: null, externalAnchorUri: null };
    }
    return {
      committedAt: row.committed_at.toISOString(),
      externalAnchorUri: row.external_anchor_uri,
    };
  }

  public async countAuditEvents(
    actions: readonly DashboardAuditAction[],
    since: Date,
  ): Promise<readonly DashboardEventCount[]> {
    if (actions.length === 0) {
      return [];
    }
    const rows = await this.#pool.sql<
      Array<{ action: string; count: string | number | bigint }>
    >`
      SELECT action, COUNT(*) AS count
      FROM audit_events
      WHERE action = ANY(${actions as readonly string[]})
        AND created_at >= ${since}
      GROUP BY action
    `;
    return rows.flatMap((row): DashboardEventCount[] => {
      if (!isDashboardAuditAction(row.action)) {
        return [];
      }
      return [{ action: row.action, count: coerceCount(row.count) }];
    });
  }
}

export interface SecurityDashboardServiceOptions {
  readonly source: SecurityDashboardDataSource;
  readonly verifiers: DashboardVerifierMap;
  readonly now?: () => Date;
  readonly windowMs?: number;
}

function verifierErrorReport(): VerifyReport {
  return {
    ok: false,
    rowsVerified: 0,
    firstFailureRowId: "dashboard:verifier",
    failureReason: "verifier_error",
  };
}

async function safeVerify(
  verifier: Pick<AuditChainVerifier, "verifyAll">,
): Promise<VerifyReport> {
  try {
    return await verifier.verifyAll();
  } catch {
    return verifierErrorReport();
  }
}

function countFor(
  rows: readonly DashboardEventCount[],
  action: DashboardAuditAction,
): number {
  return rows.find((row) => row.action === action)?.count ?? 0;
}

export class SecurityDashboardService implements SecurityDashboardReader {
  readonly #source: SecurityDashboardDataSource;
  readonly #verifiers: DashboardVerifierMap;
  readonly #now: () => Date;
  readonly #windowMs: number;

  public constructor(opts: SecurityDashboardServiceOptions) {
    this.#source = opts.source;
    this.#verifiers = opts.verifiers;
    this.#now = opts.now ?? (() => new Date());
    this.#windowMs = opts.windowMs ?? DEFAULT_SECURITY_DASHBOARD_WINDOW_MS;
    if (!Number.isInteger(this.#windowMs) || this.#windowMs <= 0) {
      throw new Error("SecurityDashboardService windowMs must be positive");
    }
  }

  public async getSecurityDashboard(): Promise<SecurityDashboardSnapshot> {
    const now = this.#now();
    const since = new Date(now.getTime() - this.#windowMs);
    const [chains, deniedRows, sandboxRows] = await Promise.all([
      this.chainSignals(),
      this.#source.countAuditEvents(DENIED_ACCESS_DASHBOARD_ACTIONS, since),
      this.#source.countAuditEvents(SANDBOX_DASHBOARD_ACTIONS, since),
    ]);

    const deniedAccess: SecurityCounterSignal[] =
      DENIED_ACCESS_DASHBOARD_ACTIONS.map((action) => ({
        name: action,
        count: countFor(deniedRows, action),
        windowMs: this.#windowMs,
      }));
    const sandboxViolations: SecurityCounterSignal[] =
      SANDBOX_DASHBOARD_ACTIONS.map((action) => ({
        name: action,
        count: countFor(sandboxRows, action),
        windowMs: this.#windowMs,
      }));

    return buildSecurityDashboard({
      now,
      chains,
      deniedAccess,
      sandboxViolations,
    });
  }

  private async chainSignals(): Promise<readonly ChainHealthSignal[]> {
    return Promise.all(
      LOG_TYPES.map(async (logType): Promise<ChainHealthSignal> => {
        const [report, anchor] = await Promise.all([
          safeVerify(this.#verifiers[logType]),
          this.#source.latestAnchor(logType),
        ]);
        return {
          logType,
          ok: report.ok,
          rowsVerified: report.rowsVerified,
          tipHash: report.ok ? report.tipHash : null,
          ...(report.ok ? {} : { failureReason: report.failureReason }),
          latestAnchorCommittedAt: anchor.committedAt,
          latestExternalAnchorUri: anchor.externalAnchorUri,
        };
      }),
    );
  }
}
