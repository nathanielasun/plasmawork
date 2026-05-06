/**
 * Health / readiness / liveness routes — Phase 0.5 Layer 4 task L4.12.
 *
 * Three endpoints (none authenticated, none CSRF-gated, never logged
 * to audit):
 *
 *   GET /health        — process liveness. Returns 200 when the
 *                        Fastify event loop is responsive. Used by
 *                        container orchestrators / load balancers.
 *   GET /readiness     — readiness check. Returns 200 only when the
 *                        DB pool returns `SELECT 1` quickly. Layer-3
 *                        services rely on `pool.sql`; if it's
 *                        unreachable, refuse traffic.
 *   GET /metrics       — Prometheus-text metrics dump. Tightly
 *                        scoped to a small built-in set; the
 *                        application registers its own counters
 *                        through the `MetricsRegistry`.
 *
 * Health/readiness endpoints intentionally bypass the §6.2
 * middleware chain — they must succeed pre-auth so the orchestrator
 * can check liveness before any user has logged in. They DO go
 * through `requireRequestId` (registered as a Fastify onRequest
 * hook in `server.ts`) so failure modes still carry a correlation id.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
} from "fastify";
import type { Sql } from "postgres";

export interface HealthRoutesOptions {
  /** App-role pool. Probed in /readiness via `SELECT 1`. */
  readonly appSql?: Sql;
  /**
   * Service version surfaced in /health + /metrics. Defaults to
   * `secure_core@<package.json version>` if omitted; for tests we
   * inject a fixed string.
   */
  readonly serviceVersion?: string;
  /** Wall-clock now for tests. */
  readonly now?: () => number;
  /**
   * Optional metrics registry. When omitted, /metrics returns the
   * built-in process metrics only (uptime + memory).
   */
  readonly metricsRegistry?: MetricsRegistry;
}

/**
 * Minimal counter registry. Producers call `inc(name, labels?, by?)`
 * to bump a counter; the route renders Prometheus text format. We
 * deliberately keep the model tiny — Layer-5 swaps in `prom-client`
 * if richer histograms are needed.
 */
export class MetricsRegistry {
  readonly #counters = new Map<string, Map<string, number>>();

  public inc(
    name: string,
    labels: Readonly<Record<string, string>> = {},
    by: number = 1,
  ): void {
    if (!Number.isFinite(by) || by < 0) {
      throw new Error(`MetricsRegistry.inc: 'by' must be a non-negative finite number (got ${by})`);
    }
    let series = this.#counters.get(name);
    if (series === undefined) {
      series = new Map<string, number>();
      this.#counters.set(name, series);
    }
    const key = serializeLabels(labels);
    series.set(key, (series.get(key) ?? 0) + by);
  }

  public render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.#counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [labelStr, value] of series) {
        lines.push(`${name}${labelStr} ${value}`);
      }
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }
}

function serializeLabels(labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  const inner = entries
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(",");
  return `{${inner}}`;
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

const PROCESS_START_MS = Date.now();

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const version = opts.serviceVersion ?? "secure_core@0.0.1";
  const now = opts.now ?? Date.now;

  app.get("/health", async () => ({
    ok: true,
    service: version,
    uptime_ms: now() - PROCESS_START_MS,
  }));

  app.get("/readiness", async (_req, reply) => {
    if (opts.appSql === undefined) {
      // Without a DB pool, we can't validate readiness. Treat the
      // configuration as broken: 503 surfaces the misconfiguration
      // rather than letting traffic hit a dead service.
      return reply.code(503).send({ ok: false, reason: "no_db_pool" });
    }
    try {
      // Use a 1s deadline so a stalled DB doesn't keep the prober
      // waiting indefinitely.
      const probe = opts.appSql<Array<{ ok: number }>>`SELECT 1 AS ok`;
      const timed = await Promise.race<typeof probe | "timeout">([
        probe,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 1000),
        ),
      ]);
      if (timed === "timeout") {
        return reply.code(503).send({ ok: false, reason: "db_timeout" });
      }
      return { ok: true, service: version };
    } catch {
      return reply.code(503).send({ ok: false, reason: "db_unreachable" });
    }
  });

  app.get("/metrics", async (_req, reply) => {
    reply.type("text/plain; version=0.0.4");
    const builtin = renderBuiltinMetrics(version, now);
    const app = opts.metricsRegistry?.render() ?? "";
    return builtin + app;
  });
};

function renderBuiltinMetrics(version: string, now: () => number): string {
  const memory = process.memoryUsage();
  const uptime = now() - PROCESS_START_MS;
  const labels = `{service="${escapeLabelValue(version)}"}`;
  return [
    `# TYPE secure_core_uptime_ms gauge`,
    `secure_core_uptime_ms${labels} ${uptime}`,
    `# TYPE secure_core_memory_rss_bytes gauge`,
    `secure_core_memory_rss_bytes${labels} ${memory.rss}`,
    `# TYPE secure_core_memory_heap_used_bytes gauge`,
    `secure_core_memory_heap_used_bytes${labels} ${memory.heapUsed}`,
    "",
  ].join("\n");
}
