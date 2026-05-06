# ADR-0011: Secrets Management Backend

## Status
Accepted

## Date
2026-05-05

## Context

Phase 5 (Security Implementation, Gate G1.L0.4) requires that **no secret
material ever land in source, config files committed to git, log streams,
runtime stdout/stderr, exception payloads, or any artifact under a user
workspace**. The v4 secure-multi-user plan §24 (Secrets Management)
formalizes this: every long-lived secret must live in a KMS, a Vault, a
cloud secrets manager, or a sealed-deployment secrets manager, and the
application reads it through a thin client that fails closed when the
secret is unavailable.

The secrets that the workbench will produce or consume include:

- **Database credentials** for the three Postgres roles (`app`,
  `audit-read`, `anchor-writer`) used by the audit-anchor pipeline and
  the application server.
- **`approval_hmac_key`** — signs single-use approval tokens that the
  registry consumes at lifecycle mutation boundaries (v4 §16.3).
- **`audit_ip_hmac_key`** and **`audit_ua_hmac_key`** — HMAC keys that
  pseudonymize IP addresses and User-Agent strings before they land in
  the audit log (v4 §19.2).
- **Session signing key** for the cookie-based session (v4 §5.4).
- **CSRF HMAC key** for the double-submit token scheme (v4 §7.2).
- **Outbound-webhook signing key** — signs `X-Plasmawork-Signature`
  headers on webhook deliveries (v4 §26.2).
- **Worker scoped credentials** — short-lived credentials derived from a
  master key per scheduled job (v4 §18.1).
- **OIDC client secrets** for each configured identity provider (v4 §5).
- **AWS IAM credentials** for the audit-anchor process that writes WORM
  objects to the bucket described in ADR-0010 (S3 Object Lock).

ADR-0010 already commits the workbench to S3 Object Lock for the WORM
audit anchor, which means the production deployment will hold AWS IAM
credentials at minimum. The secrets backend should not pull a second
cloud vendor into the dependency surface unless there is a strong reason
to do so.

The Phase 5 plan also requires a deterministic dev / CI story: every
developer can run the stack locally, every CI job can run the
integration tests, and **production secrets must never reach CI runners**
(v4 §29 test #73). The dev fallback must be obvious enough that an
accidental commit can be caught in code review and by the convention
checker.

## Decision

1. **Production secrets backend: AWS Secrets Manager.** Every secret in
   scope above is stored as a Secrets Manager entry, namespaced by
   environment (`plasmawork/prod/...`, `plasmawork/staging/...`). The
   secure-core service reads secrets through a single TypeScript client
   wrapper located at `packages/secure_core/src/secrets/client.ts`,
   per ADR-0008's Shape-A boundary (TypeScript on Node 24+ in
   `packages/secure_core/`). The IAM policy attached to each runtime
   principal allows `secretsmanager:GetSecretValue` on a documented
   allowlist of secret ARNs and nothing else.

   The legacy `packages/core/` Python workbench does not consume the
   secure-core secrets surface; while it remains single-user it has
   no production secrets to manage. If a future ADR extends Phase 0.5
   into the Python workbench, a parallel `secrets/client.py` wrapper
   ports the same allowlist + redaction discipline; it is out of scope
   for this ADR.

2. **Single client wrapper, one provider abstraction.** The wrapper
   exposes `getSecret(name: string): Promise<string>`. At process
   start it picks a provider:

   - If `PLASMAWORK_SECRETS_PROVIDER=local` (default in dev), read
     from `local_cache/secrets/secrets.local.json`. The wrapper logs
     `secrets: using LOCAL provider from <path>` once at startup.
     Production deployments unset this variable.
   - If `PLASMAWORK_SECRETS_PROVIDER=env` (CI default), read from
     environment variables prefixed `PLASMAWORK_SECRET_<NAME>`.
   - Otherwise, read from AWS Secrets Manager via `@aws-sdk/client-secrets-manager` (Node SDK v3).

3. **Allowlist-gated reads.** The wrapper holds a frozen `Set<string>`
   of secret names declared in
   `packages/secure_core/src/secrets/allowlist.ts`. Any call to
   `getSecret("not-on-the-list")` throws `SecretNotAllowedError`
   BEFORE any provider is contacted. This prevents typo-driven leakage
   of an unrelated secret and bounds the audit surface.

4. **In-memory TTL cache.** The wrapper caches each secret value for
   five minutes by default (configurable via
   `PLASMAWORK_SECRETS_TTL_SECONDS`). On a `SIGHUP` signal the cache
   is invalidated process-wide, which is the rotation hook for
   long-running workers. The cache key is the secret name; the cache
   value is the cleartext + a monotonic deadline.

