import {
  Code2,
  createIcons,
  Database,
  ExternalLink,
  FileCode2,
  LayoutDashboard,
  LogIn,
  Plus,
  RefreshCw,
  Rocket,
  Upload,
  UserRound,
  X,
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

type AppsScriptStatus = {
  readonly authenticated: boolean;
  readonly configured: boolean;
  readonly scriptId?: string;
  readonly rootDir: string;
};

const sessionToken = getSessionToken();
let projectState: ProjectState | undefined;
let appsScriptStatus: AppsScriptStatus | undefined;

createIcons({
  icons: {
    Code2,
    Database,
    ExternalLink,
    FileCode2,
    LayoutDashboard,
    LogIn,
    Plus,
    RefreshCw,
    Rocket,
    Upload,
    UserRound,
    X,
  },
});

const refreshButton = required<HTMLButtonElement>("refresh");
const overviewNav = required<HTMLButtonElement>("overview-nav");
const appsScriptNav = required<HTMLButtonElement>("apps-script-nav");
const overviewLog = required<HTMLDivElement>("log");
const appsLog = required<HTMLDivElement>("apps-log");
const appsLogin = required<HTMLButtonElement>("apps-login");
const appsCreate = required<HTMLButtonElement>("apps-create");
const appsOpen = required<HTMLButtonElement>("apps-open");
const appsPush = required<HTMLButtonElement>("apps-push");

refreshButton.addEventListener("click", () => void inspectProject());
required("clear-log").addEventListener("click", () => overviewLog.replaceChildren());
required("apps-clear-log").addEventListener("click", () => appsLog.replaceChildren());
overviewNav.addEventListener("click", () => showView("overview"));
appsScriptNav.addEventListener("click", () => {
  showView("apps-script");
  void refreshAppsScriptStatus();
});
required("apps-refresh").addEventListener("click", () =>
  void refreshAppsScriptStatus(),
);
appsLogin.addEventListener("click", () =>
  void runAppsOperation("apps.login", {}, renderAppsScriptStatus),
);
appsCreate.addEventListener("click", () => {
  const title = required<HTMLInputElement>("script-title");
  title.value = projectState?.name ?? "";
  required<HTMLDialogElement>("create-dialog").showModal();
  title.focus();
});
appsOpen.addEventListener("click", () =>
  void runAppsOperation("apps.open", {}, () => undefined),
);
appsPush.addEventListener("click", () =>
  required<HTMLDialogElement>("push-dialog").showModal(),
);

required<HTMLFormElement>("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dialog = required<HTMLDialogElement>("create-dialog");
  const title = required<HTMLInputElement>("script-title").value;
  dialog.close();
  void runAppsOperation("apps.create", { title }, renderAppsScriptStatus);
});
required<HTMLFormElement>("push-form").addEventListener("submit", (event) => {
  event.preventDefault();
  required<HTMLDialogElement>("push-dialog").close();
  void runAppsOperation("apps.push", { confirmed: true }, () =>
    void refreshAppsScriptStatus(),
  );
});

for (const closeButton of document.querySelectorAll<HTMLElement>(
  "[data-close-dialog]",
)) {
  closeButton.addEventListener("click", () => {
    const dialogId = closeButton.dataset.closeDialog;
    if (dialogId !== undefined) required<HTMLDialogElement>(dialogId).close();
  });
}

void inspectProject();

async function inspectProject(): Promise<void> {
  refreshButton.disabled = true;
  setRuntimeStatus("running", "Inspecting");
  appendLog(overviewLog, "Inspecting project definition", "info");

  try {
    await invokeOperation<Record<string, never>, ProjectState>(
      "project.inspect",
      {},
      operationListeners(overviewLog, (project) => {
        projectState = project;
        renderProject(project);
      }),
    );
    setRuntimeStatus("ready", "Ready");
  } catch (error) {
    setRuntimeStatus("error", "Error");
    appendError(overviewLog, error);
  } finally {
    refreshButton.disabled = false;
  }
}

async function refreshAppsScriptStatus(): Promise<void> {
  await runAppsOperation("apps.status", {}, renderAppsScriptStatus);
}

