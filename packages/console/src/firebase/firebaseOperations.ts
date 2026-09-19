import {
  loadGasboostConfig,
  ModuleLoader,
  RtdbRulesGenerator,
  RtdbRulesWriter,
  type NormalizedGasboostConfig,
} from "@gasboost/config";
import type { OperationDefinition } from "@gasboost/console-runtime";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { EnvFileRepository } from "../env/EnvFileRepository.js";
import { FirebaseProjectRepository } from "./FirebaseProjectRepository.js";
import type { FirebaseResult, FirebaseRunner } from "./FirebaseRunner.js";

export type FirebaseWebAppStatus = {
  readonly configured: boolean;
  readonly appId?: string;
  readonly displayName?: string;
  readonly sdkConfigAvailable: boolean;
};

export type FirebaseRealtimeDatabaseStatus = {
  readonly desired: boolean;
  readonly initialized: boolean;
  readonly databaseUrl?: string;
};

export type FirebaseStatus = {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly projectId?: string;
  readonly projectIdPresent: boolean;
  readonly remoteProjectVerified: boolean;
  readonly webApp: FirebaseWebAppStatus;
  readonly realtimeDatabase: FirebaseRealtimeDatabaseStatus;
  readonly realtimeDatabaseDesired: boolean;
  readonly rulesSourceConfigured: boolean;
  readonly rulesGenerated: boolean;
  readonly firebaseJson: boolean;
  readonly firebaserc: boolean;
};

type FirebaseOperation = OperationDefinition<any, unknown>;

const emptyInput = z.object({}).strict();
const projectInput = z
  .object({ projectId: z.string().trim().min(3).max(80) })
  .strict();
const webAppInput = z
  .object({ displayName: z.string().trim().min(1).max(60).optional() })
  .strict();
const sdkConfigInput = z
  .object({ appId: z.string().trim().min(1).max(140).optional() })
  .strict();
const rtdbInitializeInput = z
  .object({
    location: z.enum(["us-central1", "europe-west1", "asia-southeast1"]).default("us-central1"),
  })
  .strict();

