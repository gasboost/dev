import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startGasboostConsole } from "../dist/index.js";

describe("Gasboost Console E2E", () => {
  let close: (() => Promise<void>) | undefined;
  let projectRoot: string | undefined;

  afterEach(async () => {
    await close?.();
    if (projectRoot !== undefined) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("prebuilt UIからproject.inspectを実行できる", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "gasboost-console-e2e-"));
    await writeFile(
      join(projectRoot, "gasboost.config.ts"),
      'export default { appsScript: { type: "webapp" } };\n',
      "utf8",
    );
    const runtime = await startGasboostConsole({ projectRoot, openBrowser: false });
    close = runtime.close;

    const uiResponse = await fetch(runtime.url);
    const html = await uiResponse.text();
    const token = /name="gasboost-session" content="([^"]+)"/.exec(html)?.[1];
    expect(uiResponse.status).toBe(200);
    expect(html).toContain("Gasboost Console");
    expect(token).toBeDefined();

    const operationResponse = await fetch(
      `${runtime.url}/api/operations/project.inspect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: runtime.url,
          "X-Gasboost-Session": token ?? "",
        },
        body: "{}",
      },
    );
    const events = await operationResponse.text();
    expect(operationResponse.status).toBe(200);
    expect(events).toContain('"appsScript":true');
    expect(events).toContain("event: result");
  });
});