async function runAppsOperation<TInput, TResult>(
  operationId: string,
  input: TInput,
  onResult: (result: TResult) => void,
): Promise<void> {
  setAppsActionsDisabled(true);
  setRuntimeStatus("running", "Working");

  try {
    await invokeOperation(
      operationId,
      input,
      operationListeners(appsLog, onResult),
    );
    setRuntimeStatus("ready", "Ready");
  } catch (error) {
    setRuntimeStatus("error", "Error");
    appendError(appsLog, error);
  } finally {
    setAppsActionsDisabled(false);
  }
}

function operationListeners<TResult>(
  log: HTMLElement,
  result: (value: TResult) => void,
): {
  readonly log: (message: string) => void;
  readonly progress: (message: string, percentage?: number) => void;
  readonly result: (value: TResult) => void;
} {
  return {
    log: (message) => appendLog(log, message, "info"),
    progress: (message, percentage) =>
      appendLog(
        log,
        percentage === undefined ? message : `${message} (${percentage}%)`,
        "progress",
      ),
    result,
  };
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
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
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

  if (event === "log" && typeof data.message === "string") {
    listeners.log(data.message);
  } else if (event === "progress" && typeof data.message === "string") {
    listeners.progress(
      data.message,
      typeof data.percentage === "number" ? data.percentage : undefined,
    );
  } else if (event === "result") {
    listeners.result(data as TResult);
  } else if (event === "error") {
    throw new Error(
      typeof data.message === "string" ? data.message : "Operation failed",
    );
  }
}

function renderProject(project: ProjectState): void {
  required("project-title").textContent = project.name;
  required("project-path").textContent = project.root;
  setCapability("apps-script-status", project.capabilities.appsScript);
  setCapability("firebase-status", project.capabilities.firebaseRealtimeDatabase);
  appsScriptNav.disabled = !project.capabilities.appsScript;
}

function renderAppsScriptStatus(status: AppsScriptStatus): void {
  appsScriptStatus = status;
  setStatusBadge("apps-auth-status", status.authenticated, "Authorized", "Sign in required");
  setStatusBadge("apps-project-status", status.configured, "Connected", "Not created");
  required("apps-account-detail").textContent = status.authenticated
    ? "clasp authorization available"
    : "No clasp authorization found";
  required("apps-project-detail").textContent = status.configured
    ? `${status.scriptId ?? "Connected"} · ${status.rootDir}`
    : `Local source: ${status.rootDir}`;
  updateAppsActions();
}

function showView(view: "overview" | "apps-script"): void {
  required("overview-view").hidden = view !== "overview";
  required("apps-script-view").hidden = view !== "apps-script";
  overviewNav.classList.toggle("active", view === "overview");
  appsScriptNav.classList.toggle("active", view === "apps-script");
}

function setAppsActionsDisabled(busy: boolean): void {
  if (busy) {
    for (const button of [appsLogin, appsCreate, appsOpen, appsPush]) {
      button.disabled = true;
    }
  } else {
    updateAppsActions();
  }
}

function updateAppsActions(): void {
  const authenticated = appsScriptStatus?.authenticated === true;
  const configured = appsScriptStatus?.configured === true;
  appsLogin.disabled = authenticated;
  appsCreate.disabled = !authenticated || configured;
  appsOpen.disabled = !authenticated || !configured;
  appsPush.disabled = !authenticated || !configured;
}

function setCapability(id: string, enabled: boolean): void {
  setStatusBadge(id, enabled, "Configured", "Not configured");
}

function setStatusBadge(
  id: string,
  enabled: boolean,
  enabledLabel: string,
  disabledLabel: string,
): void {
  const element = required(id);
  element.textContent = enabled ? enabledLabel : disabledLabel;
  element.className = `badge ${enabled ? "configured" : "inactive"}`;
}

function setRuntimeStatus(state: string, label: string): void {
  const element = required("runtime-status");
  element.className = `runtime-status ${state}`;
  element.innerHTML = "";
  const dot = document.createElement("span");
  element.append(dot, document.createTextNode(` ${label}`));
}

function appendLog(target: HTMLElement, message: string, type: string): void {
  const row = document.createElement("div");
  row.className = `log-row ${type}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString();
  const text = document.createElement("span");
  text.textContent = message;
  row.append(time, text);
  target.append(row);
  target.scrollTop = target.scrollHeight;
}

function appendError(target: HTMLElement, error: unknown): void {
  appendLog(
    target,
    error instanceof Error ? error.message : "Operation failed",
    "error",
  );
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
