import type { OperationDefinition } from "@gasboost/console-runtime";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { openBrowser } from "../openBrowser.js";

export type DevelopmentStatus = {
  readonly running: boolean;
  readonly localUrl?: string;
  readonly command?: readonly string[];
  readonly log: readonly string[];
};

type DevelopmentOperation = OperationDefinition<Record<string, never>, DevelopmentStatus>;

const emptyInput = z.object({}).strict();
const MAX_LOG_LINES = 200;
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s"'<>)]*/;

export function createDevelopmentOperations({
  projectRoot,
  browserOpener = openBrowser,
  urlDetectionTimeoutMs = 5000,
}: {
  readonly projectRoot: string;
  readonly browserOpener?: (url: string) => Promise<void>;
  readonly urlDetectionTimeoutMs?: number;
}): {
  readonly operations: readonly DevelopmentOperation[];
  readonly cleanup: () => Promise<void>;
} {
  const manager = new DevelopmentProcessManager(
    projectRoot,
    browserOpener,
    urlDetectionTimeoutMs,
  );

  return {
    cleanup: async () => {
      await manager.stop();
    },
    operations: [
      {
        id: "development.status",
        input: emptyInput,
        async handler() {
          return manager.status();
        },
      },
      {
        id: "development.start",
        input: emptyInput,
        async handler(_input, context) {
          context.progress({ message: "Starting local application", percentage: 20 });
          const status = await manager.start(context.log);
          context.progress({ message: status.running ? "Local application running" : "Local application stopped", percentage: 100 });
          return status;
        },
      },
      {
        id: "development.stop",
        input: emptyInput,
        async handler(_input, context) {
          context.progress({ message: "Stopping local application", percentage: 30 });
          const status = await manager.stop();
          context.progress({ message: "Local application stopped", percentage: 100 });
          return status;
        },
      },
      {
        id: "development.restart",
        input: emptyInput,
        async handler(_input, context) {
          context.progress({ message: "Restarting local application", percentage: 20 });
          await manager.stop();
          const status = await manager.start(context.log);
          context.progress({ message: "Local application restarted", percentage: 100 });
          return status;
        },
      },
      {
        id: "development.open",
        input: emptyInput,
        async handler() {
          const status = manager.status();
          if (!status.running) {
            throw new Error("Start the local application first.");
          }
          if (status.localUrl === undefined) {
            throw new Error("Local application URL is not available yet.");
          }
          await manager.open(status.localUrl);
          return status;
        },
      },
    ],
  };
}

class DevelopmentProcessManager {
  private child: ChildProcessWithoutNullStreams | undefined;
  private command: readonly string[] | undefined;
  private localUrl: string | undefined;
  private readonly logLines: string[] = [];
  private readonly statusWaiters = new Set<() => void>();

  public constructor(
    private readonly projectRoot: string,
    private readonly browserOpener: (url: string) => Promise<void>,
    private readonly urlDetectionTimeoutMs: number,
  ) {}

  public status(): DevelopmentStatus {
    return {
      running: this.child !== undefined,
      ...(this.localUrl === undefined ? {} : { localUrl: this.localUrl }),
      ...(this.command === undefined ? {} : { command: this.command }),
      log: this.logLines,
    };
  }

  public async start(log: (message: string) => void): Promise<DevelopmentStatus> {
    if (this.child !== undefined) {
      const message = "Development server is already running.";
      this.record(message);
      log(message);
      return this.status();
    }

    const command = await resolveDevCommand(this.projectRoot);
    this.command = [command.executable, ...command.args];
    this.localUrl = undefined;
    this.record(`$ ${this.command.join(" ")}`);

    const child = spawn(command.executable, command.args, {
      cwd: this.projectRoot,
      env: {
        ...process.env,
        BROWSER: "none",
        FORCE_COLOR: "1",
      },
      shell: process.platform === "win32",
    });
    this.child = child;

    const handleOutput = (chunk: Buffer): void => {
      const text = stripAnsi(chunk.toString("utf8"));
      const url = LOCAL_URL_PATTERN.exec(text)?.[0];
      if (url !== undefined) {
        this.localUrl = normalizeLocalUrl(url);
        this.notifyStatusWaiters();
      }
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed.length === 0) continue;
        this.record(trimmed);
        log(trimmed);
      }
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    child.once("exit", (code, signal) => {
      this.record(`Development server exited${signal === null ? ` with code ${code ?? 0}` : ` by ${signal}`}.`);
      if (this.child === child) {
        this.child = undefined;
        this.localUrl = undefined;
        this.notifyStatusWaiters();
      }
    });
    child.once("error", (error) => {
      this.record(error.message);
      if (this.child === child) {
        this.child = undefined;
        this.localUrl = undefined;
        this.notifyStatusWaiters();
      }
    });

    await this.waitForLocalUrlOrStop(child);
    return this.status();
  }

  public async stop(): Promise<DevelopmentStatus> {
    const child = this.child;
    if (child === undefined) return this.status();

    this.child = undefined;
    this.localUrl = undefined;
    this.notifyStatusWaiters();
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.kill("SIGTERM");

    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
          resolve();
        }, 5000);
      }),
    ]);

    this.record("Development server stopped.");
    return this.status();
  }

  public async open(url: string): Promise<void> {
    await this.browserOpener(url);
  }

  private record(message: string): void {
    this.logLines.push(message);
    if (this.logLines.length > MAX_LOG_LINES) {
      this.logLines.splice(0, this.logLines.length - MAX_LOG_LINES);
    }
  }

  private async waitForLocalUrlOrStop(
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    if (this.localUrl !== undefined || this.child !== child) return;

    await new Promise<void>((resolve) => {
      const waiter = (): void => {
        clearTimeout(timeout);
        this.statusWaiters.delete(waiter);
        resolve();
      };
      const timeout = setTimeout(waiter, this.urlDetectionTimeoutMs);
      this.statusWaiters.add(waiter);
    });
  }

  private notifyStatusWaiters(): void {
    const waiters = [...this.statusWaiters];
    this.statusWaiters.clear();
    for (const waiter of waiters) waiter();
  }
}

async function resolveDevCommand(projectRoot: string): Promise<{
  readonly executable: string;
  readonly args: readonly string[];
}> {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
    readonly packageManager?: string;
    readonly scripts?: Record<string, unknown>;
  };

  if (typeof packageJson.scripts?.dev !== "string") {
    throw new Error("No package.json dev script was found.");
  }

  const packageManager = packageJson.packageManager?.split("@", 1)[0] ?? "npm";
  if (packageManager === "pnpm") return { executable: "pnpm", args: ["run", "dev"] };
  if (packageManager === "yarn") return { executable: "yarn", args: ["dev"] };
  if (packageManager === "bun") return { executable: "bun", args: ["run", "dev"] };
  return { executable: "npm", args: ["run", "dev"] };
}

function normalizeLocalUrl(url: string): string {
  const parsed = new URL(url.replace("http://localhost", "http://127.0.0.1"));
  return parsed.toString();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
