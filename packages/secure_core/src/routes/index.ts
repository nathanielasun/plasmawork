/**
 * Routes barrel — Phase 0.5 Layer 4.
 *
 * Each route plugin is a Fastify plugin that takes a service +
 * middleware bundle and registers the v4 §10.2 endpoint subset for
 * its resource. Apps wire them together at startup with the
 * already-constructed L2 middleware deps.
 */

export {
  healthRoutes,
  MetricsRegistry,
  type HealthRoutesOptions,
} from "./health.js";

export {
  workspaceRoutes,
  type WorkspaceRoutesOptions,
  type WorkspaceRoutesMiddleware,
} from "./workspaces.js";
