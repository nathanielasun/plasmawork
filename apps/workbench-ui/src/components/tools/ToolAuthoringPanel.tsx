import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type ToolAuthoringCheckResult,
  type ToolAuthoringCodeTemplate,
  type ToolAuthoringCodeTemplateCategory,
  type ToolAuthoringDraft,
  type ToolAuthoringPreviewHarness,
  type ToolAuthoringPreviewResult,
  type ToolAuthoringTemplate,
  type ToolRunOutput,
} from "../../api/client";
import { Card, Pill } from "../ui";
import ToolDiagramViewer from "./ToolDiagramViewer";

interface ToolAuthoringPanelProps {
  onRegistered: (name: string) => void;
}

type AuthoringTab = "start" | "code" | "preview" | "check" | "manage";

const AUTHORING_TABS: ReadonlyArray<{
  id: AuthoringTab;
  label: string;
  disabledWithoutDraft: boolean;
}> = [
  { id: "start", label: "Start", disabledWithoutDraft: false },
  { id: "code", label: "Code", disabledWithoutDraft: true },
  { id: "preview", label: "Preview", disabledWithoutDraft: true },
  { id: "check", label: "Check", disabledWithoutDraft: true },
  { id: "manage", label: "Manage", disabledWithoutDraft: true },
];

const TEMPLATE_CATEGORIES: ToolAuthoringCodeTemplateCategory[] = [
  "visualization",
  "ode_solver",
  "diagram",
  "data_importer",
  "diagnostic",
  "utility",
];

const PREVIEW_HARNESSES: ToolAuthoringPreviewHarness[] = [
  "python_smoke",
  "ode_solver",
  "visualization",
  "diagram",
  "data_transform",
];

function firstEditableFile(draft: ToolAuthoringDraft | null): string {
  const python = draft?.files.find((file) => file.editable && file.path.endsWith(".py"));
  return python?.path ?? draft?.files.find((file) => file.editable)?.path ?? "tool.yaml";
}

function statusPillKind(status: ToolAuthoringDraft["status"]) {
  if (status === "registered") return "trusted";
  if (status === "checked") return "validated";
  return "draft";
}

function languageForPath(path: string): string {
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}

function formatCategory(category: string): string {
  return category.replaceAll("_", " ");
}

function outputValueText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function renderTableLike(output: ToolRunOutput) {
  const value = output.value;
  const rows = Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
    : typeof value === "object" && value !== null && Array.isArray((value as { rows?: unknown }).rows)
      ? ((value as { rows: unknown[] }).rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row)))
      : [];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (rows.length === 0 || columns.length === 0) {
    return (
      <pre className="tool-json-preview">
        <code>{outputValueText(value)}</code>
      </pre>
    );
  }
  return (
    <div className="table-wrap tool-output-table">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 24).map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderPreviewOutput(output: ToolRunOutput) {
  if (output.kind === "image" && typeof output.value === "string" && output.value.startsWith("data:image/")) {
    return <img className="tool-image-preview" src={output.value} alt={output.name} />;
  }
  if (output.kind === "diagram") {
    return <ToolDiagramViewer title={output.name} value={output.value} />;
  }
  if (output.kind === "table" || output.kind === "timeseries") {
    return renderTableLike(output);
  }
  return (
    <pre className="tool-json-preview">
      <code>{outputValueText(output.value)}</code>
    </pre>
  );
}

