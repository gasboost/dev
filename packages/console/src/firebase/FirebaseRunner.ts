import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const firebaseBin = require.resolve("firebase-tools/lib/bin/firebase.js");

export type FirebaseResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type FirebaseRunner = {
  readonly run: (
    args: readonly string[],
    onOutput?: (line: string) => void,
  ) => Promise<FirebaseResult>;
  readonly initializeDefaultDatabase: (
    projectId: string,
    location: string,
  ) => Promise<void>;
};

export function createFirebaseRunner(projectRoot: string): FirebaseRunner {
  return {
    async initializeDefaultDatabase(projectId, location) {
      const auth = require("firebase-tools/lib/auth.js") as {
        selectAccount: (account?: string, projectRoot?: string) => unknown;
      };
      const { requireAuth } = require("firebase-tools/lib/requireAuth.js") as {
        requireAuth: (options: object) => Promise<unknown>;
      };
      const database = require("firebase-tools/lib/management/database.js") as {
        checkInstanceNameAvailable: (
          projectId: string, name: string, type: string, location: string,
        ) => Promise<{ available: boolean; suggestedIds?: string[] }>;
        createInstance: (
          projectId: string, name: string, location: string, type: string,
        ) => Promise<unknown>;
      };
      const account = auth.selectAccount(undefined, projectRoot) as
        | { user: unknown; tokens: unknown }
        | undefined;
      await requireAuth({ project: projectId, user: account?.user, tokens: account?.tokens });
      const type = "default_database";
      let name = `${projectId}-default-rtdb`;
      const availability = await database.checkInstanceNameAvailable(projectId, name, type, location);
      if (!availability.available) {
        name = availability.suggestedIds?.[0] ?? "";
        if (!name) throw new Error("No available default Realtime Database instance name.");
      }
      await database.createInstance(projectId, name, location, type);
    },
    run: (args, onOutput) =>
      new Promise<FirebaseResult>((resolve, reject) => {
        const child = spawn(process.execPath, [firebaseBin, ...args], {
          cwd: projectRoot,
          env: { ...process.env, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const stdoutLines = createLineEmitter(onOutput);
        const stderrLines = createLineEmitter(onOutput);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          stdoutLines.write(chunk);
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
          stderrLines.write(chunk);
        });
        child.once("error", reject);
        child.once("close", (exitCode) => {
          stdoutLines.flush();
          stderrLines.flush();
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });
      }),
  };
}

function createLineEmitter(
  onOutput: ((line: string) => void) | undefined,
): { readonly write: (chunk: string) => void; readonly flush: () => void } {
  let buffer = "";
  const emit = (line: string): void => {
    const message = line.trim();
    if (message.length > 0) onOutput?.(message);
  };

  return {
    write(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) emit(line);
    },
    flush() {
      emit(buffer);
      buffer = "";
    },
  };
}
