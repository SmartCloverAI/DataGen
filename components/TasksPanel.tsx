"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type TaskStatus = "queued" | "running" | "succeeded" | "failed";

type Task = {
  id: string;
  prompt: string;
  count: number;
  createdAt: string;
  status: TaskStatus;
  step?: "schema" | "records" | "completed";
  schemaStatus?: "pending" | "running" | "succeeded" | "failed";
  schemaError?: string | null;
  datasetMode?: boolean;
  useCustomInference?: boolean;
  inferenceBaseUrl?: string;
  inferenceModel?: string | null;
  completed: number;
  failures: number;
  results: unknown[];
};

import { ACTIVE_POLL_SECONDS, IDLE_POLL_SECONDS } from "@/lib/datagen/polling";

export function TasksPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(5);
  const [datasetMode, setDatasetMode] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useCustomInference, setUseCustomInference] = useState(false);
  const [inferenceBaseUrl, setInferenceBaseUrl] = useState("");
  const [inferencePath, setInferencePath] = useState("");
  const [inferenceApiKey, setInferenceApiKey] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [inferenceModel, setInferenceModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    if (!res.ok) {
      setError("Failed to load tasks");
      return;
    }
    const data = await res.json();
    setTasks(data.tasks ?? []);
  };

  const latestTasksRef = useRef<Task[]>([]);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    const schedule = (seconds: number) => {
      timer = setTimeout(tick, seconds * 1000);
    };

    const tick = async () => {
      await refresh();
      const hasActive = (latestTasksRef.current ?? []).some(
        (t) => t.status === "running" || t.status === "queued",
      );
      schedule(hasActive ? ACTIVE_POLL_SECONDS : IDLE_POLL_SECONDS);
    };

    tick();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    latestTasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    const loadSettings = async () => {
      const res = await fetch("/api/user/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setInferenceBaseUrl(data.baseUrl ?? "");
      setInferenceModel(data.model ?? "");
      setInferencePath(data.path ?? "");
      setHasSavedApiKey(Boolean(data.hasApiKey));
      if (data.baseUrl) {
        setAdvancedOpen(true);
        setUseCustomInference(true);
      }
    };
    loadSettings();
  }, []);

  const saveSettings = async () => {
    const payload: Record<string, unknown> = {
      baseUrl: inferenceBaseUrl || undefined,
      path: inferencePath || undefined,
      model: inferenceModel || undefined,
    };
    if (inferenceApiKey) {
      payload.apiKey = inferenceApiKey;
    }
    const res = await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      setHasSavedApiKey(Boolean(data.hasApiKey));
      if (payload.apiKey) {
        setInferenceApiKey("");
      }
      return true;
    }
    return false;
  };

  const fetchModels = async () => {
    setModels([]);
    setModelsError(null);
    setModelsLoading(true);
    const res = await fetch("/api/user/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: inferenceBaseUrl || undefined,
        apiKey: inferenceApiKey || undefined,
      }),
    });
    setModelsLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setModelsError(data?.error ?? "Could not load models");
      return;
    }
    const data = await res.json();
    const normalized =
      Array.isArray(data.models) && data.models.length > 0
        ? data.models
            .map((m: any) =>
              typeof m === "string"
                ? m
                : typeof m?.id === "string"
                  ? m.id
                  : typeof m?.name === "string"
                    ? m.name
                    : null,
            )
            .filter((m: string | null): m is string => Boolean(m))
        : [];
    if (normalized.length > 0) {
      setModels(normalized);
      setInferenceModel((prev) => prev || normalized[0]);
    } else {
      setModelsError("No models returned");
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    if (useCustomInference) {
      await saveSettings();
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        count,
        datasetMode,
        useCustomInference,
        inferenceBaseUrl: useCustomInference ? inferenceBaseUrl || undefined : undefined,
        inferencePath: useCustomInference ? inferencePath || undefined : undefined,
        inferenceModel: useCustomInference ? inferenceModel || undefined : undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to create task");
      setSubmitting(false);
      return;
    }
    setPrompt("");
    setCount(5);
    setDatasetMode(false);
    setUseCustomInference(useCustomInference);
    await refresh();
    setSubmitting(false);
  };

  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status === "running" || t.status === "queued"),
    [tasks],
  );

  const showFailures =
    (process.env.NEXT_PUBLIC_SHOW_FAILURES ?? "").toLowerCase() === "true";

  return (
    <section className="panel__body">
      <div className="panel__header">
        <div>
          <h2>Create a generation job</h2>
          <p className="muted">
            Enter a prompt and record count. We will fetch a generic schema once, then
            generate all records using that schema for consistency.
          </p>
          <p className="muted small">
            Tip: Some providers (e.g. DeepSeek) use <code>/chat/completions</code> instead of the default
            <code>/create_chat_completion</code>. Set that in Advanced if needed.
          </p>
        </div>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Prompt</span>
          <textarea
            className="textarea"
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Synthetic SaaS customer profile with name, plan, MRR, churn risk"
          />
        </label>
        <label className="field">
          <span>Count</span>
          <input
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={datasetMode}
            onChange={(e) => setDatasetMode(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ marginLeft: 8 }}>
            Dataset mode (optimize schema/records for cohesive synthetic datasets)
          </span>
        </label>
        <div className="field">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div>
              <span>Advanced</span>
              <p className="muted small">
                Use a custom inference API and token (saved per user).
              </p>
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setAdvancedOpen((prev) => !prev)}
            >
              {advancedOpen ? "Hide" : "Show"}
            </button>
          </div>
          {advancedOpen ? (
            <div
              style={{
                border: "1px solid var(--panel-border)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <label className="field" style={{ flexDirection: "row", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={useCustomInference}
                  onChange={(e) => setUseCustomInference(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ marginLeft: 8 }}>Use custom inference gateway</span>
              </label>
              {useCustomInference ? (
                <>
                  <label className="field">
                    <span>Inference API base URL</span>
                    <input
                      type="url"
                      placeholder="https://api.example.com"
                      value={inferenceBaseUrl}
                      onChange={(e) => setInferenceBaseUrl(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Inference API path</span>
                    <input
                      type="text"
                      placeholder="/create_chat_completion (default) or /chat/completions"
                      value={inferencePath}
                      onChange={(e) => setInferencePath(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>API token</span>
                    <input
                      type="password"
                      placeholder={hasSavedApiKey ? "Token saved (leave blank to keep)" : "Enter token"}
                      value={inferenceApiKey}
                      onChange={(e) => setInferenceApiKey(e.target.value)}
                    />
                    <button type="button" className="button" onClick={saveSettings} disabled={!inferenceBaseUrl}>
                      Save token & base URL
                    </button>
                  </label>
                  <div className="field">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>Model</span>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={fetchModels}
                        disabled={!inferenceBaseUrl || modelsLoading}
                      >
                        {modelsLoading ? "Loading..." : "Fetch models"}
                      </button>
                      {modelsError ? (
                        <span className="muted small">Falling back to manual entry</span>
                      ) : null}
                    </div>
                    {models.length > 0 && !modelsError ? (
                      <select
                        value={inferenceModel}
                        onChange={(e) => setInferenceModel(e.target.value)}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid var(--panel-border)",
                        }}
                      >
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Enter model name"
                        value={inferenceModel}
                        onChange={(e) => setInferenceModel(e.target.value)}
                      />
                    )}
                    {modelsError ? <p className="error small">{modelsError}</p> : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? "Starting..." : "Start generation"}
        </button>
      </form>

      <div className="panel__body" style={{ marginTop: 24 }}>
        <h2>Jobs</h2>
        {tasks.length === 0 ? (
          <p className="muted">No jobs yet. Start one above.</p>
        ) : (
          <div className="tasks">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} showFailures={showFailures} />
            ))}
          </div>
        )}
      </div>

      <p className="muted small">
        Polling every {activeTasks.length > 0 ? ACTIVE_POLL_SECONDS : IDLE_POLL_SECONDS}s
      </p>
    </section>
  );
}

function TaskRow({
  task,
  showFailures,
}: {
  task: Task;
  showFailures: boolean;
}) {
  const schemaStatus = task.schemaStatus ?? "pending";
  const step =
    task.step ??
    (task.status === "succeeded" || task.status === "failed" ? "completed" : "schema");
  const schemaDone = schemaStatus === "succeeded";
  const totalUnits = task.count + 1; // schema + records
  const completedUnits = task.completed + (schemaDone ? 1 : 0);
  const progress =
    totalUnits > 0 ? Math.min(100, Math.round((completedUnits / totalUnits) * 100)) : 0;
  const schemaFailed = schemaStatus === "failed";
  const canDownload = task.status === "succeeded";
  const recordsStatus = schemaFailed
    ? "blocked"
    : schemaStatus === "pending" || schemaStatus === "running"
      ? "waiting"
      : task.status === "queued"
        ? "queued"
        : step === "records"
          ? "running"
          : task.status;
  return (
    <div className="task">
      <div className="task__header">
        <div>
          <p className="muted small">{new Date(task.createdAt).toLocaleString()}</p>
          <p className="task__prompt">{task.prompt}</p>
          {task.datasetMode ? <p className="muted small">Dataset mode</p> : null}
          {task.useCustomInference ? (
            <p className="muted small">
              Custom inference{task.inferenceModel ? ` • ${task.inferenceModel}` : ""}
            </p>
          ) : null}
        </div>
        <div className={`badge badge--${task.status}`}>
          {task.status} ({task.completed}/{task.count})
        </div>
      </div>
      <div className="task__steps">
        <StepBadge label="Step 1: Schema" status={schemaStatus} />
        <StepBadge
          label="Step 2: Records"
          status={recordsStatus}
          detail={`${task.completed}/${task.count}`}
        />
      </div>
      <div className="progress">
        <div className="progress__bar" style={{ width: `${progress}%` }} />
      </div>
      <div className="task__actions">
        <p className="muted small">
          {showFailures ? `Failures: ${task.failures} • ` : null}
          Results: {task.results.length}
        </p>
        <div className="task__buttons">
          <DownloadButton id={task.id} format="json" disabled={!canDownload} />
          <DownloadButton id={task.id} format="csv" disabled={!canDownload} />
        </div>
      </div>
      {schemaFailed && task.schemaError ? (
        <p className="error small">Schema failed: {task.schemaError}</p>
      ) : null}
    </div>
  );
}

function StepBadge({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail?: string;
}) {
  return (
    <div className="task__step">
      <span>{label}</span>
      <strong>
        {status}
        {detail ? ` • ${detail}` : ""}
      </strong>
    </div>
  );
}

function DownloadButton({
  id,
  format,
  disabled,
}: {
  id: string;
  format: "json" | "csv";
  disabled: boolean;
}) {
  const label = format.toUpperCase();
  const href = `/api/tasks/${id}/export?format=${format}`;
  return (
    <a
      className={`button button--ghost ${disabled ? "button--disabled" : ""}`}
      href={disabled ? undefined : href}
      aria-disabled={disabled}
    >
      {label}
    </a>
  );
}
