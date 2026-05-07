import type { AuditLogger } from "./logger.js";
import type {
  AuditLogType,
  AuditChainVerifier,
  VerifyReport,
} from "./index.js";

export type VerifierByLogType = Readonly<Record<AuditLogType, AuditChainVerifier>>;

export interface PeriodicAuditChainVerifierOptions {
  readonly verifiers: VerifierByLogType;
  readonly auditLogger: AuditLogger;
  readonly intervalMs: number;
  readonly requestId: string;
}

export interface PeriodicVerifierResult {
  readonly logType: AuditLogType;
  readonly report: VerifyReport;
}

export interface PeriodicVerifierRun {
  readonly ok: boolean;
  readonly results: readonly PeriodicVerifierResult[];
}

type FailedVerifyReport = Extract<VerifyReport, { ok: false }>;
type FailedPeriodicVerifierResult = PeriodicVerifierResult & {
  readonly report: FailedVerifyReport;
};

const LOG_TYPES = ["audit", "provenance", "operator"] as const satisfies
  readonly AuditLogType[];

function failedResult(
  result: PeriodicVerifierResult,
): result is FailedPeriodicVerifierResult {
  return !result.report.ok;
}

async function verifyLogType(
  verifiers: VerifierByLogType,
  logType: AuditLogType,
): Promise<PeriodicVerifierResult> {
  try {
    return {
      logType,
      report: await verifiers[logType].verifyAll(),
    };
  } catch {
    return {
      logType,
      report: {
        ok: false,
        rowsVerified: 0,
        firstFailureRowId: `${logType}:verifier`,
        failureReason: "verifier_error",
      },
    };
  }
}

export class PeriodicAuditChainVerifier {
  readonly #verifiers: VerifierByLogType;
  readonly #auditLogger: AuditLogger;
  readonly #intervalMs: number;
  readonly #requestId: string;
  #timer: NodeJS.Timeout | null = null;

  public constructor(opts: PeriodicAuditChainVerifierOptions) {
    if (!Number.isInteger(opts.intervalMs) || opts.intervalMs <= 0) {
      throw new Error("PeriodicAuditChainVerifier intervalMs must be positive");
    }
    this.#verifiers = opts.verifiers;
    this.#auditLogger = opts.auditLogger;
    this.#intervalMs = opts.intervalMs;
    this.#requestId = opts.requestId;
  }

  public async runOnce(): Promise<PeriodicVerifierRun> {
    const results = await Promise.all(
      LOG_TYPES.map((logType) => verifyLogType(this.#verifiers, logType)),
    );

    const failures = results.filter(failedResult);
    if (failures.length === 0) {
      await this.#auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "log_chain.verification_succeeded",
        result: "succeeded",
        requestId: this.#requestId,
        metadata: { count: results.length },
      });
      return { ok: true, results };
    }

    for (const failure of failures) {
      await this.#auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "log_chain.verification_failed",
        result: "failed",
        requestId: this.#requestId,
        metadata: {
          error_code: failure.report.failureReason,
          count: failure.report.rowsVerified,
        },
      });
    }
    return { ok: false, results };
  }

  public start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.runOnce().catch(() => {
        // There is no safe secondary channel here: audit write failures
        // must not create an unhandled rejection in the long-running job.
      });
    }, this.#intervalMs);
    if (typeof this.#timer.unref === "function") {
      this.#timer.unref();
    }
  }

  public stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }
}