export function createFirebaseOperations({
  projectRoot,
  config,
  firebase,
}: {
  readonly projectRoot: string;
  readonly config: NormalizedGasboostConfig;
  readonly firebase: FirebaseRunner;
}): readonly FirebaseOperation[] {
  const projectRepository = new FirebaseProjectRepository(projectRoot);
  const envRepository = new EnvFileRepository(projectRoot);
  const rulesGenerator = new RtdbRulesGenerator({
    loadConfig: () => loadGasboostConfig({ projectRoot }),
    moduleLoader: new ModuleLoader(projectRoot),
    writer: new RtdbRulesWriter(projectRoot),
  });
  const status = async (): Promise<FirebaseStatus> =>
    getFirebaseStatus({ config, projectRepository, envRepository, firebase });

  return [
    {
      id: "firebase.status",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Checking Firebase", percentage: 25 });
        const result = await status();
        context.progress({ message: "Firebase status ready", percentage: 100 });
        return result;
      },
    },
    {
      id: "firebase.enable",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Creating Firebase local configuration" });
        await projectRepository.enable();
        return status();
      },
    },
    {
      id: "firebase.project.status",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Checking Firebase project", percentage: 25 });
        const result = await status();
        context.progress({ message: "Firebase project status ready", percentage: 100 });
        return result;
      },
    },
    {
      id: "firebase.login",
      input: emptyInput,
      async handler(_input, context) {
        const result = await firebase.run(["login"], context.log);
        assertFirebaseSuccess("Firebase login", result);
        return status();
      },
    },
    {
      id: "firebase.project.create",
      input: projectInput,
      async handler(input, context) {
        context.progress({ message: "Creating Firebase project", percentage: 20 });
        const create = await firebase.run(
          ["projects:create", input.projectId, "--json"],
          context.log,
        );
        assertFirebaseSuccess("Firebase project create", create);
        context.progress({ message: "Syncing Firebase project locally", percentage: 80 });
        await projectRepository.connect(input.projectId);
        await envRepository.update({
          FIREBASE_PROJECT_ID: input.projectId,
          VITE_FIREBASE_PROJECT_ID: input.projectId,
        });
        return status();
      },
    },
    {
      id: "firebase.project.connect",
      input: projectInput,
      async handler(input, context) {
        context.progress({ message: "Verifying Firebase project", percentage: 30 });
        await verifyRemoteProject(firebase, input.projectId);
        await projectRepository.connect(input.projectId);
        await envRepository.update({
          FIREBASE_PROJECT_ID: input.projectId,
          VITE_FIREBASE_PROJECT_ID: input.projectId,
        });
        context.progress({ message: "Firebase project connected", percentage: 100 });
        return status();
      },
    },
    {
      id: "firebase.connect",
      input: projectInput,
      async handler(input, context) {
        context.progress({ message: "Verifying Firebase project", percentage: 30 });
        await verifyRemoteProject(firebase, input.projectId);
        await projectRepository.connect(input.projectId);
        await envRepository.update({
          FIREBASE_PROJECT_ID: input.projectId,
          VITE_FIREBASE_PROJECT_ID: input.projectId,
        });
        context.progress({ message: "Firebase project connected", percentage: 100 });
        return status();
      },
    },
    {
      id: "firebase.webapp.status",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Checking Firebase Web App", percentage: 30 });
        return status();
      },
    },
    {
      id: "firebase.webapp.create",
      input: webAppInput,
      async handler(input, context) {
        const projectId = await requireProjectId({ projectRepository, envRepository });
        const displayName = input.displayName ?? "Gasboost Web App";
        context.progress({ message: "Creating Firebase Web App", percentage: 25 });
        const result = await firebase.run(
          ["apps:create", "WEB", displayName, "--project", projectId, "--json"],
          context.log,
        );
        assertFirebaseSuccess("Firebase Web App create", result);
        const app = parseFirstWebApp(result) ?? (await getFirstWebApp(firebase, projectId));
        if (app?.appId !== undefined) {
          await persistSdkConfig({ firebase, envRepository, projectId, appId: app.appId, log: context.log });
        }
        return status();
      },
    },
    {
      id: "firebase.webapp.config",
      input: sdkConfigInput,
      async handler(input, context) {
        const projectId = await requireProjectId({ projectRepository, envRepository });
        const appId = input.appId ?? (await getFirstWebApp(firebase, projectId))?.appId;
        if (appId === undefined) {
          throw new Error("Create a Firebase Web App before fetching SDK config.");
        }
        context.progress({ message: "Fetching Firebase SDK config", percentage: 40 });
        const configResult = await persistSdkConfig({
          firebase,
          envRepository,
          projectId,
          appId,
          log: context.log,
        });
        context.progress({ message: "Firebase SDK config synced", percentage: 100 });
        return configResult;
      },
    },
    {
      id: "firebase.rtdb.status",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Checking Realtime Database", percentage: 30 });
        return status();
      },
    },
    {
      id: "firebase.rtdb.initialize",
      input: rtdbInitializeInput,
      async handler(input, context) {
        const projectId = await requireProjectId({ projectRepository, envRepository });
        context.progress({ message: "Initializing Realtime Database", percentage: 25 });
        const before = await getRealtimeDatabaseStatus(firebase, projectId, config);
        if (!before.initialized) {
          await firebase.initializeDefaultDatabase(projectId, input.location);
        }
        const after = await status();
        if (!after.realtimeDatabase.initialized) {
          throw new Error("Firebase RTDB initialization could not be verified.");
        }
        return after;
      },
    },
    {
      id: "firebase.rules.generate",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Generating Firebase RTDB rules", percentage: 25 });
        const result = await rulesGenerator.generate();
        context.log(`Rules written: ${result.outputPath}`);
        context.progress({ message: "Firebase RTDB rules generated", percentage: 100 });
        return { generated: true, ...result };
      },
    },
    {
      id: "firebase.rules.deploy",
      input: emptyInput,
      async handler(_input, context) {
        const env = await envRepository.read();
        const current = await projectRepository.read();
        const projectId = env.FIREBASE_PROJECT_ID ?? current.projectId;
        if (projectId === undefined) {
          throw new Error("Connect a Firebase project before deploying rules.");
        }
        if (!(await rulesFileExists(config, projectRoot))) {
          throw new Error("Generate Firebase RTDB rules before deploying them.");
        }
        const result = await firebase.run(
          ["deploy", "--only", "database", "--project", projectId],
          context.log,
        );
        assertFirebaseSuccess("Firebase RTDB rules deploy", result);
        await envRepository.update({ FIREBASE_PROJECT_ID: projectId });
        return { deployed: true, projectId };
      },
    },
  ];
}

