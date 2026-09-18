import {
  Code2,
  createIcons,
  Database,
  ExternalLink,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Square,
  Upload,
  UserRound,
  X,
} from "lucide";
import "./style.css";

type View = "overview" | "development" | "apps-script" | "deployment" | "firebase";

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
  readonly manifestExists: boolean;
  readonly desired: boolean;
  readonly deploymentId?: string;
};

type FirebaseStatus = {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly projectId?: string;
  readonly realtimeDatabaseDesired: boolean;
  readonly firebaseJson: boolean;
  readonly firebaserc: boolean;
};

const sessionToken = getSessionToken();
let projectState: ProjectState | undefined;
let appsScriptStatus: AppsScriptStatus | undefined;
let firebaseStatus: FirebaseStatus | undefined;
let appsSetupMode: "new" | "existing" = "existing";

createIcons({
  icons: {
    Code2,
    Database,
    ExternalLink,
    FileCode2,
    KeyRound,
    LayoutDashboard,
    LogIn,
    Play,
    Plus,
    RefreshCw,
    Rocket,
    Square,
    Upload,
    UserRound,
    X,
  },
});

const refreshButton = required<HTMLButtonElement>("refresh");
const overviewLog = required<HTMLDivElement>("log");
const appsLog = required<HTMLDivElement>("apps-log");
const deploymentLog = required<HTMLDivElement>("deployment-log");
const firebaseLog = required<HTMLDivElement>("firebase-log");
const devLog = required<HTMLDivElement>("development-log");

const navButtons = {
  overview: required<HTMLButtonElement>("overview-nav"),
  development: required<HTMLButtonElement>("development-nav"),
  "apps-script": required<HTMLButtonElement>("apps-script-nav"),
  deployment: required<HTMLButtonElement>("deployment-nav"),
  firebase: required<HTMLButtonElement>("firebase-nav"),
} satisfies Record<View, HTMLButtonElement>;

const appsLogin = required<HTMLButtonElement>("apps-login");
const appsCreate = required<HTMLButtonElement>("apps-create");
const appsConnect = required<HTMLButtonElement>("apps-connect");
const appsUserSettings = required<HTMLButtonElement>("apps-user-settings");
const appsOpen = required<HTMLButtonElement>("apps-open");
const appsPush = required<HTMLButtonElement>("apps-push");
const appsPull = required<HTMLButtonElement>("apps-pull");
const credentialRegister = required<HTMLButtonElement>("credential-register");

const deploymentList = required<HTMLButtonElement>("deployment-list");
const deploymentCreate = required<HTMLButtonElement>("deployment-create");
const deploymentUpdate = required<HTMLButtonElement>("deployment-update");
const deploymentOpen = required<HTMLButtonElement>("deployment-open");

const firebaseEnable = required<HTMLButtonElement>("firebase-enable");
const firebaseLogin = required<HTMLButtonElement>("firebase-login");
const firebaseConnect = required<HTMLButtonElement>("firebase-connect");
const firebaseRulesDeploy = required<HTMLButtonElement>("firebase-rules-deploy");
const firebaseOpen = required<HTMLButtonElement>("firebase-open");

refreshButton.addEventListener("click", () => void refreshAll());
required("clear-log").addEventListener("click", () => overviewLog.replaceChildren());
required("apps-clear-log").addEventListener("click", () => appsLog.replaceChildren());
required("deployment-clear-log").addEventListener("click", () => deploymentLog.replaceChildren());
required("firebase-clear-log").addEventListener("click", () => firebaseLog.replaceChildren());
required("development-clear-log").addEventListener("click", () => devLog.replaceChildren());

for (const [view, button] of Object.entries(navButtons) as [View, HTMLButtonElement][]) {
  button.addEventListener("click", () => {
    showView(view);
    if (view === "apps-script") void refreshAppsScriptStatus();
    if (view === "deployment") void refreshAppsScriptStatus();
    if (view === "firebase") void refreshFirebaseStatus();
  });
}

required("apps-refresh").addEventListener("click", () => void refreshAppsScriptStatus());
required("deployment-refresh").addEventListener("click", () => void refreshAppsScriptStatus());
required("firebase-refresh").addEventListener("click", () => void refreshFirebaseStatus());

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-setup-mode]")) {
  button.addEventListener("click", () => {
    appsSetupMode = button.dataset.setupMode === "new" ? "new" : "existing";
    renderAppsSetupMode();
  });
}

appsLogin.addEventListener("click", () =>
  void runOperation("apps.login", {}, appsLog, renderAppsScriptStatus),
);
appsUserSettings.addEventListener("click", () =>
  window.open("https://script.google.com/home/usersettings", "_blank", "noopener"),
);
appsCreate.addEventListener("click", () => {
  const title = required<HTMLInputElement>("script-title");
  title.value = projectState?.name ?? "";
  required<HTMLDialogElement>("create-dialog").showModal();
  title.focus();
});
appsConnect.addEventListener("click", () => {
  const scriptId = required<HTMLInputElement>("script-id").value.trim();
  void runOperation("apps.connect", { scriptId }, appsLog, renderAppsScriptStatus);
});
appsOpen.addEventListener("click", () =>
  void runOperation("apps.open", {}, appsLog, () => undefined),
);
appsPush.addEventListener("click", () =>
  required<HTMLDialogElement>("push-dialog").showModal(),
);
appsPull.addEventListener("click", () =>
  appendLog(appsLog, "Pull is reserved for a follow-up operation.", "info"),
);
credentialRegister.addEventListener("click", () =>
  required<HTMLDialogElement>("credential-dialog").showModal(),
);

