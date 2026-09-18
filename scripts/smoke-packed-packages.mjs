import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectories = [
  "packages/config",
  "packages/console-runtime",
  "packages/console",
  "packages/cli",
];

const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-packed-smoke-"));
let cli;

try {
  const tarballs = await Promise.all(
    packageDirectories.map(async (directory) => {
      const packageJson = JSON.parse(
        await readFile(join(workspaceRoot, directory, "package.json"), "utf8"),
      );
      const archiveName = `${packageJson.name.slice(1).replace("/", "-")}-${packageJson.version}.tgz`;
      return join(workspaceRoot, directory, archiveName);
    }),
  );

  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({ name: "gasboost-packed-smoke", private: true }, null, 2),
    "utf8",
  );
  await writeFile(
    join(projectRoot, "gasboost.config.ts"),
    'export default { appsScript: { type: "webapp" } };\n',
    "utf8",
  );

  await run("npm", ["install", "--ignore-scripts", ...tarballs], projectRoot);

  const cliPath = join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "gasboost.cmd" : "gasboost",
  );
  cli = spawn(cliPath, ["console", "open", "--no-browser"], {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = await waitForConsoleUrl(cli);
  const uiResponse = await fetch(url);
  const html = await uiResponse.text();

  if (!uiResponse.ok || !html.includes("gasboost console")) {
    throw new Error("Packed Console UI could not be loaded");
  }

  const sessionToken = /name="gasboost-session" content="([^"]+)"/.exec(
    html,
  )?.[1];

  if (sessionToken === undefined) {
    throw new Error("Packed Console UI did not contain a session token");
  }

  const operationResponse = await fetch(`${url}/api/operations/project.inspect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: url,
      "X-Gasboost-Session": sessionToken,
    },
    body: "{}",
  });
  const events = await operationResponse.text();

  if (
    !operationResponse.ok ||
    !events.includes("event: result") ||
    !events.includes('"appsScript":true')
  ) {
    throw new Error("Packed CLI could not execute project.inspect");
  }

  console.log("Packed package smoke test passed");
} finally {
  cli?.kill("SIGTERM");
  await rm(projectRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function waitForConsoleUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Console URL\n${stderr}`));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = /Gasboost Console opened: (http:\/\/127\.0\.0\.1:\d+)/.exec(
        stdout,
      );

      if (match?.[1] !== undefined) {
        clearTimeout(timeout);
        resolveUrl(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Gasboost CLI exited with code ${code}\n${stderr}`));
    });
  });
}
