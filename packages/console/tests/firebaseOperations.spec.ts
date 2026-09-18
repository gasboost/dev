import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "[]", stderr: "" }));
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
  });
});

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
