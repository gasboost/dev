import { resolve } from "node:path";
import { appsScriptClient, FetchTransport } from "@gasboost/client";
import { afterEach, describe, expect, test } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { gasboost } from "../src";
import type { AppType } from "./fixtures/metadata/main";

let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start() {
  const entry = resolve(import.meta.dirname, "fixtures/metadata/main.ts");
  const { dev } = gasboost({ entry });
  server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [dev],
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return new FetchTransport({
    endpoint: `http://127.0.0.1:${address.port}/__gasboost`,
  });
}

describe("Local RPC metadata transport", () => {
  test("delivers provider and per-call metadata to middleware without changing input", async () => {
    const transport = await start();
    const providerMetadata = { "@example/provider": { id: "provider-1" } };
    const perCallMetadata = {
      "@example/trace": { id: "trace-1" },
      values: [false, null, 42],
    };
    const { client } = appsScriptClient<AppType>({
      transport,
      metadataProviders: [() => providerMetadata],
    });
    const input = { name: "Taro", metadata: { business: true } };

    expect(await client.echo(input, { metadata: perCallMetadata })).toEqual({
      input,
      observed: {
        input,
        metadata: { ...providerMetadata, ...perCallMetadata },
      },
    });
    expect(input).toEqual({ name: "Taro", metadata: { business: true } });
  });

  test("supports metadata-only calls, empty metadata, and subsequent calls without metadata", async () => {
    const transport = await start();
    const { client } = appsScriptClient<AppType>({ transport });
    const metadata = { arbitrary: { nested: ["value", 0] } };

    expect(await client.noInput(undefined, { metadata })).toEqual({
      observed: { metadata },
    });
    expect(await client.noInput(undefined, { metadata: {} })).toEqual({
      observed: { metadata: {} },
    });
    expect(await client.noInput()).toEqual({ observed: {} });
    expect(await client.echo({ value: "unchanged" })).toEqual({
      input: { value: "unchanged" },
      observed: { input: { value: "unchanged" } },
    });
  });
});
