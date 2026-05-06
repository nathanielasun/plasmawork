/**
 * Path-component validator — Phase 0.5 Layer 2 (L2.10/L2.11 shared).
 *
 * Single source of truth for v4 §9.4 component-level rules. Both the
 * workspace path builder (L2.10) and the archive extractor (L2.11)
 * import `validateComponent()` so the rule set cannot drift between
 * direct filesystem writes and archive-entry destinations.
 *
 * Rules (verbatim from v4 §9.4.5–§9.4.10, plus the §9.4.6 percent-
 * encoded separator rule applied to the byte-string form):
 *
 *  5. Reject NUL bytes anywhere in the component.
 *  6. Reject percent-encoded separator escapes (%2F, %5C — case-
 *     insensitive). v4 §9.4.6 reads "reject percent-encoded
 *     separators"; we apply this on the literal byte string before
 *     any decode step, which is strictly more restrictive than
 *     decode-then-validate. Documented this way in the commit so the
 *     interpretation is explicit.
 *  7. Reject empty components (`""`).
 *  8. Reject `.` and `..`.
 *  9. Reject leading-dot names ("dotfiles") and trailing dot/space
 *     ("foo.", "foo "). The latter blocks Windows ADS-style suffixes
 *     and trailing-whitespace tricks; v4 says "trailing dot/space
 *     names" — both are refused.
 * 10. Validate against the §9.4.10 regex:
 *
 *       ^[A-Za-z0-9_]$|^[A-Za-z0-9_][A-Za-z0-9._-]*[A-Za-z0-9_-]$
 *
 *     Boundary cases the regex enforces:
 *       - single-character names: only `[A-Za-z0-9_]` are valid
 *         (so `a`, `Z`, `_`, `0` are fine; `-` and `.` are NOT).
 *       - first character: alphanumeric or `_` — never `.`, `-`,
 *         or any other punctuation.
 *       - final character: alphanumeric, `_`, or `-` — never `.`.
 *       - middle characters: `[A-Za-z0-9._-]` allowed.
 *
 * Returns a closed `ComponentRejection` union when invalid so callers
 * can map to `path_access.denied` audit reasons or `archive.entry_
 * rejected.reason` enum values without re-classifying.
 */

export type ComponentRejection =
  | "nul_byte"
  | "percent_encoded_separator"
  | "empty"
  | "dot_or_dotdot"
  | "leading_dot"
  | "trailing_dot_or_space"
  | "regex_mismatch";

const PERCENT_SEPARATOR_RE = /%2f|%5c/i;

const COMPONENT_RE =
  /^[A-Za-z0-9_]$|^[A-Za-z0-9_][A-Za-z0-9._-]*[A-Za-z0-9_-]$/;

/**
 * Returns `null` when the component is valid; otherwise returns the
 * specific rejection reason. Callers map the rejection into an
 * `ArchiveRejectedError` / `PathInvalidError` plus the matching audit
 * event.
 */
export function classifyComponent(
  component: string,
): ComponentRejection | null {
  if (component.includes("\0")) {
    return "nul_byte";
  }
  if (PERCENT_SEPARATOR_RE.test(component)) {
    return "percent_encoded_separator";
  }
  if (component === "") {
    return "empty";
  }
  if (component === "." || component === "..") {
    return "dot_or_dotdot";
  }
  if (component.startsWith(".")) {
    return "leading_dot";
  }
  if (component.endsWith(".") || component.endsWith(" ")) {
    return "trailing_dot_or_space";
  }
  if (!COMPONENT_RE.test(component)) {
    return "regex_mismatch";
  }
  return null;
}

/**
 * Convenience boolean form. Prefer `classifyComponent` when the
 * caller needs to map the rejection to a closed enum value.
 */
export function isValidComponent(component: string): boolean {
  return classifyComponent(component) === null;
}

/**
 * Validates an entire relative path by splitting on forward slash —
 * archive entries always use `/` regardless of the host OS, and the
 * builder receives subpath fragments that have already been
 * platform-normalized by the caller. Backslashes are not split because
 * a backslash inside a component is itself rejected by the regex.
 *
 * Returns `null` when every component passes; otherwise returns the
 * first failing component plus its rejection reason.
 */
export function classifyRelativePath(
  relPath: string,
): { component: string; reason: ComponentRejection } | null {
  if (relPath.includes("\0")) {
    return { component: "", reason: "nul_byte" };
  }
  if (PERCENT_SEPARATOR_RE.test(relPath)) {
    return { component: relPath, reason: "percent_encoded_separator" };
  }
  // Reject absolute paths up front — they bypass the workspace root.
  if (relPath.startsWith("/") || relPath.startsWith("\\")) {
    return { component: "", reason: "empty" };
  }
  const parts = relPath.split("/");
  for (const c of parts) {
    const r = classifyComponent(c);
    if (r !== null) {
      return { component: c, reason: r };
    }
  }
  return null;
}
