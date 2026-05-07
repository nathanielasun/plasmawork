export default function OperatorAccess() {
  return (
    <article>
      <h1>Operator Access</h1>
      <p className="page-status">
        Operator access is a constrained platform-administration path for
        maintenance, incident response, and tightly scoped recovery.
      </p>

      <h2>Purpose</h2>
      <p>
        Operator access exists for platform maintenance, incident response,
        and tightly scoped recovery. It is separate from workspace membership
        and does not grant blanket access to scientific content.
      </p>

      <h2>Required controls</h2>
      <ul>
        <li>Operator sessions are time-limited and reason-bound.</li>
        <li>Platform capability checks include recent step-up authentication before high-risk approval tokens are consumed.</li>
        <li>Every platform capability use emits an audit event and an operator event.</li>
        <li>Operator capabilities are split by purpose rather than bundled into a single global role.</li>
        <li>Break-glass use is reviewable after the fact through the audit and operator chains.</li>
      </ul>

      <h2>What operators cannot do silently</h2>
      <p>
        Operators cannot silently rewrite audit history, bypass workspace
        approvals, mutate protected capsule versions, or re-anchor divergent
        log chains without an incident trail. Platform power must produce
        platform accountability.
      </p>

      <h2>User-visible posture</h2>
      <p>
        Workspace users should be able to distinguish normal workspace
        actions from operator interventions in audit views, subject to
        redaction and incident-response policy.
      </p>
    </article>
  );
}
