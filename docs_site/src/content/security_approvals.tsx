export default function SecurityApprovals() {
  return (
    <article>
      <h1>Security: Approval Flow</h1>
      <p className="page-status">
        Secure-core Layer 5 documentation for durable, human-controlled
        approvals.
      </p>

      <h2>Approval purpose</h2>
      <p>
        Approvals gate high-risk actions that could change privilege,
        lifecycle state, compute cost, sandbox policy, or externally visible
        artifacts. An approval is not a UI confirmation dialog; it is a
        persisted workflow with actor binding, expiration, audit emission, and
        atomic consumption.
      </p>

      <h2>Flow</h2>
      <ol>
        <li>A requester creates an approval request for a specific workspace, object, action, and context.</li>
        <li>The server determines which approver capability is required.</li>
        <li>A human approver with live membership and the required capability grants, denies, or leaves the request pending.</li>
        <li>A granted approval issues a single-use, time-bound token bound to the request context.</li>
        <li>The high-risk handler consumes the token atomically before side effects and re-checks capability at commit.</li>
      </ol>

      <h2>Rules</h2>
      <ul>
        <li>AI agents and workers cannot grant high-risk approvals.</li>
        <li>Approval creation and approval decision are separate actions.</li>
        <li>Expired, revoked, reused, or context-mismatched approvals fail closed.</li>
        <li>Approval failures emit audit events without exposing unrelated workspace details.</li>
      </ul>

      <h2>What users see</h2>
      <p>
        User-facing copy should name the action category and required
        approver role without revealing hidden object identifiers, storage
        paths, or provider-specific details.
      </p>
    </article>
  );
}