5. **Redaction in logs and exceptions.** The wrapper wraps secret
   values in a `RedactedSecret` class whose `toString()` and
   `Symbol.toPrimitive` both return the constant
   `"<redacted:<name>>"`. Pino's structured logger, the Fastify error
   handler, and any `JSON.stringify` call all see the redacted form.
   Tests in `packages/secure_core/test/security/secrets-redaction.test.ts`
   capture stdout / stderr / pino transport output and assert the
   literal cleartext never appears.

6. **Rotation policy:**
   - **Database passwords** are rotated on a 30-day cadence by an AWS
     Secrets Manager Lambda rotation function (`SingleUser` strategy
     for `app`, `MultiUser` for `audit-read` / `anchor-writer`).
   - **HMAC keys** (`approval_hmac_key`, `audit_ip_hmac_key`,
     `audit_ua_hmac_key`, session signing key, CSRF HMAC key,
     webhook signing key) rotate on a documented manual cadence
     because rotation requires re-signing every active token / every
     active session / every undelivered webhook. The wrapper supports
     dual-key reads (current + previous) during the rotation window
     so existing tokens validate while new tokens are signed with the
     fresh key.
   - **Worker scoped credentials** are derived from a master key on
     job submission and never cached past job lifetime.
   - Every successful rotation emits a `secret.rotated` audit event
     (v4 §19.5) carrying the secret name, the new version id, and
     the actor (rotation Lambda or human operator).

7. **Dev fallback file.** `local_cache/secrets/secrets.local.json` is
   gitignored at the directory level (`local_cache/` is already
   ignored) AND a defense-in-depth convention check refuses to stage
   any `secrets.local.json` regardless of path. The file mode is
   `chmod 600` (the wrapper enforces this on first read and refuses
   to read a world-readable file).

8. **CI secrets** flow through GitHub Actions repository secrets,
   surfaced as `PLASMAWORK_SECRET_*` environment variables in the
   workflow YAML. The CI provider for the wrapper is `env`. Per v4
   §29 test #73, **production Secrets Manager ARNs are not granted
   to any CI runner**; CI uses freshly-minted dummy values that never
   touch production data.

## Alternatives Considered

| Backend | Rotation | Audit log | Dev / CI mock | Cost (small fleet) | Friction |
|---|---|---|---|---|---|
| **AWS Secrets Manager** (chosen) | Native Lambda rotation; SingleUser / MultiUser templates | CloudTrail captures every `GetSecretValue`; integrates with the existing audit pipeline | `local_cache/secrets/secrets.local.json` fallback in the same wrapper; high fidelity | ~$0.40 / secret-month + $0.05 / 10k API calls; ~$8–12 / month for the listed secret set | Low — AWS SDK already pulled in for ADR-0010 |
| HashiCorp Vault (self-hosted) | Strong: dynamic DB creds, transit engine for HMAC | Vault audit devices are first class but separate from CloudTrail | Vault dev-mode is good but adds a service to local stack | Operational cost dominates (HA cluster, unseal keys, upgrades) | High — extra service, extra dependency, extra on-call surface |
| GCP Secret Manager | Versioning yes; rotation is BYO | Cloud Audit Logs separate from AWS audit pipeline | Emulator exists; lower fidelity than local file | Pricing similar to AWS | Pulls in a second cloud vendor solely for secrets |
| Azure Key Vault | Versioning + soft-delete; rotation via Event Grid | Azure Monitor logs separate from AWS | Emulator available | Pricing similar to AWS | Same second-cloud objection as GCP |
| Sealed Secrets (Bitnami controller, k8s) | Manual re-seal per rotation | k8s audit log only; no secret-access trail | Works in `kind` / `minikube`; mock fidelity OK | Free | Couples secrets to a Kubernetes deployment; we are not committing to k8s yet, and the audit-anchor process is not in-cluster |

AWS Secrets Manager wins on three counts: (1) the deployment already
holds AWS credentials for the WORM bucket from ADR-0010; (2) CloudTrail
already feeds the audit pipeline, so secret access lands in the same
stream as object access; (3) Lambda rotation for DB passwords is the
lowest-friction path to the §24 rotation requirement. Vault is the
strongest technical alternative and remains a future option behind the
wrapper abstraction if AWS lock-in becomes a problem.

## Consequences

### Positive

- One client wrapper, three providers (`aws`, `local`, `env`), means
  application code never branches on environment. Tests pin the
  `local` provider deterministically.
