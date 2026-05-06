/**
 * Test fixture barrel — Phase 0.5 Layer-1 (L1.5).
 *
 * Re-exports the factory + helper surface so test files import from
 * one path:
 *
 *   import { bindFactories, createScratchDb, resetTestDb }
 *     from "../fixtures";
 */

export {
  makeUser,
  makeSession,
  makeWorkspace,
  makeMember,
  makeCapsule,
  makeRun,
  makeTool,
  makeApprovalRequest,
  makeApprovalToken,
  makeStorageReservation,
  bindFactories,
  getRoleId,
  resetCounters,
  type Factories,
  type UserRow,
  type SessionRow,
  type WorkspaceRow,
  type MembershipRow,
  type CapsuleRow,
  type CapsuleVersionRow,
  type CapsuleAndVersion,
  type RunRow,
  type ToolRow,
  type ApprovalRequestRow,
  type ApprovalTokenRow,
  type StorageReservationRow,
} from "./factories.js";

export {
  createScratchDb,
  resetTestDb,
  HAS_TEST_DB,
  TEST_DB_SKIP_REASON,
  RESET_TABLES,
  type ScratchDb,
} from "../helpers/db.js";