async function getFirebaseStatus({
  config,
  projectRepository,
  envRepository,
  firebase,
}: {
  readonly config: NormalizedGasboostConfig;
  readonly projectRepository: FirebaseProjectRepository;
  readonly envRepository: EnvFileRepository;
  readonly firebase: FirebaseRunner;
}): Promise<FirebaseStatus> {
  const [project, env, login] = await Promise.all([
    projectRepository.read(),
    envRepository.read(),
    firebase.run(["login:list", "--json"]),
  ]);
  const projectId = project.projectId ?? env.FIREBASE_PROJECT_ID;
  if (projectId !== undefined) {
    await envRepository.update({
      FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_PROJECT_ID: projectId,
    });
  }
  const authenticated = login.exitCode === 0;
  const [remoteProjectVerified, webApp, realtimeDatabase, rulesGenerated] =
    await Promise.all([
      projectId === undefined || !authenticated
        ? Promise.resolve(false)
        : remoteProjectExists(firebase, projectId),
      projectId === undefined || !authenticated
        ? Promise.resolve({
            configured: false,
            sdkConfigAvailable: sdkConfigAvailable(env),
          } satisfies FirebaseWebAppStatus)
        : getWebAppStatus(firebase, projectId, env),
      projectId === undefined || !authenticated
        ? Promise.resolve({
            desired: config.firebase?.realtimeDatabase !== undefined,
            initialized: false,
          } satisfies FirebaseRealtimeDatabaseStatus)
        : getRealtimeDatabaseStatus(firebase, projectId, config),
      rulesFileExists(config, projectRepository.projectRoot),
    ]);

  return {
    enabled: project.enabled || config.firebase !== undefined,
    configured: projectId !== undefined && remoteProjectVerified,
    authenticated,
    ...(projectId === undefined ? {} : { projectId }),
    projectIdPresent: projectId !== undefined,
    remoteProjectVerified,
    webApp,
    realtimeDatabase,
    realtimeDatabaseDesired: config.firebase?.realtimeDatabase !== undefined,
    rulesSourceConfigured: config.firebase?.realtimeDatabase !== undefined,
    rulesGenerated,
    firebaseJson: project.firebaseJson,
    firebaserc: project.firebaserc,
  };
}

async function verifyRemoteProject(firebase: FirebaseRunner, projectId: string): Promise<void> {
  if (await remoteProjectExists(firebase, projectId)) return;
  throw new Error(`Firebase project was not found or is not accessible: ${projectId}`);
}

async function remoteProjectExists(firebase: FirebaseRunner, projectId: string): Promise<boolean> {
  const result = await firebase.run(["projects:list", "--json"]);
  if (result.exitCode !== 0) return false;
  return collectObjects(parseFirebaseJson(result.stdout)).some(
    (project) => project.projectId === projectId || project.projectNumber === projectId,
  );
}

async function getWebAppStatus(
  firebase: FirebaseRunner,
  projectId: string,
  env: Awaited<ReturnType<EnvFileRepository["read"]>>,
): Promise<FirebaseWebAppStatus> {
  const app = await getFirstWebApp(firebase, projectId);
  return {
    configured: app !== undefined,
    ...(app?.appId === undefined ? {} : { appId: app.appId }),
    ...(app?.displayName === undefined ? {} : { displayName: app.displayName }),
    sdkConfigAvailable: sdkConfigAvailable(env),
  };
}

async function getFirstWebApp(
  firebase: FirebaseRunner,
  projectId: string,
): Promise<{ readonly appId?: string; readonly displayName?: string } | undefined> {
  const result = await firebase.run(["apps:list", "WEB", "--project", projectId, "--json"]);
  if (result.exitCode !== 0) return undefined;
  return parseFirstWebApp(result);
}

function parseFirstWebApp(
  result: FirebaseResult,
): { readonly appId?: string; readonly displayName?: string } | undefined {
  const app = collectObjects(parseFirebaseJson(result.stdout)).find(
    (candidate) =>
      typeof candidate.appId === "string" ||
      typeof candidate.app_id === "string" ||
      typeof candidate.name === "string",
  );
  if (app === undefined) return undefined;
  const appId = stringValue(app.appId) ?? stringValue(app.app_id) ?? stringValue(app.name);
  const displayName = stringValue(app.displayName) ?? stringValue(app.display_name);
  return {
    ...(appId === undefined ? {} : { appId }),
    ...(displayName === undefined ? {} : { displayName }),
  };
}

async function persistSdkConfig({
  firebase,
  envRepository,
  projectId,
  appId,
  log,
}: {
  readonly firebase: FirebaseRunner;
  readonly envRepository: EnvFileRepository;
  readonly projectId: string;
  readonly appId: string;
  readonly log?: (line: string) => void;
}): Promise<{ readonly configured: true; readonly projectId: string; readonly appId: string }> {
  const result = await firebase.run(
    ["apps:sdkconfig", "WEB", appId, "--project", projectId, "--json"],
    log,
  );
  assertFirebaseSuccess("Firebase Web App SDK config", result);
  const config = parseSdkConfig(result.stdout);
  await envRepository.update({
    FIREBASE_PROJECT_ID: projectId,
    VITE_FIREBASE_PROJECT_ID: config.projectId ?? projectId,
    ...(config.apiKey === undefined ? {} : { VITE_FIREBASE_API_KEY: config.apiKey }),
    ...(config.authDomain === undefined ? {} : { VITE_FIREBASE_AUTH_DOMAIN: config.authDomain }),
    ...(config.databaseURL === undefined ? {} : { VITE_FIREBASE_DATABASE_URL: config.databaseURL }),
    ...(config.appId === undefined ? {} : { VITE_FIREBASE_APP_ID: config.appId }),
  });
  return { configured: true, projectId, appId };
}

