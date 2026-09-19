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
import { installDialogControls } from "./dialogControls";
import { deployedWebAppUrl, syncDeploymentOpenAction } from "./deploymentOpenAction";
import {
  installFirebaseProjectActionRefresh,
  syncFirebaseProjectActions,
} from "./firebaseProjectActions";
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
  readonly deploymentConfiguration: DeploymentConfiguration;
  readonly deploymentConfigurationSource: "manifest" | "default";
  readonly desired: boolean;
  readonly deploymentId?: string;
};

type DeploymentConfiguration =
  | {
      readonly type: "webapp";
      readonly access: DeploymentAccess;
      readonly executeAs: WebAppExecuteAs;
    }
  | {
      readonly type: "executionApi";
      readonly access: DeploymentAccess;
    };
type DeploymentAccess = "MYSELF" | "DOMAIN" | "ANYONE" | "ANYONE_ANONYMOUS";
type WebAppExecuteAs = "USER_ACCESSING" | "USER_DEPLOYING";

type FirebaseStatus = {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly projectId?: string;
  readonly projectIdPresent: boolean;
  readonly remoteProjectVerified: boolean;
  readonly webApp: {
    readonly configured: boolean;
    readonly appId?: string;
    readonly displayName?: string;
    readonly sdkConfigAvailable: boolean;
  };
  readonly realtimeDatabase: {
    readonly desired: boolean;
    readonly initialized: boolean;
    readonly databaseUrl?: string;
  };
  readonly realtimeDatabaseDesired: boolean;
  readonly rulesSourceConfigured: boolean;
  readonly rulesGenerated: boolean;
  readonly firebaseJson: boolean;
  readonly firebaserc: boolean;
};

type DevelopmentStatus = {
  readonly running: boolean;
  readonly localUrl?: string;
  readonly command?: readonly string[];
  readonly log: readonly string[];
};

const sessionToken = getSessionToken();
let projectState: ProjectState | undefined;
let appsScriptStatus: AppsScriptStatus | undefined;
let firebaseStatus: FirebaseStatus | undefined;
let developmentStatus: DevelopmentStatus | undefined;
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
const credentialServiceAccount = required<HTMLButtonElement>("credential-service-account");
const credentialScriptProperties = required<HTMLButtonElement>("credential-script-properties");
const credentialCopyEmail = required<HTMLButtonElement>("credential-copy-email");
const credentialCopyPrivateKey = required<HTMLButtonElement>("credential-copy-private-key");

const deploymentList = required<HTMLButtonElement>("deployment-list");
const deploymentCreate = required<HTMLButtonElement>("deployment-create");
const deploymentUpdate = required<HTMLButtonElement>("deployment-update");
const deploymentOpen = required<HTMLButtonElement>("deployment-open");
const deploymentType = required<HTMLSelectElement>("deployment-type");
const deploymentAccess = required<HTMLSelectElement>("deployment-access");
const deploymentExecuteAs = required<HTMLSelectElement>("deployment-execute-as");
const deploymentExecuteAsField = required<HTMLElement>("deployment-execute-as-field");

const developmentStart = required<HTMLButtonElement>("development-start");
const developmentStop = required<HTMLButtonElement>("development-stop");
const developmentRestart = required<HTMLButtonElement>("development-restart");
const developmentOpen = required<HTMLButtonElement>("development-open");

const firebaseEnable = required<HTMLButtonElement>("firebase-enable");
const firebaseLogin = required<HTMLButtonElement>("firebase-login");
const firebaseProjectId = required<HTMLInputElement>("firebase-project-id");
const firebaseProjectCreate = required<HTMLButtonElement>("firebase-project-create");
const firebaseConnect = required<HTMLButtonElement>("firebase-connect");
const firebaseWebAppCreate = required<HTMLButtonElement>("firebase-webapp-create");
const firebaseWebAppConfig = required<HTMLButtonElement>("firebase-webapp-config");
const firebaseRtdbInitialize = required<HTMLButtonElement>("firebase-rtdb-initialize");
const firebaseRulesGenerate = required<HTMLButtonElement>("firebase-rules-generate");
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
    if (view === "development") void refreshDevelopmentStatus();
    if (view === "apps-script") void refreshAppsScriptStatus();
    if (view === "deployment") void refreshAppsScriptStatus();
    if (view === "firebase") void refreshFirebaseStatus();
  });
}