- CloudTrail captures every production `GetSecretValue`, satisfying v4
  §19 audit requirements without a parallel pipeline.
- Lambda rotation eliminates the "rotation never happens because
  nobody owns it" failure mode for DB credentials.
- The allowlist + redaction + cache + SIGHUP-invalidation behaviors
  are all unit-testable in isolation against the `local` provider.

### Negative

- **AWS lock-in.** The wrapper abstracts the provider, but the
  rotation Lambdas, IAM policies, and CloudTrail integration are
  AWS-specific. Migrating to Vault later is a real project, not a
  config flip. Mitigation: keep the wrapper interface narrow
  (`getSecret`, `rotateSecret`, `invalidateCache`) and forbid
  AWS-specific types in caller code.
- **Cost grows with secret count.** ~$0.40 / secret-month adds up if
  every per-tenant credential is a separate secret. Where it is
  cryptographically safe, consolidate (e.g. all HMAC keys in one
  JSON-shaped secret with versioned keys) and document the
  consolidation in this ADR's amendments.
- **Local dev secrets are a real file on disk.** Even with `chmod
  600` and the gitignore + convention-checker belt-and-braces, a
  developer with a misconfigured backup tool could leak it. Treat
  the dev secrets as test-fidelity values, never production
  shadows.
- **HMAC key rotation is operationally heavy.** Each rotation
  requires invalidating every signed artifact (active sessions,
  pending approval tokens, undelivered webhooks). The plan must
  schedule rotations during maintenance windows and the dual-key
  read window must be long enough to cover the longest valid token
  TTL. Document this before the first rotation, not during it.

### Neutral

- The wrapper adds one process-wide dependency (boto3) to the Python
  runtime; the AWS SDK is already pulled in for the WORM-bucket
  writer in ADR-0010, so the marginal install cost is zero.
- SIGHUP is the rotation invalidation signal on Unix; on Windows the
  rotation path posts to an internal `/admin/secrets/invalidate`
  endpoint that the wrapper exposes when running in-process.

## Implementation Notes (Dev / CI)

- **Dev bootstrap.** `scripts/dev/install.sh` writes a placeholder
  `local_cache/secrets/secrets.local.json` with deterministic dummy
  values (HMAC keys are `b"dev-only-hmac-key-NN"` constants, DB
  passwords match the docker-compose Postgres init script). The
  wrapper's startup banner makes the choice impossible to miss:
  `secrets: using LOCAL provider from local_cache/secrets/secrets.local.json`.

- **CI bootstrap.** `.github/workflows/test.yaml` declares each
  required secret as a `PLASMAWORK_SECRET_*` env var derived from a
  GitHub Actions repository secret. The CI secrets are scoped
  per-environment (`ci-test`, never `prod`). The workflow asserts
  `PLASMAWORK_SECRETS_PROVIDER=env` before running any test that
  touches a secret.

- **Convention-checker assertions** (Phase 5 default-mode hard gate
  once Phase 5 closes; opt-in until then):
  - `local_cache/secrets/secrets.local.json` is matched by
    `git check-ignore` (the existing `local_cache/` rule covers it).
  - `git ls-files | grep secrets.local.json` is empty.
  - The string `"PLASMAWORK_SECRET_"` appears in
    `.github/workflows/test.yaml` at least once.
  - The wrapper's allowlist file imports cleanly and exposes
    `ALLOWED_SECRETS: frozenset[str]`.
  - Negative grep: no secret value matching the dummy-HMAC pattern
    appears in committed source outside `local_cache/`.

- **L1.6 negative-path acceptance probes** (must be implemented as
  tests before this ADR moves to Accepted):
  1. `get_secret("typo_name")` raises `SecretNotAllowed` before any
     provider call; mock the provider, assert it was never invoked.
  2. Logging, exception messages, and `repr()` of any value returned
     by the wrapper do not contain the cleartext (capture via
     `caplog`, `capsys`, and `pytest.raises().value`).
  3. Staging `local_cache/secrets/secrets.local.json` fails the
     convention checker; staging an arbitrarily-named
     `secrets.local.json` elsewhere in the tree also fails.
  4. A successful rotation emits `secret.rotated` with the secret
     name, version id, and actor; the audit event is sourced from
     CloudTrail in production and from the local audit-event sink in
     dev.

- **Future amendments.** When per-tenant secret count exceeds ~50, this
  ADR is amended (not superseded) to document consolidation. A switch
  to Vault requires a new ADR that supersedes this one.
