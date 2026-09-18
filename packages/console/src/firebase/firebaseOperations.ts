import type { NormalizedGasboostConfig } from "@gasboost/config";
import type { OperationDefinition } from "@gasboost/console-runtime";
import { z } from "zod";
import { EnvFileRepository } from "../env/EnvFileRepository.js";
import { FirebaseProjectRepository } from "./FirebaseProjectRepository.js";
import type { FirebaseResult, FirebaseRunner } from "./FirebaseRunner.js";

export type FirebaseStatus = {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly projectId?: string;
  readonly realtimeDatabaseDesired: boolean;
  readonly firebaseJson: boolean;
  readonly firebaserc: boolean;
};

type FirebaseOperation = OperationDefinition<any, unknown>;

const emptyInput = z.object({}).strict();
const projectInput = z
  .object({ projectId: z.string().trim().min(3).max(80) })
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
      id: "firebase.login",
      input: emptyInput,
      async handler(_input, context) {
        const result = await firebase.run(["login"], context.log);
        assertFirebaseSuccess("Firebase login", result);
        return status();
      },
    },
    {
      id: "firebase.connect",
      input: projectInput,
      async handler(input, context) {
        context.progress({ message: "Connecting Firebase project", percentage: 30 });
        await projectRepository.connect(input.projectId);
        await envRepository.update({ FIREBASE_PROJECT_ID: input.projectId });
        context.progress({ message: "Firebase project connected", percentage: 100 });
        return status();
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
    await envRepository.update({ FIREBASE_PROJECT_ID: projectId });
  }

  return {
    enabled: project.enabled || config.firebase !== undefined,
    configured: projectId !== undefined,
    authenticated: login.exitCode === 0,
    ...(projectId === undefined ? {} : { projectId }),
    realtimeDatabaseDesired: config.firebase?.realtimeDatabase !== undefined,
    firebaseJson: project.firebaseJson,
    firebaserc: project.firebaserc,
  };
}

function assertFirebaseSuccess(action: string, result: FirebaseResult): void {
  if (result.exitCode === 0) return;
  const diagnostic = result.stderr.trim() || result.stdout.trim();
  throw new Error(
    diagnostic.length === 0 ? `${action} failed.` : `${action} failed: ${diagnostic}`,
  );
}
