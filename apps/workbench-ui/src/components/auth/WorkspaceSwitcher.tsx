/**
 * WorkspaceSwitcher — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Renders a dropdown of the user's workspace memberships and lets
 * them switch the active workspace. Switching updates the session
 * context's activeWorkspaceSlug; subsequent /api/{slug}/* calls flow
 * through the new workspace.
 *
 * Filters out the synthetic ``_platform`` workspace from the
 * dropdown. ``_platform`` is the capability anchor the gateway uses
 * to give the IncidentRemediator role to platform admins; it has no
 * data and isn't a useful workspace to switch into.
 */
import { useSession } from "./SessionContext.js";

export function WorkspaceSwitcher(): JSX.Element {
  const { session, activeWorkspaceSlug, setActiveWorkspaceSlug } = useSession();
  const memberships = session.memberships.filter(
    (m) => m.workspace_name !== "_platform",
  );

  if (memberships.length === 0) {
    return (
      <p className="workspace-switcher-empty">
        No workspaces — ask an administrator to grant access.
      </p>
    );
  }

  if (memberships.length === 1) {
    // Single-workspace user: render a label, not a dropdown. Avoids
    // a useless control + clarifies the scope of what they're seeing.
    return (
      <p className="workspace-switcher-single">
        Workspace: <strong>{memberships[0]!.workspace_name}</strong>
      </p>
    );
  }

  return (
    <label className="workspace-switcher">
      <span>Workspace</span>
      <select
        value={activeWorkspaceSlug}
        onChange={(e) => setActiveWorkspaceSlug(e.target.value)}
      >
        {memberships.map((m) => (
          <option key={m.workspace_id} value={m.workspace_name}>
            {m.workspace_name}
          </option>
        ))}
      </select>
    </label>
  );
}
