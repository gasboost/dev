import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startConsoleRuntime, type ConsoleRuntime } from "../src/index.js";

describe("startConsoleRuntime", () => {
  const directories: string[] = [];
  const runtimes: ConsoleRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    runtimes.length = 0;
    directories.length = 0;
  });

  async function start(): Promise<{ runtime: ConsoleRuntime; token: string }> {
    const uiDirectory = await mkdtemp(join(tmpdir(), "gasboost-runtime-ui-"));
    directories.push(uiDirectory);
    await writeFile(
      join(uiDirectory, "index.html"),
      '<meta name="gasboost-session" content="__GASBOOST_SESSION_TOKEN__">',
      "utf8",
    );

    const runtime = await startConsoleRuntime({
      uiDirectory,
      openBrowser: false,
      operations: [
        {
          id: "project.inspect",
          input: z.object({}).strict(),
          handler: (_input, context) => {
            context.progress({ message: "Inspecting", percentage: 50 });
            context.log("Loaded config");
            return { ready: true };
          },
        },
      ],
    });
    runtimes.push(runtime);

    const html = await (await fetch(runtime.url)).text();
    const token = /content="([^"]+)"/.exec(html)?.[1];
    if (token === undefined) throw new Error("Session token was not injected");
    return { runtime, token };
  }

  it("UIを配信してbrowserを任意に開く", async () => {
    const uiDirectory = await mkdtemp(join(tmpdir(), "gasboost-runtime-ui-"));
    directories.push(uiDirectory);
    await writeFile(join(uiDirectory, "index.html"), "Console", "utf8");
    const browserOpener = vi.fn(async () => undefined);

    const runtime = await startConsoleRuntime({
      uiDirectory,
      operations: [],
      browserOpener,
    });
    runtimes.push(runtime);

    expect(browserOpener).toHaveBeenCalledWith(runtime.url);
    await expect((await fetch(runtime.url)).text()).resolves.toBe("Console");
  });

  it("schema-valid inputだけを実行してeventsをstreamする", async () => {
    const { runtime, token } = await start();
    const response = await fetch(`${runtime.url}/api/operations/project.inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: runtime.url,
        "X-Gasboost-Session": token,
      },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await response.text();
    expect(events).toContain("event: progress");
    expect(events).toContain("event: log");
    expect(events).toContain('event: result\ndata: {"ready":true}');
  });

  it("未登録operationとschema-invalid inputを拒否する", async () => {
    const { runtime, token } = await start();
    const headers = {
      "Content-Type": "application/json",
      Origin: runtime.url,
      "X-Gasboost-Session": token,
    };

    const unknown = await fetch(`${runtime.url}/api/operations/shell.run`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(unknown.status).toBe(404);

    const invalid = await fetch(`${runtime.url}/api/operations/project.inspect`, {
      method: "POST",
      headers,
      body: JSON.stringify({ command: "rm" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("異なるoriginまたはsessionからの実行を拒否する", async () => {
    const { runtime, token } = await start();
    const wrongOrigin = await fetch(`${runtime.url}/api/operations/project.inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://example.com",
        "X-Gasboost-Session": token,
      },
      body: "{}",
    });
    expect(wrongOrigin.status).toBe(403);

    const wrongSession = await fetch(`${runtime.url}/api/operations/project.inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: runtime.url,
        "X-Gasboost-Session": "invalid",
      },
      body: "{}",
    });
    expect(wrongSession.status).toBe(403);
  });
});
