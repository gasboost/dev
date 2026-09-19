import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirebaseOperations } from "../src/index.js";

describe("Firebase operations", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    directories.length = 0;
  });

  async function createProject(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-firebase-"));
    directories.push(projectRoot);
    return projectRoot;
  }

  it("connect writes local Firebase state and syncs FIREBASE_PROJECT_ID", async () => {
    const projectRoot = await createProject();
    const run = firebaseRun({
      "projects:list --json": {
        result: [{ projectId: "my-project" }],
      },
    });
    const operation = operationById(
      createFirebaseOperations({
        projectRoot,
        config: {},
        firebase: { run },
      }),
      "firebase.connect",
    );

    await operation.handler({ projectId: "my-project" }, context());

    await expect(readFile(join(projectRoot, ".firebaserc"), "utf8")).resolves.toContain(
      '"default": "my-project"',
    );
    await expect(readFile(join(projectRoot, ".env"), "utf8")).resolves.toContain(
      "FIREBASE_PROJECT_ID=my-project",
    );
    await expect(readFile(join(projectRoot, ".env"), "utf8")).resolves.toContain(
      "VITE_FIREBASE_PROJECT_ID=my-project",
    );
  });

  it("connect preserves existing .firebaserc fields and project aliases", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".firebaserc"),
      JSON.stringify({
        projects: { default: "old", staging: "staging-project" },
        targets: { db: {} },
      }),
      "utf8",
    );
    const operation = operationById(
      createFirebaseOperations({
        projectRoot,
        config: {},
        firebase: {
          run: firebaseRun({
            "projects:list --json": {
              result: [{ projectId: "new-project" }],
            },
          }),
        },
      }),
      "firebase.connect",
    );

    await operation.handler({ projectId: "new-project" }, context());

    const settings = JSON.parse(
      await readFile(join(projectRoot, ".firebaserc"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings).toEqual({
      projects: { default: "new-project", staging: "staging-project" },
      targets: { db: {} },
    });
  });

  it("does not write local project state when remote verification fails", async () => {
    const projectRoot = await createProject();
    const operation = operationById(
      createFirebaseOperations({
        projectRoot,
        config: {},
        firebase: {
          run: firebaseRun({
            "projects:list --json": {
              result: [{ projectId: "other-project" }],
            },
          }),
        },
      }),
      "firebase.project.connect",
    );

    await expect(operation.handler({ projectId: "missing-project" }, context())).rejects.toThrow(
      "Firebase project was not found or is not accessible: missing-project",
    );
    await expect(readFile(join(projectRoot, ".firebaserc"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(projectRoot, ".env"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fetches Web App SDK config into VITE Firebase env values", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".firebaserc"),
      JSON.stringify({ projects: { default: "my-project" } }),
      "utf8",
    );
    const operation = operationById(
      createFirebaseOperations({
        projectRoot,
        config: {},
        firebase: {
          run: firebaseRun({
            "apps:list WEB --project my-project --json": {
              result: [{ appId: "1:123:web:abc", displayName: "Web" }],
            },
            "apps:sdkconfig WEB 1:123:web:abc --project my-project --json": {
              result: {
                apiKey: "api-key",
                authDomain: "my-project.firebaseapp.com",
                databaseURL: "https://my-project.firebaseio.com",
                projectId: "my-project",
                appId: "1:123:web:abc",
              },
            },
          }),
        },
      }),
      "firebase.webapp.config",
    );

    await operation.handler({}, context());

    await expect(readFile(join(projectRoot, ".env"), "utf8")).resolves.toContain(
      "VITE_FIREBASE_API_KEY=api-key",
    );
    await expect(readFile(join(projectRoot, ".env"), "utf8")).resolves.toContain(
      "VITE_FIREBASE_DATABASE_URL=https://my-project.firebaseio.com",
    );
    await expect(readFile(join(projectRoot, ".env"), "utf8")).resolves.toContain(
      "VITE_FIREBASE_APP_ID=1:123:web:abc",
    );
  });
});

function firebaseRun(responses: Record<string, unknown>) {
  return vi.fn(async (args: readonly string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    return {
      exitCode: response === undefined ? 0 : 0,
      stdout: JSON.stringify(response ?? {}),
      stderr: "",
    };
  });
}

function operationById(
  operations: ReturnType<typeof createFirebaseOperations>,
  id: string,
) {
  const operation = operations.find((candidate) => candidate.id === id);
  if (operation === undefined) throw new Error(`Operation not found: ${id}`);
  return operation;
}

function context() {
  return { log: vi.fn(), progress: vi.fn() };
}
