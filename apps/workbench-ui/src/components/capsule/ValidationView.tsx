/**
 * ValidationView — runs the canonical CapsuleValidator (Phase 2A) against
 * the capsule and surfaces every violation. Errors and warnings are
 * separated visually so the user knows which findings are blocking.
 */
import { useEffect, useState } from "react";
import { apiClient, type CapsuleValidation } from "../../api/client";

interface Props {
  capsuleName: string;
}

export default function ValidationView({ capsuleName }: Props) {
  const [report, setReport] = useState<CapsuleValidation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .validateCapsule(capsuleName)
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, [capsuleName]);

  if (error)
    return (
      <article>
        <h3>Validation</h3>
        <p className="placeholder">Validator unavailable: {error}</p>
      </article>
    );
  if (!report) return <p className="placeholder">Validating capsule…</p>;

  const errors = report.violations.filter((v) => v.severity === "error");
  const warnings = report.violations.filter((v) => v.severity === "warning");

  return (
    <article>
      <h3>Validation</h3>
      <p>
        Status:{" "}
        {report.ok ? (
          <strong className="status-ok">PASSED</strong>
        ) : (
          <strong className="status-error">FAILED</strong>
        )}
      </p>
      {errors.length > 0 && (
        <section>
          <h4>Errors ({errors.length})</h4>
          <ul>
            {errors.map((v, i) => (
              <li key={`err-${i}`}>
                <code>{v.code}</code> — {v.message}
                {v.path && (
                  <>
                    {" "}
                    <span className="muted">
                      (<code>{v.path}</code>)
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section>
          <h4>Warnings ({warnings.length})</h4>
          <ul>
            {warnings.map((v, i) => (
              <li key={`warn-${i}`}>
                <code>{v.code}</code> — {v.message}
                {v.path && (
                  <>
                    {" "}
                    <span className="muted">
                      (<code>{v.path}</code>)
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {errors.length === 0 && warnings.length === 0 && (
        <p>Capsule passes the structural validator with no findings.</p>
      )}
    </article>
  );
}
