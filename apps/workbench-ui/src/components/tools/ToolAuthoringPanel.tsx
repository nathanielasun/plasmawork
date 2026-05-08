import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type ToolAuthoringCheckResult,
  type ToolAuthoringDraft,
  type ToolAuthoringTemplate,
} from "../../api/client";
import { Card, Pill } from "../ui";

interface ToolAuthoringPanelProps {
  onRegistered: (name: string) => void;
}

function firstEditableFile(draft: ToolAuthoringDraft | null): string {
  return draft?.files.find((file) => file.editable)?.path ?? "tool.yaml";
}

function statusPillKind(status: ToolAuthoringDraft["status"]) {
  if (status === "registered") return "trusted";
  if (status === "checked") return "validated";
  return "draft";
}

export default function ToolAuthoringPanel({ onRegistered }: ToolAuthoringPanelProps) {
  const [templates, setTemplates] = useState<ToolAuthoringTemplate[]>([]);
  const [drafts, setDrafts] = useState<ToolAuthoringDraft[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [toolName, setToolName] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [draft, setDraft] = useState<ToolAuthoringDraft | null>(null);
  const [selectedPath, setSelectedPath] = useState("tool.yaml");
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [checkResult, setCheckResult] = useState<ToolAuthoringCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAuthoring = useCallback(() => {
    setError(null);
    Promise.all([
      apiClient.listToolAuthoringTemplates(),
      apiClient.listToolDrafts(),
    ])
      .then(([nextTemplates, nextDrafts]) => {
        setTemplates(nextTemplates);
        setDrafts(nextDrafts);
        setSelectedTemplate((current) => current || nextTemplates[0]?.template_id || "");
        setSelectedDraftId((current) => current || nextDrafts[0]?.draft_id || "");
      })
      .catch((nextError) => setError(String(nextError)));
  }, []);

  useEffect(() => {
    loadAuthoring();
  }, [loadAuthoring]);

  useEffect(() => {
    if (!selectedDraftId) {
      setDraft(null);
      return;
    }
    let cancelled = false;
    apiClient
      .getToolDraft(selectedDraftId)
      .then((nextDraft) => {
        if (cancelled) return;
        setDraft(nextDraft);
        setCheckResult(nextDraft.last_check);
        setSelectedPath((current) =>
          nextDraft.files.some((file) => file.path === current && file.editable)
            ? current
            : firstEditableFile(nextDraft),
        );
      })
      .catch((nextError) => {
        if (!cancelled) setError(String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDraftId]);

  useEffect(() => {
    if (!draft || !selectedPath) return;
    let cancelled = false;
    setFileDirty(false);
    apiClient
      .readToolDraftFile(draft.draft_id, selectedPath)
      .then((file) => {
        if (!cancelled) setFileContent(file.content);
      })
      .catch((nextError) => {
        if (!cancelled) setError(String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [draft, selectedPath]);

  const activeTemplate = useMemo(
    () => templates.find((template) => template.template_id === selectedTemplate),
    [selectedTemplate, templates],
  );

  const refreshDraft = useCallback((draftId: string) => {
    return apiClient.getToolDraft(draftId).then((nextDraft) => {
      setDraft(nextDraft);
      setDrafts((current) => {
        const others = current.filter((row) => row.draft_id !== nextDraft.draft_id);
        return [nextDraft, ...others];
      });
      return nextDraft;
    });
  }, []);

  const createDraft = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const nextDraft = await apiClient.createToolDraft(selectedTemplate, toolName.trim());
      setDraft(nextDraft);
      setDrafts((current) => [nextDraft, ...current]);
      setSelectedDraftId(nextDraft.draft_id);
      setSelectedPath(firstEditableFile(nextDraft));
      setToolName("");
      setMessage(`Draft created for ${nextDraft.tool_name}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    if (!draft || !selectedPath) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const nextDraft = await apiClient.writeToolDraftFile(draft.draft_id, selectedPath, fileContent);
      setDraft(nextDraft);
      setFileDirty(false);
      setCheckResult(nextDraft.last_check);
      setMessage(`Saved ${selectedPath}. Rerun package check before registration.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiClient.checkToolDraft(draft.draft_id);
      setCheckResult(result);
      await refreshDraft(draft.draft_id);
      setMessage(result.passed ? "Package check passed." : "Package check failed.");
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const registerDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const registered = await apiClient.registerToolDraft(draft.draft_id);
      await refreshDraft(draft.draft_id);
      onRegistered(registered.name);
      setMessage(`Registered ${registered.name} into local imported tools.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const exportDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const exported = await apiClient.exportToolDraft(draft.draft_id);
      setMessage(`Exported draft to ${exported.archive}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const checkerCurrent =
    draft?.last_check?.passed === true &&
    draft.last_check.content_hash === draft.content_hash;

  return (
    <Card
      title="Build tool from template"
      subtitle="Creates controlled drafts under local_cache/workspaces/local/tool_drafts; registration is blocked until the current draft passes the backend package checker."
      action={draft && <Pill kind={statusPillKind(draft.status)}>{draft.status}</Pill>}
      className="tool-authoring"
    >
      <div className="tool-authoring-grid">
        <section className="tool-authoring-column">
          <h3>Start</h3>
          <label>
            <span className="eyebrow">Template</span>
            <select
              value={selectedTemplate}
              onChange={(event) => setSelectedTemplate(event.target.value)}
              aria-label="Tool template"
            >
              {templates.map((template) => (
                <option key={template.template_id} value={template.template_id}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>
          {activeTemplate && (
            <p className="muted tool-authoring-template-note">
              {activeTemplate.description || `${activeTemplate.type} template`}
            </p>
          )}
          <label>
            <span className="eyebrow">New tool name</span>
            <input
              type="text"
              value={toolName}
              onChange={(event) => setToolName(event.target.value)}
              placeholder="my_diagnostic_tool"
              aria-label="New tool name"
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={createDraft}
            disabled={busy || !selectedTemplate || !toolName.trim()}
          >
            Create draft
          </button>

          {drafts.length > 0 && (
            <label>
              <span className="eyebrow">Open draft</span>
              <select
                value={selectedDraftId}
                onChange={(event) => setSelectedDraftId(event.target.value)}
                aria-label="Open tool draft"
              >
                {drafts.map((row) => (
                  <option key={row.draft_id} value={row.draft_id}>
                    {row.tool_name} · {row.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="tool-authoring-column tool-authoring-editor">
          <div className="row-between">
            <h3>Edit draft</h3>
            {draft && <Pill kind={draft.manifest_ok ? "validated" : "warning"}>{draft.manifest_ok ? "manifest ok" : "manifest error"}</Pill>}
          </div>
          {draft ? (
            <>
              {draft.manifest_errors.length > 0 && (
                <p className="error" role="alert">
                  {draft.manifest_errors.join("; ")}
                </p>
              )}
              <div className="tool-authoring-file-grid">
                <div className="tool-authoring-file-list">
                  {draft.files
                    .filter((file) => file.editable)
                    .map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`list-row${selectedPath === file.path ? " list-row-active" : ""}`}
                        onClick={() => setSelectedPath(file.path)}
                      >
                        <span className="list-row-main">
                          <strong>{file.path}</strong>
                          <span className="muted">{file.size_bytes} bytes</span>
                        </span>
                      </button>
                    ))}
                </div>
                <div className="tool-authoring-textarea-wrap">
                  <div className="row-between">
                    <code>{selectedPath}</code>
                    {fileDirty && <Pill kind="warning">unsaved</Pill>}
                  </div>
                  <textarea
                    value={fileContent}
                    onChange={(event) => {
                      setFileContent(event.target.value);
                      setFileDirty(true);
                    }}
                    spellCheck={false}
                    aria-label="Tool draft file content"
                  />
                  <div className="action-row action-row-start">
                    <button type="button" className="primary" onClick={saveFile} disabled={busy || !fileDirty}>
                      Save file
                    </button>
                    <span className="muted">Only allow-listed package files are editable.</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="placeholder">Create or open a draft to edit files.</p>
          )}
        </section>

        <section className="tool-authoring-column">
          <h3>Check & register</h3>
          {draft ? (
            <>
              <div className="detail-grid detail-grid-compact">
                <span>Draft</span>
                <code>{draft.draft_id}</code>
                <span>Hash</span>
                <code>{draft.content_hash.slice(0, 12)}</code>
                <span>Checker</span>
                <span>{checkerCurrent ? "current" : "required"}</span>
              </div>
              <div className="action-row action-row-start">
                <button type="button" className="primary" onClick={runCheck} disabled={busy || fileDirty}>
                  Run package check
                </button>
                <button type="button" onClick={registerDraft} disabled={busy || !checkerCurrent || fileDirty}>
                  Register
                </button>
                <button type="button" onClick={exportDraft} disabled={busy}>
                  Export draft
                </button>
              </div>
              {checkResult && (
                <div className="tool-authoring-check">
                  <p>
                    Check:{" "}
                    <strong className={checkResult.passed ? "status-ok" : "status-error"}>
                      {checkResult.passed ? "PASSED" : "FAILED"}
                    </strong>{" "}
                    <span className="muted">(exit {checkResult.returncode})</span>
                  </p>
                  {checkResult.issues.length > 0 && (
                    <div className="list-stack list-stack-condensed">
                      {checkResult.issues.map((issue) => (
                        <p key={`${issue.severity}:${issue.location}:${issue.message}`} className={issue.severity === "error" ? "error" : "tool-group-more"}>
                          <strong>{issue.severity}</strong> {issue.location}: {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="placeholder">Checker and registration appear after a draft is open.</p>
          )}
        </section>
      </div>

      {message && <p className="route-card-note">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Card>
  );
}
