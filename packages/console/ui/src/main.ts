import {
  Code2,
  createIcons,
  Database,
  FileCode2,
  LayoutDashboard,
  RefreshCw,
  Rocket,
} from "lucide";
import "./style.css";

type ProjectState = {
  readonly name: string;
  readonly root: string;
  readonly capabilities: {
    readonly appsScript: boolean;
    readonly firebaseRealtimeDatabase: boolean;
  };
};

const sessionToken = getSessionToken();

createIcons({
  icons: { Code2, Database, FileCode2, LayoutDashboard, RefreshCw, Rocket },
});

const refreshButton = required<HTMLButtonElement>("refresh");
const clearButton = required<HTMLButtonElement>("clear-log");
const logElement = required<HTMLDivElement>("log");

refreshButton.addEventListener("click", () => void inspectProject());
clearButton.addEventListener("click", () => {
  logElement.replaceChildren();
});

void inspectProject();

async function inspectProject(): Promise<void> {
  refreshButton.disabled = true;
  setRuntimeStatus("running", "Inspecting");
  appendLog("Inspecting project definition", "info");

  try {
    await invokeOperation<Record<string, never>, ProjectState>(
      "project.inspect",
      {},
      {
        log: (message) => appendLog(message, "info"),
        progress: (message, percentage) =>
          appendLog(
            percentage === undefined ? message : `${message} (${percentage}%)`,
            "progress",
          ),
        result: renderProject,
      },
    );
    setRuntimeStatus("ready", "Ready");
  } catch (error) {
    setRuntimeStatus("error", "Error");
    appendLog(error instanceof Error ? error.message : "Operation failed", "error");
  } finally {
    refreshButton.disabled = false;
  }
}

async function invokeOperation<TInput, TResult>(
  operationId: string,
  input: TInput,
  listeners: {
    readonly log: (message: string) => void;
    readonly progress: (message: string, percentage?: number) => void;
    readonly result: (result: TResult) => void;
  },
): Promise<void> {
  const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gasboost-Session": sessionToken,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok || response.body === null) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Operation failed with status ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) handleEvent(frame, listeners);
    if (done) break;
  }
}

function handleEvent<TResult>(
  frame: string,
  listeners: {
    readonly log: (message: string) => void;
    readonly progress: (message: string, percentage?: number) => void;
    readonly result: (result: TResult) => void;
  },
): void {
  const event = /^event: (.+)$/m.exec(frame)?.[1];
  const dataText = /^data: (.+)$/m.exec(frame)?.[1];
  if (event === undefined || dataText === undefined) return;
  const data = JSON.parse(dataText) as Record<string, unknown>;

  if (event === "log" && typeof data.message === "string") listeners.log(data.message);
  else if (event === "progress" && typeof data.message === "string") {
    listeners.progress(
      data.message,
      typeof data.percentage === "number" ? data.percentage : undefined,
    );
  } else if (event === "result") listeners.result(data as TResult);
  else if (event === "error") {
    throw new Error(typeof data.message === "string" ? data.message : "Operation failed");
  }
}

function renderProject(project: ProjectState): void {
  required("project-title").textContent = project.name;
  required("project-path").textContent = project.root;
  setCapability("apps-script-status", project.capabilities.appsScript);
  setCapability("firebase-status", project.capabilities.firebaseRealtimeDatabase);
}

function setCapability(id: string, enabled: boolean): void {
  const element = required(id);
  element.textContent = enabled ? "Configured" : "Not configured";
  element.className = `badge ${enabled ? "configured" : "inactive"}`;
}

function setRuntimeStatus(state: string, label: string): void {
  const element = required("runtime-status");
  element.className = `runtime-status ${state}`;
  element.innerHTML = "";
  const dot = document.createElement("span");
  element.append(dot, document.createTextNode(` ${label}`));
}

function appendLog(message: string, type: string): void {
  const row = document.createElement("div");
  row.className = `log-row ${type}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString();
  const text = document.createElement("span");
  text.textContent = message;
  row.append(time, text);
  logElement.append(row);
  logElement.scrollTop = logElement.scrollHeight;
}

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}

function getSessionToken(): string {
  const token = document.querySelector<HTMLMetaElement>(
    'meta[name="gasboost-session"]',
  )?.content;
  if (token === undefined || token.length === 0) {
    throw new Error("Console session was not initialized");
  }
  return token;
}
