-- 0004_username_and_user_credentials.sql
--
-- Phase 0.5 auth gateway (2026-05-09).
--
-- The authentication gateway makes username the primary login
-- identifier; email becomes optional/supplementary metadata used only
-- for password-reset notifications. The root admin account in
-- particular has no email at all (it authenticates via .env.auth-
-- declared ROOT_ADMIN_USER_ID).
--
-- Changes:
--   1. users.email becomes nullable; the column-level UNIQUE is
--      replaced with a partial unique index that only enforces
--      uniqueness when email IS NOT NULL.
--   2. users.username is added (text, partial-unique by lower(),
--      nullable so existing email-only rows survive the migration).
--   3. user_credentials sidecar table holds the Argon2id password
--      hash, kept 1:1 with users(id). Keeps `users` as the identity-
--      only table; password lifecycle stays separate.
--   4. sessions.auth_method CHECK constraint gains 'password_reset'
--      and 'email_verify' so the recovery → session bridge can mint
--      sessions with those origin tags. The constraint was missing
--      these despite LoginService.mintSessionForUser already accepting
--      them; tests stub the DB so this never fired in CI.

BEGIN;

-- 1. Drop the column-level UNIQUE on users.email (auto-named
--    "users_email_key") and replace with a partial unique index.
ALTER TABLE "users" DROP CONSTRAINT "users_email_key";
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
CREATE UNIQUE INDEX "users_email_key"
  ON "users" (lower("email"))
  WHERE "email" IS NOT NULL;

-- 2. Add username with partial-unique-by-lower index.
ALTER TABLE "users" ADD COLUMN "username" text;
CREATE UNIQUE INDEX "users_username_key"
  ON "users" (lower("username"))
  WHERE "username" IS NOT NULL;

-- A user must carry AT LEAST ONE of email/username so that login
-- has something to look up and audit rows can describe the actor.
ALTER TABLE "users" ADD CONSTRAINT "users_identity_present_check"
  CHECK ("email" IS NOT NULL OR "username" IS NOT NULL);

-- 3. user_credentials sidecar.
CREATE TABLE "user_credentials" (
  "user_id" uuid PRIMARY KEY
    REFERENCES "users"("id") ON DELETE RESTRICT,
  "password_hash" text NOT NULL,
  "algorithm" text NOT NULL DEFAULT 'argon2id',
  "hash_updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "failed_attempts" integer NOT NULL DEFAULT 0,
  "locked_until" timestamp with time zone,
  CONSTRAINT "user_credentials_algorithm_check"
    CHECK ("algorithm" IN ('argon2id', 'bcrypt')),
  CONSTRAINT "user_credentials_failed_attempts_nonneg_check"
    CHECK ("failed_attempts" >= 0)
);

-- 4. Extend sessions.auth_method to cover the recovery → session
--    bridge origins. Drop+recreate is the cleanest portable form.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_auth_method_check";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_method_check"
  CHECK ("auth_method" IN (
    'oidc',
    'password',
    'webauthn',
    'sso',
    'password_reset',
    'email_verify'
  ));

COMMIT;