required("apps-refresh").addEventListener("click", () => void refreshAppsScriptStatus());
required("development-refresh").addEventListener("click", () => void refreshDevelopmentStatus());
required("deployment-refresh").addEventListener("click", () => void refreshAppsScriptStatus());
required("firebase-refresh").addEventListener("click", () => void refreshFirebaseStatus());

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-setup-mode]")) {
  button.addEventListener("click", () => {
    appsSetupMode = button.dataset.setupMode === "new" ? "new" : "existing";
    renderAppsSetupMode();
  });
}

appsLogin.addEventListener("click", () =>
  void runOperation("apps.login", {}, appsLog, renderAppsScriptStatus, [appsLogin]),
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
  void runOperation("apps.connect", { scriptId }, appsLog, renderAppsScriptStatus, [appsConnect]);
});
appsOpen.addEventListener("click", () =>
  void runOperation("apps.open", {}, appsLog, () => undefined, [appsOpen]),
);
appsPush.addEventListener("click", () =>
  required<HTMLDialogElement>("push-dialog").showModal(),
);
appsPull.addEventListener("click", () =>
  appendLog(appsLog, "Pull is reserved for a follow-up operation.", "info"),
);
credentialServiceAccount.addEventListener("click", () => {
  const projectId = firebaseStatus?.projectId;
  if (projectId === undefined) return;
  window.open(
    `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/settings/serviceaccounts/adminsdk`,
    "_blank",
    "noopener",
  );
});
credentialScriptProperties.addEventListener("click", () => {
  const scriptId = appsScriptStatus?.scriptId;
  if (scriptId === undefined) return;
  window.open(
    `https://script.google.com/home/projects/${encodeURIComponent(scriptId)}/settings`,
    "_blank",
    "noopener",
  );
});
credentialCopyEmail.addEventListener("click", () =>
  void copyCredentialKey("FIREBASE_SERVICE_ACCOUNT_EMAIL"),
);
credentialCopyPrivateKey.addEventListener("click", () =>
  void copyCredentialKey("FIREBASE_PRIVATE_KEY"),
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
    [deploymentList],
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
    [deploymentUpdate],
  ),
);
deploymentOpen.addEventListener("click", () => {
  const id = appsScriptStatus?.deploymentId ?? required<HTMLInputElement>("deployment-id").value.trim();
  const url = deployedWebAppUrl(openDeploymentType(), id);
  if (url !== undefined) window.open(url, "_blank", "noopener");
});
deploymentType.addEventListener("change", () => {
  updateActions();
  void saveDeploymentConfiguration();
});
deploymentAccess.addEventListener("change", () => void saveDeploymentConfiguration());
deploymentExecuteAs.addEventListener("change", () => void saveDeploymentConfiguration());

