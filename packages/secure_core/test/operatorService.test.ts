/**
 * OperatorService regressions.
 *
 * Pins fail-closed remediation behavior: destructive operator
 * remediations must not report success until their side effects are
 * actually implemented.
 */

import { describe, expect, it } from "vitest";

import {
  OperatorService,
  type OperatorRowWriter,
  type OperatorPrevHashGetter,
} from "../src/operator/service.js";
import type { AuditLogger, AuditEventInput } from "../src/audit/logger.js";
import type { PreparedOperatorRow } from "../src/audit/dbWriter.js";
import type { SecureCorePool } from "../src/db/pool.js";

describe("OperatorService", () => {
  it("executeRemediation records a failed attempt and throws until side effects ship", async () => {
    const auditInputs: AuditEventInput[] = [];
    const operatorRows: PreparedOperatorRow[] = [];
    const auditLogger = {
      async write(input: AuditEventInput) {
        auditInputs.push(input);
        return { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      },
    } as unknown as AuditLogger;
    const appPool = {
      sql: {
        begin: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
      },
    } as unknown as SecureCorePool;
    const operatorWriter: OperatorRowWriter = async (row) => {
      operatorRows.push(row);
    };
    const operatorPrevHashGetter: OperatorPrevHashGetter = async () => null;
    const service = new OperatorService({
      auditReadService: {
        async listAuditEventsCrossWorkspace() {
          return { rows: [], nextCursor: null };
        },
      } as never,
      appPool,
      auditLogger,
      operatorWriter,
      operatorPrevHashGetter,
      now: () => new Date("2026-05-01T00:00:00.000Z"),
      generateId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    await expect(
      service.executeRemediation({
        actorUserId: "11111111-1111-4111-8111-111111111111",
        sessionId: "sess-1",
        requestId: "req-1",
        targetWorkspaceId: "22222222-2222-4222-8222-222222222222",
        reason: "containment",
        action: "delete_session",
        targetId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      details: { reason: "not_implemented" },
    });

    expect(auditInputs).toHaveLength(1);
    expect(auditInputs[0]).toMatchObject({
      actorType: "operator",
      action: "platform.capability_used",
      result: "failed",
      metadata: {
        capability: "platform:incident_remediate",
        action: "delete_session",
        not_implemented: true,
      },
    });
    expect(operatorRows).toHaveLength(1);
    expect(operatorRows[0].capability).toBe("platform:incident_remediate");
  });
});
