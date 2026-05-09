/**
 * Cross-package type shims — Phase 0.5 (2026-05-09).
 *
 * The gateway imports source files from `packages/secure_core/src/`
 * (no compiled dist exists). When tsc walks into those files, it
 * sometimes hits third-party packages whose `package.json` exports
 * field doesn't expose their `.d.ts` to a consumer in a different
 * node_modules tree. The shims here paper over those edges so the
 * gateway's typecheck doesn't fail on issues that are resolved
 * inside secure_core's own typecheck.
 *
 * Each shim declares a module with `any` to silence the cross-tree
 * resolution failure without losing type-safety on gateway-owned code.
 */

declare module "@truestamp/canonify";