firebaseEnable.addEventListener("click", () =>
  void runOperation("firebase.enable", {}, firebaseLog, renderFirebaseStatus, [firebaseEnable]),
);
firebaseLogin.addEventListener("click", () =>
  void runOperation("firebase.login", {}, firebaseLog, renderFirebaseStatus, [firebaseLogin]),
);
installFirebaseProjectActionRefresh(firebaseProjectId, updateActions);
firebaseProjectCreate.addEventListener("click", () => {
  const projectId = firebaseProjectId.value.trim();
  void runOperation("firebase.project.create", { projectId }, firebaseLog, renderFirebaseStatus, [firebaseProjectCreate]);
});
firebaseConnect.addEventListener("click", () => {
  const projectId = firebaseProjectId.value.trim();
  void runOperation("firebase.project.connect", { projectId }, firebaseLog, renderFirebaseStatus, [firebaseConnect]);
});
firebaseWebAppCreate.addEventListener("click", () => {
  const displayName = required<HTMLInputElement>("firebase-webapp-name").value.trim() || undefined;
  void runOperation("firebase.webapp.create", { displayName }, firebaseLog, renderFirebaseStatus, [firebaseWebAppCreate]);
});
firebaseWebAppConfig.addEventListener("click", () =>
  void runOperation("firebase.webapp.config", {}, firebaseLog, () => void refreshFirebaseStatus(), [firebaseWebAppConfig]),
);
firebaseRtdbInitialize.addEventListener("click", () => {
  const location = required<HTMLInputElement>("firebase-rtdb-location").value.trim() || "us-central1";
  void runOperation("firebase.rtdb.initialize", { location }, firebaseLog, renderFirebaseStatus, [firebaseRtdbInitialize]);
});
firebaseRulesGenerate.addEventListener("click", () =>
  void runOperation("firebase.rules.generate", {}, firebaseLog, () => void refreshFirebaseStatus(), [firebaseRulesGenerate]),
);
firebaseRulesDeploy.addEventListener("click", () =>
  void runOperation("firebase.rules.deploy", {}, firebaseLog, () => void refreshFirebaseStatus(), [firebaseRulesDeploy]),
);
firebaseOpen.addEventListener("click", () =>
  window.open("https://console.firebase.google.com/", "_blank", "noopener"),
);

required<HTMLFormElement>("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dialog = required<HTMLDialogElement>("create-dialog");
  const title = required<HTMLInputElement>("script-title").value;
  dialog.close();
  void runOperation("apps.create", { title }, appsLog, renderAppsScriptStatus, [appsCreate]);
});
required<HTMLFormElement>("push-form").addEventListener("submit", (event) => {
  event.preventDefault();
  required<HTMLDialogElement>("push-dialog").close();
  void runOperation("apps.push", { confirmed: true }, appsLog, () =>
    void refreshAppsScriptStatus(),
    [appsPush],
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
    [deploymentCreate],
  );
});
installDialogControls();

developmentStart.addEventListener("click", () =>
  void runOperation("development.start", {}, devLog, renderDevelopmentStatus, [developmentStart, developmentRestart]),
);
developmentStop.addEventListener("click", () =>
  void runOperation("development.stop", {}, devLog, renderDevelopmentStatus, [developmentStop, developmentRestart]),
);
developmentRestart.addEventListener("click", () =>
  void runOperation("development.restart", {}, devLog, renderDevelopmentStatus, [developmentStart, developmentStop, developmentRestart]),
);
developmentOpen.addEventListener("click", () =>
  void runOperation("development.open", {}, devLog, renderDevelopmentStatus, [developmentOpen]),
);

void refreshAll();

async function refreshAll(): Promise<void> {
  await inspectProject();
  await Promise.all([refreshDevelopmentStatus(), refreshAppsScriptStatus(), refreshFirebaseStatus()]);
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
  await runOperation("apps.status", {}, appsLog, renderAppsScriptStatus, [required<HTMLButtonElement>("apps-refresh")]);
}

async function refreshFirebaseStatus(): Promise<void> {
  await runOperation("firebase.status", {}, firebaseLog, renderFirebaseStatus, [required<HTMLButtonElement>("firebase-refresh")]);
}

async function refreshDevelopmentStatus(): Promise<void> {
  await runOperation("development.status", {}, devLog, renderDevelopmentStatus, [required<HTMLButtonElement>("development-refresh")]);
}