deploymentList.addEventListener("click", () =>
  void runOperation(
    "apps.deployments",
    {},
    deploymentLog,
    (result: { deployments: readonly { deploymentId: string; description?: string }[] }) => {
      const summary =
        result.deployments.length === 0
          ? "No deployments returned"
          : result.deployments
              .map((deployment) => `${deployment.deploymentId}${deployment.description === undefined ? "" : ` (${deployment.description})`}`)
              .join(", ");
      appendLog(deploymentLog, summary, "info");
    },
  ),
);
deploymentCreate.addEventListener("click", () =>
  required<HTMLDialogElement>("deployment-dialog").showModal(),
);
deploymentUpdate.addEventListener("click", () =>
  void runOperation(
    "apps.deployment.update",
    { deploymentId: required<HTMLInputElement>("deployment-id").value.trim() || undefined },
    deploymentLog,
    () => void refreshAppsScriptStatus(),
  ),
);
deploymentOpen.addEventListener("click", () => {
  const id = appsScriptStatus?.deploymentId ?? required<HTMLInputElement>("deployment-id").value.trim();
  if (id.length > 0) window.open(`https://script.google.com/macros/s/${id}/exec`, "_blank", "noopener");
});

firebaseEnable.addEventListener("click", () =>
  void runOperation("firebase.enable", {}, firebaseLog, renderFirebaseStatus),
);
firebaseLogin.addEventListener("click", () =>
  void runOperation("firebase.login", {}, firebaseLog, renderFirebaseStatus),
);
firebaseConnect.addEventListener("click", () => {
  const projectId = required<HTMLInputElement>("firebase-project-id").value.trim();
  void runOperation("firebase.connect", { projectId }, firebaseLog, renderFirebaseStatus);
});
firebaseRulesDeploy.addEventListener("click", () =>
  void runOperation("firebase.rules.deploy", {}, firebaseLog, () => void refreshFirebaseStatus()),
);
firebaseOpen.addEventListener("click", () =>
  window.open("https://console.firebase.google.com/", "_blank", "noopener"),
);

required<HTMLFormElement>("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dialog = required<HTMLDialogElement>("create-dialog");
  const title = required<HTMLInputElement>("script-title").value;
  dialog.close();
  void runOperation("apps.create", { title }, appsLog, renderAppsScriptStatus);
});
required<HTMLFormElement>("push-form").addEventListener("submit", (event) => {
  event.preventDefault();
  required<HTMLDialogElement>("push-dialog").close();
  void runOperation("apps.push", { confirmed: true }, appsLog, () =>
    void refreshAppsScriptStatus(),
  );
});
required<HTMLFormElement>("deployment-form").addEventListener("submit", (event) => {
  event.preventDefault();
  required<HTMLDialogElement>("deployment-dialog").close();
  void runOperation(
    "apps.deployment.create",
    { description: required<HTMLInputElement>("deployment-description").value.trim() || undefined },
    deploymentLog,
    () => void refreshAppsScriptStatus(),
  );
});
required<HTMLFormElement>("credential-form").addEventListener("submit", (event) => {
  event.preventDefault();
  required<HTMLDialogElement>("credential-dialog").close();
  void runOperation(
    "apps.credentials.register",
    {
      clientEmail: required<HTMLInputElement>("credential-client-email").value.trim(),
      privateKey: required<HTMLTextAreaElement>("credential-private-key").value,
    },
    appsLog,
    () => appendLog(appsLog, "Script Properties updated", "progress"),
  );
});

for (const closeButton of document.querySelectorAll<HTMLElement>("[data-close-dialog]")) {
  closeButton.addEventListener("click", () => {
    const dialogId = closeButton.dataset.closeDialog;
    if (dialogId !== undefined) required<HTMLDialogElement>(dialogId).close();
  });
}

void refreshAll();

async function refreshAll(): Promise<void> {
  await inspectProject();
  await Promise.all([refreshAppsScriptStatus(), refreshFirebaseStatus()]);
}

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
  await runOperation("apps.status", {}, appsLog, renderAppsScriptStatus);
}

async function refreshFirebaseStatus(): Promise<void> {
  await runOperation("firebase.status", {}, firebaseLog, renderFirebaseStatus);
}

async function runOperation<TInput, TResult>(
  operationId: string,
  input: TInput,
  log: HTMLElement,
  onResult: (result: TResult) => void,
): Promise<void> {
  setActionsDisabled(true);
  setRuntimeStatus("running", "Working");

  try {
    await invokeOperation(operationId, input, operationListeners(log, onResult));
    setRuntimeStatus("ready", "Ready");
  } catch (error) {
    setRuntimeStatus("error", "Error");
    appendError(log, error);
  } finally {
    setActionsDisabled(false);
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
    throw new Error(typeof data.message === "string" ? data.message : "Operation failed");
  }
}