export default function ToolAuthoringPanel({ onRegistered }: ToolAuthoringPanelProps) {
  const [templates, setTemplates] = useState<ToolAuthoringTemplate[]>([]);
  const [codeTemplates, setCodeTemplates] = useState<ToolAuthoringCodeTemplate[]>([]);
  const [drafts, setDrafts] = useState<ToolAuthoringDraft[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedCodeTemplateId, setSelectedCodeTemplateId] = useState("");
  const [toolName, setToolName] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [draft, setDraft] = useState<ToolAuthoringDraft | null>(null);
  const [selectedPath, setSelectedPath] = useState("src/tool.py");
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [checkResult, setCheckResult] = useState<ToolAuthoringCheckResult | null>(null);
  const [previewResult, setPreviewResult] = useState<ToolAuthoringPreviewResult | null>(null);
  const [previewHarness, setPreviewHarness] = useState<ToolAuthoringPreviewHarness>("python_smoke");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState<ToolAuthoringCodeTemplateCategory | "all">("all");
  const [saveTemplateTitle, setSaveTemplateTitle] = useState("");
  const [saveTemplateCategory, setSaveTemplateCategory] = useState<ToolAuthoringCodeTemplateCategory>("utility");
  const [importTemplateTitle, setImportTemplateTitle] = useState("");
  const [importTemplateContent, setImportTemplateContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authoringTab, setAuthoringTab] = useState<AuthoringTab>("start");

  const loadAuthoring = useCallback(() => {
    setError(null);
    Promise.all([
      apiClient.listToolAuthoringTemplates(),
      apiClient.listToolAuthoringCodeTemplates(),
      apiClient.listToolDrafts(),
    ])
      .then(([nextTemplates, nextCodeTemplates, nextDrafts]) => {
        setTemplates(nextTemplates);
        setCodeTemplates(nextCodeTemplates);
        setDrafts(nextDrafts);
        setSelectedTemplate((current) => current || nextTemplates[0]?.template_id || "");
        setSelectedCodeTemplateId((current) => current || nextCodeTemplates[0]?.template_id || "");
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
      setFileContent("");
      setFileDirty(false);
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

  const activeCodeTemplate = useMemo(
    () => codeTemplates.find((template) => template.template_id === selectedCodeTemplateId) ?? null,
    [codeTemplates, selectedCodeTemplateId],
  );

  const filteredCodeTemplates = useMemo(() => {
    const needle = templateSearch.trim().toLowerCase();
    return codeTemplates.filter((template) => {
      const categoryOk = templateCategory === "all" || template.category === templateCategory;
      const searchOk = !needle || `${template.title} ${template.description} ${template.category}`.toLowerCase().includes(needle);
      return categoryOk && searchOk;
    });
  }, [codeTemplates, templateCategory, templateSearch]);

  const checkerCurrent =
    draft?.last_check?.passed === true &&
    draft.last_check.content_hash === draft.content_hash;

  const editableFiles = draft?.files.filter((file) => file.editable) ?? [];

  const refreshDraft = useCallback((draftId: string) => {
    return apiClient.getToolDraft(draftId).then((nextDraft) => {
      setDraft(nextDraft);
      setDrafts((current) => {
        const others = current.filter((row) => row.draft_id !== nextDraft.draft_id);
        return [nextDraft, ...others];
      });
      setCheckResult(nextDraft.last_check);
      return nextDraft;
    });
  }, []);

  const refreshCodeTemplates = useCallback(() => {
    return apiClient.listToolAuthoringCodeTemplates().then((nextTemplates) => {
      setCodeTemplates(nextTemplates);
      setSelectedCodeTemplateId((current) => current || nextTemplates[0]?.template_id || "");
      return nextTemplates;
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
      setAuthoringTab("code");
      setToolName("");
      setPreviewResult(null);
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
      setPreviewResult(null);
      setMessage(`Saved ${selectedPath}. Preview and package check should be rerun.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const applyCodeTemplate = async () => {
    if (!draft || !activeCodeTemplate) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const application = await apiClient.applyToolAuthoringCodeTemplate(
        draft.draft_id,
        activeCodeTemplate.template_id,
        activeCodeTemplate.target_path,
      );
      setDraft(application.draft);
      setDrafts((current) => [application.draft, ...current.filter((row) => row.draft_id !== application.draft.draft_id)]);
      setSelectedPath(application.path);
      const file = await apiClient.readToolDraftFile(application.draft.draft_id, application.path);
      setFileContent(file.content);
      setFileDirty(false);
      setPreviewHarness(activeCodeTemplate.preview_harness);
      setPreviewResult(null);
      setAuthoringTab("code");
      setMessage(`Applied ${activeCodeTemplate.title} to ${application.path}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentAsTemplate = async () => {
    if (!selectedPath || !saveTemplateTitle.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await apiClient.createToolAuthoringCodeTemplate({
        title: saveTemplateTitle.trim(),
        description: `Saved from ${selectedPath}`,
        category: saveTemplateCategory,
        target_path: selectedPath,
        content: fileContent,
        preview_harness: previewHarness,
      });
      await refreshCodeTemplates();
      setSelectedCodeTemplateId(saved.template_id);
      setSaveTemplateTitle("");
      setMessage(`Saved code template ${saved.title}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const importTemplate = async () => {
    if (!importTemplateTitle.trim() || !importTemplateContent.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const imported = await apiClient.importToolAuthoringCodeTemplate({
        title: importTemplateTitle.trim(),
        description: "Imported through the tool builder UI.",
        category: saveTemplateCategory,
        target_path: selectedPath || "src/tool.py",
        content: importTemplateContent,
        preview_harness: previewHarness,
      });
      await refreshCodeTemplates();
      setSelectedCodeTemplateId(imported.template_id);
      setImportTemplateTitle("");
      setImportTemplateContent("");
      setMessage(`Imported code template ${imported.title}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const deleteActiveTemplate = async () => {
    if (!activeCodeTemplate || activeCodeTemplate.readonly) return;
    if (!window.confirm(`Delete code template "${activeCodeTemplate.title}"?`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.deleteToolAuthoringCodeTemplate(activeCodeTemplate.template_id);
      const nextTemplates = await refreshCodeTemplates();
      setSelectedCodeTemplateId(nextTemplates[0]?.template_id ?? "");
      setMessage(`Deleted code template ${activeCodeTemplate.title}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!draft) return;
    if (fileDirty) {
      setError("Save the current file before running a preview.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiClient.previewToolDraft(draft.draft_id, previewHarness);
      setPreviewResult(result);
      setAuthoringTab("preview");
      setMessage(result.passed ? "Preview completed." : "Preview failed.");
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
      setAuthoringTab("check");
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
      setAuthoringTab("check");
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

  const deleteDraft = async () => {
    if (!draft) return;
    if (!window.confirm(`Delete draft "${draft.tool_name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.deleteToolDraft(draft.draft_id);
      const remaining = drafts.filter((row) => row.draft_id !== draft.draft_id);
      setDrafts(remaining);
      setSelectedDraftId(remaining[0]?.draft_id ?? "");
      setDraft(remaining[0] ?? null);
      setFileContent("");
      setPreviewResult(null);
      setAuthoringTab("start");
      setMessage(`Deleted draft ${draft.tool_name}.`);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Python tool builder"
      subtitle="Author Python-backed internal tools from controlled drafts, reusable code templates, bounded previews, and package checks."
      action={draft && <Pill kind={statusPillKind(draft.status)}>{draft.status}</Pill>}
      className="tool-authoring"
    >
      <div className="tool-authoring-toolbar">
        <div className="segment tool-authoring-tabs" role="tablist" aria-label="Tool authoring step">
          {AUTHORING_TABS.map((tab) => {
            const disabled = tab.disabledWithoutDraft && !draft;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={authoringTab === tab.id}
                className={authoringTab === tab.id ? "segment-active" : ""}
                disabled={disabled}
                onClick={() => setAuthoringTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {draft && (
          <div className="tool-authoring-state-line">
            <span>{draft.tool_name}</span>
            <span>{editableFiles.length} editable files</span>
            <span>{fileDirty ? "unsaved" : checkerCurrent ? "checker current" : "check required"}</span>
          </div>
        )}
      </div>

      {authoringTab === "start" && (
        <section className="tool-authoring-pane tool-authoring-start-pane">
          <div className="tool-authoring-start-grid">
            <label>
              <span className="eyebrow">Package template</span>
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
          </div>
          {activeTemplate && (
            <p className="muted tool-authoring-template-note">
              {activeTemplate.description || `${activeTemplate.type} template`}
            </p>
          )}
          <div className="action-row action-row-start">
            <button
              type="button"
              className="primary"
              onClick={createDraft}
              disabled={busy || !selectedTemplate || !toolName.trim()}
            >
              Create draft
            </button>
            <span className="muted">Drafts stay under local_cache/workspaces/&#123;workspace&#125;/tool_drafts (per-workspace since Phase α, 2026-05-10).</span>
          </div>

          {drafts.length > 0 && (
            <div className="tool-authoring-draft-picker">
              <label>
                <span className="eyebrow">Open draft</span>
                <select
                  value={selectedDraftId}
                  onChange={(event) => {
                    setSelectedDraftId(event.target.value);
                    setAuthoringTab("code");
                  }}
                  aria-label="Open tool draft"
                >
                  {drafts.map((row) => (
                    <option key={row.draft_id} value={row.draft_id}>
                      {row.tool_name} · {row.status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </section>
      )}

      {authoringTab === "code" && (
        <section className="tool-authoring-pane tool-authoring-code-pane">
          {draft ? (
            <>
              {draft.manifest_errors.length > 0 && (
                <p className="error" role="alert">
                  {draft.manifest_errors.join("; ")}
                </p>
              )}
              <div className="tool-code-workbench">
                <aside className="tool-code-file-list" aria-label="Draft files">
                  <div className="tool-authoring-minihead">
                    <strong>Draft files</strong>
                    <Pill kind={draft.manifest_ok ? "validated" : "warning"}>{draft.manifest_ok ? "manifest" : "manifest"}</Pill>
                  </div>
                  {editableFiles.map((file) => (
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
                </aside>

                <div className="tool-code-editor-shell">
                  <div className="tool-code-editor-header">
                    <code>{selectedPath}</code>
                    <div className="action-row">
                      {fileDirty && <Pill kind="warning">unsaved</Pill>}
                      <button type="button" className="primary" onClick={saveFile} disabled={busy || !fileDirty}>
                        Save file
                      </button>
                      <button type="button" onClick={runPreview} disabled={busy || fileDirty}>
                        Run preview
                      </button>
                    </div>
                  </div>
                  <div className="tool-monaco-frame">
                    <Editor
                      height="430px"
                      language={languageForPath(selectedPath)}
                      theme="vs-dark"
                      value={fileContent}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        wordWrap: "on",
                        tabSize: 4,
                      }}
                      onChange={(value) => {
                        setFileContent(value ?? "");
                        setFileDirty(true);
                      }}
                    />
                  </div>
                </div>

                <aside className="tool-code-template-drawer">
                  <div className="tool-authoring-minihead">
                    <strong>Code templates</strong>
                    <Pill kind="model">{filteredCodeTemplates.length}</Pill>
                  </div>
                  <input
                    type="search"
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Search snippets..."
                    aria-label="Search code templates"
                  />
                  <select
                    value={templateCategory}
                    onChange={(event) => setTemplateCategory(event.target.value as ToolAuthoringCodeTemplateCategory | "all")}
                    aria-label="Filter code template category"
                  >
                    <option value="all">All categories</option>
                    {TEMPLATE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {formatCategory(category)}
                      </option>
                    ))}
                  </select>
                  <div className="tool-code-template-list">
                    {filteredCodeTemplates.map((template) => (
                      <button
                        key={template.template_id}
                        type="button"
                        className={`tool-code-template-card${selectedCodeTemplateId === template.template_id ? " tool-code-template-card-active" : ""}`}
                        onClick={() => {
                          setSelectedCodeTemplateId(template.template_id);
                          setPreviewHarness(template.preview_harness);
                        }}
                      >
                        <span>
                          <strong>{template.title}</strong>
                          <small>{formatCategory(template.category)} · {template.source}</small>
                        </span>
                        {template.readonly && <Pill kind="trusted">built-in</Pill>}
                      </button>
                    ))}
                  </div>
                  {activeCodeTemplate && (
                    <div className="tool-code-template-preview">
                      <div className="row-between">
                        <strong>{activeCodeTemplate.title}</strong>
                        <Pill kind="diagnostic">{activeCodeTemplate.preview_harness}</Pill>
                      </div>
                      <p className="muted">{activeCodeTemplate.description}</p>
                      <pre className="tool-json-preview tool-code-snippet-preview">
                        <code>{activeCodeTemplate.content}</code>
                      </pre>
                      <div className="action-row action-row-start">
                        <button type="button" className="primary" onClick={applyCodeTemplate} disabled={busy || fileDirty}>
                          Apply to draft
                        </button>
                        <button type="button" onClick={deleteActiveTemplate} disabled={busy || activeCodeTemplate.readonly}>
                          Delete template
                        </button>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </>
          ) : (
            <p className="placeholder">Create or open a draft to edit Python files.</p>
          )}
        </section>
      )}

      {authoringTab === "preview" && (
        <section className="tool-authoring-pane">
          <div className="tool-preview-controls">
            <label>
              <span className="eyebrow">Preview harness</span>
              <select
                value={previewHarness}
                onChange={(event) => setPreviewHarness(event.target.value as ToolAuthoringPreviewHarness)}
                aria-label="Preview harness"
              >
                {PREVIEW_HARNESSES.map((harness) => (
                  <option key={harness} value={harness}>
                    {harness}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primary" onClick={runPreview} disabled={busy || !draft || fileDirty}>
              Run preview
            </button>
            {fileDirty && <span className="muted">Save first: previews execute saved draft content only.</span>}
          </div>

          {previewResult ? (
            <div className="tool-preview-results">
              <div className="detail-grid detail-grid-compact">
                <span>Status</span>
                <strong className={previewResult.passed ? "status-ok" : "status-error"}>{previewResult.passed ? "passed" : "failed"}</strong>
                <span>Harness</span>
                <code>{previewResult.harness}</code>
                <span>Elapsed</span>
                <span>{previewResult.elapsed_ms} ms</span>
                <span>Hash</span>
                <code>{previewResult.content_hash.slice(0, 12)}</code>
              </div>
              {previewResult.diagnostics && previewResult.diagnostics.length > 0 && (
                <div className="tool-authoring-check">
                  {previewResult.diagnostics.map((item) => <p key={item}>{item}</p>)}
                </div>
              )}
              <div className="tool-preview-output-grid">
                {previewResult.outputs.length === 0 ? (
                  <p className="placeholder">No preview outputs were returned.</p>
                ) : (
                  previewResult.outputs.map((output) => (
                    <Card
                      nested
                      key={output.name}
                      title={output.name}
                      action={<Pill kind="diagnostic">{output.kind}</Pill>}
                    >
                      {renderPreviewOutput(output)}
                    </Card>
                  ))
                )}
              </div>
              {(previewResult.stdout || previewResult.stderr) && (
                <div className="tool-preview-logs">
                  {previewResult.stdout && (
                    <pre className="tool-json-preview">
                      <code>{previewResult.stdout}</code>
                    </pre>
                  )}
                  {previewResult.stderr && (
                    <pre className="tool-json-preview tool-preview-stderr">
                      <code>{previewResult.stderr}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="placeholder">Run a preview to inspect diagrams, plots, tables, JSON, stdout, and stderr before package registration.</p>
          )}
        </section>
      )}

      {authoringTab === "check" && (
        <section className="tool-authoring-pane">
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
      )}

      {authoringTab === "manage" && (
        <section className="tool-authoring-pane">
          <div className="tool-manage-grid">
            <Card nested title="Save current file as template">
              <label>
                <span className="eyebrow">Template title</span>
                <input
                  value={saveTemplateTitle}
                  onChange={(event) => setSaveTemplateTitle(event.target.value)}
                  placeholder="My plotting helper"
                  aria-label="Template title"
                />
              </label>
              <label>
                <span className="eyebrow">Category</span>
                <select
                  value={saveTemplateCategory}
                  onChange={(event) => setSaveTemplateCategory(event.target.value as ToolAuthoringCodeTemplateCategory)}
                  aria-label="Save template category"
                >
                  {TEMPLATE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>{formatCategory(category)}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="primary" onClick={saveCurrentAsTemplate} disabled={busy || !saveTemplateTitle.trim()}>
                Save code template
              </button>
            </Card>

            <Card nested title="Import code template">
              <label>
                <span className="eyebrow">Import title</span>
                <input
                  value={importTemplateTitle}
                  onChange={(event) => setImportTemplateTitle(event.target.value)}
                  placeholder="Imported ODE helper"
                  aria-label="Import template title"
                />
              </label>
              <label>
                <span className="eyebrow">Template Python</span>
                <textarea
                  value={importTemplateContent}
                  onChange={(event) => setImportTemplateContent(event.target.value)}
                  placeholder="Paste a full src/tool.py template or helper snippet..."
                  aria-label="Import template content"
                />
              </label>
              <button type="button" className="primary" onClick={importTemplate} disabled={busy || !importTemplateTitle.trim() || !importTemplateContent.trim()}>
                Import template
              </button>
            </Card>

            <Card nested title="Delete draft">
              <p className="muted">
                Deletes the local draft package only. Registered draft records are retained for provenance.
              </p>
              <button type="button" className="danger" onClick={deleteDraft} disabled={busy || !draft || draft.status === "registered"}>
                Delete draft
              </button>
            </Card>
          </div>
        </section>
      )}

      {message && <p className="route-card-note">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Card>
  );
}