async function runOperation<TInput, TResult>(
  operationId: string,
  input: TInput,
  log: HTMLElement,
  onResult: (result: TResult) => void,
  controls: readonly FormControl[] = [],
): Promise<void> {
  setControlsDisabled(controls, true);
  setRuntimeStatus("running", "Working");

  try {
    await invokeOperation(operationId, input, operationListeners(log, onResult));
    setRuntimeStatus("ready", "Ready");
  } catch (error) {
    setRuntimeStatus("error", "Error");
    appendError(log, error);
  } finally {
    setControlsDisabled(controls, false);
    updateActions();
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
  setStatusBadge(
    "deployment-manifest-status",
    status.deploymentConfigurationSource === "manifest",
    "Saved",
    "Default",
  );
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
  required("deployment-manifest-detail").textContent =
    status.deploymentConfigurationSource === "manifest"
      ? "Deployment configuration is loaded from appsscript.json"
      : "Using initial defaults until saved to appsscript.json";
  required<HTMLInputElement>("deployment-id").value = status.deploymentId ?? "";
  setStatusBadge("deployment-id-status", status.deploymentId !== undefined, "Selected", "Not selected");
  required("deployment-id-detail").textContent =
    status.deploymentId === undefined ? "No deployment synced to .env" : status.deploymentId;
  renderDeploymentConfiguration(status.deploymentConfiguration);
  renderAppsSetupMode();
  updateActions();
}

function renderFirebaseStatus(status: FirebaseStatus): void {
  firebaseStatus = status;
  setStatusBadge("firebase-enabled-status", status.enabled, "Enabled", "Not enabled");
  setStatusBadge("firebase-auth-status", status.authenticated, "Authorized", "Sign in required");
  setStatusBadge("firebase-project-status", status.remoteProjectVerified, "Verified", "Not verified");
  setStatusBadge("firebase-webapp-status", status.webApp.configured, "Configured", "Not configured");
  setStatusBadge("firebase-rtdb-status", status.realtimeDatabase.initialized, "Initialized", "Not initialized");
  setStatusBadge("firebase-rules-status", status.rulesGenerated, "Generated", "Not generated");
  required("firebase-enabled-detail").textContent = status.enabled
    ? "Local Firebase configuration detected"
    : "Enable Firebase to create local configuration";
  required("firebase-auth-detail").textContent = status.authenticated
    ? "Firebase CLI authorization available"
    : "No Firebase CLI authorization found";
  required("firebase-project-detail").textContent =
    status.projectId === undefined
      ? "No project ID synced to .env"
      : `${status.projectId}${status.remoteProjectVerified ? "" : " · remote verification pending"}`;
  required("firebase-webapp-detail").textContent =
    status.webApp.appId ??
    (status.webApp.sdkConfigAvailable ? "SDK config synced to .env" : "No Web App detected");
  required("firebase-rtdb-detail").textContent =
    status.realtimeDatabase.databaseUrl ??
    (status.realtimeDatabase.desired ? "Realtime capability desired" : "Realtime capability not configured");
  required("firebase-rules-detail").textContent = status.rulesSourceConfigured
    ? status.rulesGenerated
      ? "database.rules.json is ready"
      : "Generate rules before deploy"
    : "No RTDB rules source configured";
  firebaseProjectId.value = status.projectId ?? "";
  required<HTMLInputElement>("firebase-webapp-name").value = status.webApp.displayName ?? "";
  updateActions();
}

function renderDevelopmentStatus(status: DevelopmentStatus): void {
  developmentStatus = status;
  setStatusBadge("development-state-status", status.running, "Running", "Stopped");
  required("development-state-detail").textContent =
    status.command === undefined ? "No dev process launched by console" : status.command.join(" ");
  setStatusBadge("development-url-status", status.localUrl !== undefined, "Available", "Pending");
  required("development-url-detail").textContent = status.localUrl ?? "Start the local application to detect a URL";
  devLog.replaceChildren();
  for (const line of status.log) appendLog(devLog, line, "info");
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

type FormControl = HTMLButtonElement | HTMLSelectElement | HTMLInputElement;

function setControlsDisabled(controls: readonly FormControl[], disabled: boolean): void {
  for (const control of controls) control.disabled = disabled;
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
  credentialServiceAccount.disabled = firebaseStatus?.projectId === undefined;
  credentialScriptProperties.disabled = appsScriptStatus?.scriptId === undefined;
  deploymentList.disabled = !authenticated || !configured;
  deploymentCreate.disabled = !authenticated || !configured;
  deploymentUpdate.disabled = !authenticated || !configured;
  syncDeploymentOpenAction(
    openDeploymentType(),
    appsScriptStatus?.deploymentId ?? required<HTMLInputElement>("deployment-id").value,
    deploymentOpen,
  );
  deploymentType.disabled = appsScriptStatus === undefined;
  deploymentAccess.disabled = appsScriptStatus === undefined;
  deploymentExecuteAs.disabled = appsScriptStatus === undefined || deploymentType.value !== "webapp";
  developmentStart.disabled = developmentStatus?.running === true;
  developmentStop.disabled = developmentStatus?.running !== true;
  developmentRestart.disabled = developmentStatus?.running !== true;
  developmentOpen.disabled = developmentStatus?.running !== true || developmentStatus.localUrl === undefined;
  firebaseLogin.disabled = firebaseStatus?.authenticated === true;
  firebaseEnable.disabled = firebaseStatus?.enabled === true;
  const firebaseRemoteProject = firebaseStatus?.remoteProjectVerified === true;
  syncFirebaseProjectActions(firebaseStatus, firebaseProjectId, firebaseProjectCreate, firebaseConnect);
  firebaseWebAppCreate.disabled = !firebaseRemoteProject || firebaseStatus?.webApp.configured === true;
  firebaseWebAppConfig.disabled = !firebaseRemoteProject || firebaseStatus?.webApp.configured !== true;
  firebaseRtdbInitialize.disabled =
    !firebaseRemoteProject ||
    firebaseStatus?.realtimeDatabase.desired !== true ||
    firebaseStatus?.realtimeDatabase.initialized === true;
  firebaseRulesGenerate.disabled = firebaseStatus?.rulesSourceConfigured !== true;
  firebaseRulesDeploy.disabled = !firebaseRemoteProject || firebaseStatus?.rulesGenerated !== true;
  firebaseOpen.disabled = false;
  refreshButton.disabled = false;
  for (const button of Object.values(navButtons)) button.disabled = false;
}

function openDeploymentType(): "webapp" | "executionApi" {
  return deploymentType.value === "webapp" &&
    appsScriptStatus?.deploymentConfiguration.type === "webapp"
    ? "webapp"
    : "executionApi";
}

function renderDeploymentConfiguration(configuration: DeploymentConfiguration): void {
  deploymentType.value = configuration.type;
  deploymentAccess.value = configuration.access;
  deploymentExecuteAsField.hidden = configuration.type !== "webapp";
  deploymentExecuteAs.value =
    configuration.type === "webapp" ? configuration.executeAs : "USER_DEPLOYING";
}

async function saveDeploymentConfiguration(): Promise<void> {
  const configuration =
    deploymentType.value === "executionApi"
      ? {
          type: "executionApi" as const,
          access: deploymentAccess.value as DeploymentAccess,
        }
      : {
          type: "webapp" as const,
          access: deploymentAccess.value as DeploymentAccess,
          executeAs: deploymentExecuteAs.value as WebAppExecuteAs,
        };
  renderDeploymentConfiguration(configuration);

  await runOperation(
    "apps.deployment.configuration.update",
    configuration,
    deploymentLog,
    (result: { status: AppsScriptStatus }) => {
      renderAppsScriptStatus(result.status);
      appendLog(deploymentLog, "Saved deployment configuration to appsscript.json", "info");
    },
    [deploymentType, deploymentAccess, deploymentExecuteAs],
  );
}

async function copyCredentialKey(key: string): Promise<void> {
  await navigator.clipboard.writeText(key);
  appendLog(appsLog, `Copied ${key}`, "info");
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