function renderProject(project: ProjectState): void {
  required("project-title").textContent = project.name;
  required("project-path").textContent = project.root;
  setCapability("apps-script-status", project.capabilities.appsScript);
  setCapability("firebase-status", project.capabilities.firebaseRealtimeDatabase);
}

function renderAppsScriptStatus(status: AppsScriptStatus): void {
  appsScriptStatus = status;
  setStatusBadge("apps-auth-status", status.authenticated, "Authorized", "Sign in required");
  setStatusBadge("apps-project-status", status.configured, "Connected", "Not initialized");
  setStatusBadge("apps-manifest-status", status.manifestExists, "Found", "Missing");
  setStatusBadge("deployment-project-status", status.configured, "Ready", "Prerequisite");
  required("apps-account-detail").textContent = status.authenticated
    ? "clasp authorization available"
    : "No clasp authorization found";
  required("apps-project-detail").textContent = status.configured
    ? `${status.scriptId ?? "Connected"} · ${status.rootDir}`
    : `Local source: ${status.rootDir}`;
  required("apps-manifest-detail").textContent = status.manifestExists
    ? "appsscript.json exists in project root"
    : "Manifest was not detected at project root";
  required("deployment-project-detail").textContent = status.configured
    ? `Script ID: ${status.scriptId ?? "connected"}`
    : "Create or connect an Apps Script project first";
  required<HTMLInputElement>("deployment-id").value = status.deploymentId ?? "";
  setStatusBadge("deployment-id-status", status.deploymentId !== undefined, "Selected", "Not selected");
  required("deployment-id-detail").textContent =
    status.deploymentId === undefined ? "No deployment synced to .env" : status.deploymentId;
  renderAppsSetupMode();
  updateActions();
}

function renderFirebaseStatus(status: FirebaseStatus): void {
  firebaseStatus = status;
  setStatusBadge("firebase-enabled-status", status.enabled, "Enabled", "Not enabled");
  setStatusBadge("firebase-auth-status", status.authenticated, "Authorized", "Sign in required");
  setStatusBadge("firebase-project-status", status.configured, "Connected", "Not connected");
  required("firebase-enabled-detail").textContent = status.enabled
    ? "Local Firebase configuration detected"
    : "Enable Firebase to create local configuration";
  required("firebase-auth-detail").textContent = status.authenticated
    ? "Firebase CLI authorization available"
    : "No Firebase CLI authorization found";
  required("firebase-project-detail").textContent =
    status.projectId === undefined ? "No project ID synced to .env" : status.projectId;
  required<HTMLInputElement>("firebase-project-id").value = status.projectId ?? "";
  updateActions();
}

function renderAppsSetupMode(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-setup-mode]")) {
    button.classList.toggle("setup-mode__button--active", button.dataset.setupMode === appsSetupMode);
  }
  required("apps-create-panel").hidden = appsSetupMode !== "new";
  required("apps-connect-panel").hidden = appsSetupMode !== "existing";
}

function showView(view: View): void {
  for (const key of Object.keys(navButtons) as View[]) {
    required(`${key}-view`).hidden = key !== view;
    navButtons[key].classList.toggle("active", key === view);
  }
}

function setActionsDisabled(busy: boolean): void {
  if (busy) {
    for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
      if (!button.classList.contains("nav-item")) button.disabled = true;
    }
  } else {
    updateActions();
  }
}

function updateActions(): void {
  const authenticated = appsScriptStatus?.authenticated === true;
  const configured = appsScriptStatus?.configured === true;
  appsLogin.disabled = authenticated;
  appsCreate.disabled = !authenticated || configured;
  appsConnect.disabled = !authenticated || configured;
  appsOpen.disabled = !authenticated || !configured;
  appsPush.disabled = !authenticated || !configured;
  appsPull.disabled = !authenticated || !configured;
  credentialRegister.disabled = !configured || firebaseStatus?.configured !== true;
  deploymentList.disabled = !authenticated || !configured;
  deploymentCreate.disabled = !authenticated || !configured;
  deploymentUpdate.disabled = !authenticated || !configured;
  deploymentOpen.disabled = (appsScriptStatus?.deploymentId ?? required<HTMLInputElement>("deployment-id").value).length === 0;
  firebaseLogin.disabled = firebaseStatus?.authenticated === true;
  firebaseEnable.disabled = firebaseStatus?.enabled === true;
  firebaseConnect.disabled = false;
  firebaseRulesDeploy.disabled = firebaseStatus?.configured !== true;
  firebaseOpen.disabled = false;
  refreshButton.disabled = false;
  for (const button of Object.values(navButtons)) button.disabled = false;
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
  appendLog(target, error instanceof Error ? error.message : "Operation failed", "error");
}

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}

function getSessionToken(): string {
  const token = document.querySelector<HTMLMetaElement>('meta[name="gasboost-session"]')?.content;
  if (token === undefined || token.length === 0) {
    throw new Error("Console session was not initialized");
  }
  return token;
}
