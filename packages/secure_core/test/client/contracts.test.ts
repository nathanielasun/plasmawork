import { describe, expect, it } from "vitest";

import {
  SECURE_CORE_FRONTEND_ROUTES,
  frontendDisabledRoutes,
  frontendReadyRoutes,
} from "../../src/client/contracts.js";

describe("frontend secure-core contracts", () => {
  it("uses unique route ids and method/path pairs", () => {
    const ids = new Set<string>();
    const methodPaths = new Set<string>();

    for (const route of SECURE_CORE_FRONTEND_ROUTES) {
      expect(ids.has(route.id)).toBe(false);
      ids.add(route.id);

      const methodPath = `${route.method} ${route.path}`;
      expect(methodPaths.has(methodPath)).toBe(false);
      methodPaths.add(methodPath);
    }
  });

  it("marks high-risk routes as approval-token routes", () => {
    const approvalRoutes = SECURE_CORE_FRONTEND_ROUTES.filter(
      (route) => route.approval === "header_token",
    );

    expect(approvalRoutes.map((route) => route.id).sort()).toEqual([
      "artifacts.export",
      "operator.investigate",
      "operator.remediate",
    ]);
  });

  it("keeps fail-closed surfaces out of ready frontend routing", () => {
    expect(frontendReadyRoutes().map((route) => route.id)).not.toContain(
      "operator.remediate",
    );
    expect(frontendDisabledRoutes().map((route) => route.id)).toContain(
      "operator.remediate",
    );
  });

  it("marks session introspection ready for app-shell capability gating", () => {
    expect(
      SECURE_CORE_FRONTEND_ROUTES.find((route) => route.id === "auth.session"),
    ).toMatchObject({
      method: "GET",
      path: "/auth/session",
      readiness: "ready",
      uiSurface: "app_shell",
    });
  });
});