function parseSdkConfig(stdout: string): {
  readonly apiKey?: string;
  readonly authDomain?: string;
  readonly databaseURL?: string;
  readonly projectId?: string;
  readonly appId?: string;
} {
  const value = parseFirebaseJson(stdout);
  const candidates = collectObjects(value);
  const config =
    candidates.find((candidate) => typeof candidate.apiKey === "string") ??
    candidates.find((candidate) => typeof candidate.firebaseConfig === "object") ??
    {};
  const nested =
    typeof config.firebaseConfig === "object" &&
    config.firebaseConfig !== null &&
    !Array.isArray(config.firebaseConfig)
      ? (config.firebaseConfig as Record<string, unknown>)
      : config;
  const apiKey = stringValue(nested.apiKey);
  const authDomain = stringValue(nested.authDomain);
  const databaseURL = stringValue(nested.databaseURL);
  const parsedProjectId = stringValue(nested.projectId);
  const appId = stringValue(nested.appId);
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(authDomain === undefined ? {} : { authDomain }),
    ...(databaseURL === undefined ? {} : { databaseURL }),
    ...(parsedProjectId === undefined ? {} : { projectId: parsedProjectId }),
    ...(appId === undefined ? {} : { appId }),
  };
}

async function getRealtimeDatabaseStatus(
  firebase: FirebaseRunner,
  projectId: string,
  config: NormalizedGasboostConfig,
): Promise<FirebaseRealtimeDatabaseStatus> {
  const desired = config.firebase?.realtimeDatabase !== undefined;
  const result = await firebase.run(["database:instances:list", "--project", projectId, "--json"]);
  if (result.exitCode !== 0) return { desired, initialized: false };
  const instance = collectObjects(parseFirebaseJson(result.stdout)).find(
    (candidate) =>
      typeof candidate.databaseUrl === "string" ||
      typeof candidate.databaseURL === "string" ||
      typeof candidate.instance === "string" ||
      typeof candidate.name === "string",
  );
  const databaseUrl =
    stringValue(instance?.databaseUrl) ??
    stringValue(instance?.databaseURL) ??
    (stringValue(instance?.instance) === undefined
      ? undefined
      : `https://${stringValue(instance?.instance)}.firebaseio.com`);
  return {
    desired,
    initialized: instance !== undefined,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  };
}

async function requireProjectId({
  projectRepository,
  envRepository,
}: {
  readonly projectRepository: FirebaseProjectRepository;
  readonly envRepository: EnvFileRepository;
}): Promise<string> {
  const [project, env] = await Promise.all([projectRepository.read(), envRepository.read()]);
  const projectId = project.projectId ?? env.FIREBASE_PROJECT_ID;
  if (projectId === undefined) throw new Error("Connect a Firebase project first.");
  return projectId;
}

async function rulesFileExists(
  config: NormalizedGasboostConfig,
  projectRoot: string,
): Promise<boolean> {
  const out = config.firebase?.realtimeDatabase?.out;
  if (out === undefined || out.length === 0) return false;
  try {
    await access(resolve(projectRoot, out));
    return true;
  } catch {
    return false;
  }
}

function sdkConfigAvailable(env: Awaited<ReturnType<EnvFileRepository["read"]>>): boolean {
  return (
    env.VITE_FIREBASE_API_KEY !== undefined &&
    env.VITE_FIREBASE_PROJECT_ID !== undefined &&
    env.VITE_FIREBASE_APP_ID !== undefined
  );
}

function parseFirebaseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function collectObjects(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectObjects(item));
  if (typeof value !== "object" || value === null) return [];
  const object = value as Record<string, unknown>;
  const nested = ["result", "apps", "projects", "instances", "data"]
    .flatMap((key) => collectObjects(object[key]));
  return [object, ...nested];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertFirebaseSuccess(action: string, result: FirebaseResult): void {
  if (result.exitCode === 0) return;
  const diagnostic = result.stderr.trim() || result.stdout.trim();
  throw new Error(
    diagnostic.length === 0 ? `${action} failed.` : `${action} failed: ${diagnostic}`,
  );
}
