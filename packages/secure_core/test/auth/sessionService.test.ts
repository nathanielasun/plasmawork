import { describe, expect, it } from "vitest";

import {
  SqlCurrentSessionReader,
  type CurrentSessionAuth,
} from "../../src/auth/sessionService.js";
import type { SecureCorePool } from "../../src/db/pool.js";

const AUTH: CurrentSessionAuth = {
  userId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  actorType: "human",
  assuranceLevel: "aal2",
};

function poolWithRows(rows: readonly unknown[], role = "app"): SecureCorePool {
  const sql = async () => rows;
  return {
    role,
    sql,
    db: undefined as unknown as SecureCorePool["db"],
    close: async () => {
      /* no-op */
    },
  } as unknown as SecureCorePool;
}

describe("SqlCurrentSessionReader", () => {
  it("groups live membership rows by workspace and sorts capabilities", async () => {
    const reader = new SqlCurrentSessionReader({
      appPool: poolWithRows([
        {
          workspace_id: "ws-1",
          workspace_name: "Alpha",
          role_id: "role-1",
          role_name: "owner",
          capability: "run:create",
        },
        {
          workspace_id: "ws-1",
          workspace_name: "Alpha",
          role_id: "role-1",
          role_name: "owner",
          capability: "workspace:view",
        },
        {
          workspace_id: "ws-2",
          workspace_name: "Beta",
          role_id: "role-2",
          role_name: "viewer",
          capability: "capsule:read",
        },
        {
          workspace_id: "ws-3",
          workspace_name: "Gamma",
          role_id: "role-3",
          role_name: "no-access",
          capability: null,
        },
      ]),
    });

    const session = await reader.getCurrentSession(AUTH);

    expect(session).toMatchObject({
      user_id: AUTH.userId,
      session_id: AUTH.sessionId,
      actor_type: "human",
      assurance_level: "aal2",
    });
    expect(session.memberships).toEqual([
      {
        workspace_id: "ws-1",
        workspace_name: "Alpha",
        role_id: "role-1",
        role_name: "owner",
        capabilities: ["run:create", "workspace:view"],
      },
      {
        workspace_id: "ws-2",
        workspace_name: "Beta",
        role_id: "role-2",
        role_name: "viewer",
        capabilities: ["capsule:read"],
      },
      {
        workspace_id: "ws-3",
        workspace_name: "Gamma",
        role_id: "role-3",
        role_name: "no-access",
        capabilities: [],
      },
    ]);
  });

  it("requires the app DB role", () => {
    expect(
      () =>
        new SqlCurrentSessionReader({
          appPool: poolWithRows([], "audit_read"),
        }),
    ).toThrow(/role="app"/);
  });
});
