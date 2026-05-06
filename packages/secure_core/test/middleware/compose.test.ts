/**
 * L2 middleware composition — order-gate regression tests.
 *
 * The §6.2 order is a security invariant. `composeMiddleware` must fail
 * at route registration when a caller lists middleware out of order; it
 * must not silently sort the list because that hides review drift.
 */

import { describe, expect, it } from "vitest";
import {
  composeMiddleware,
  MiddlewareOrderError,
  type NamedMiddleware,
} from "../../src/middleware/compose.js";

const noop = async (): Promise<void> => {
  /* no-op */
};

function mw(name: NamedMiddleware["name"]): NamedMiddleware {
  return { name, handler: noop };
}

describe("composeMiddleware", () => {
  it("returns handlers in the caller-provided order when already canonical", () => {
    const first = mw("requireAuth");
    const second = mw("enforceCsrfForStateChange");
    const handlers = composeMiddleware([first, second]);
    expect(handlers).toEqual([first.handler, second.handler]);
  });

  it("throws instead of silently sorting out-of-order middleware", () => {
    expect(() =>
      composeMiddleware([
        mw("requireCapability"),
        mw("requireWorkspaceMembership"),
      ]),
    ).toThrow(MiddlewareOrderError);
  });

  it("throws on duplicate middleware names", () => {
    expect(() =>
      composeMiddleware([mw("loadWorkspace"), mw("loadWorkspace")]),
    ).toThrow(MiddlewareOrderError);
  });
});
