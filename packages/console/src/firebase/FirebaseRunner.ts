import { spawn } from "node:child_process";

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
};

export function createFirebaseRunner(projectRoot: string): FirebaseRunner {
  return {
    run: (args, onOutput) =>
      new Promise<FirebaseResult>((resolve, reject) => {
        const child = spawn("pnpm", ["exec", "firebase", ...args], {
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
