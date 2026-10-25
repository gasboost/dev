import { describe, expect, test, vi } from "vitest";
import type { Plugin } from "vite";
import { createFirebaseModule, firebaseEndpoint } from "../src/firebase";
import { gasboost } from "../src";

function hook(plugin: Plugin, name: "resolveId" | "load") {
  const value = plugin[name]!;
  return (typeof value === "function" ? value : value.handler) as Function;
}
function moduleUrl(source: string) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

// Each SDK stub has independent instances; generated wrappers use only public APIs.
let nextSdk = 0;
async function decorated(kind: "auth" | "database", fail = false) {
  const sdk = moduleUrl(`
    export const instance = { app: { options: { databaseURL: 'https://demo-unit.firebaseio.com' } } };
    export const calls = [];
    export const connections = [];
    export function getAuth(...args) { calls.push(args); return instance; }
    export function initializeAuth(...args) { calls.push(args); return instance; }
    export function getDatabase(...args) { calls.push(args); return instance; }
    export function connectAuthEmulator(...args) { connections.push(args); ${fail ? 'throw new Error("connection failed");' : ""} }
    export function connectDatabaseEmulator(...args) { connections.push(args); ${fail ? 'throw new Error("connection failed");' : ""} }
    export const marker = ${++nextSdk};
  `);
  const source = createFirebaseModule(sdk, kind, { namespace: "demo-unit" });
  const original = await import(sdk);
  return { original, wrapped: await import(moduleUrl(source)), source, sdk };
}

describe("Firebase emulator decorators", () => {
  test("Auth preserves arguments and instances and connects once across reloads", async () => {
    const { original, wrapped, source, sdk } = await decorated("auth");
    expect(wrapped.getAuth()).toBe(original.instance);
    const app = { name: "app" };
    const deps = { persistence: "test" };
    expect(wrapped.initializeAuth(app, deps)).toBe(original.instance);
    expect(original.calls).toEqual([[], [app, deps]]);
    expect(original.connections).toEqual([
      [original.instance, "http://127.0.0.1:9099"],
    ]);
    const reloaded = await import(moduleUrl(source + "\n// reload"));
    expect(reloaded.getAuth(app)).toBe(original.instance);
    expect(original.connections).toHaveLength(1);
    expect(wrapped.marker).toBe(original.marker);
    const changed = await import(
      moduleUrl(createFirebaseModule(sdk, "auth", { port: 9199 }))
    );
    expect(() => changed.getAuth()).toThrow("settings changed");
  });

  test("Database preserves optional arguments and connects once", async () => {
    const { original, wrapped } = await decorated("database");
    expect(wrapped.getDatabase()).toBe(original.instance);
    const app = { name: "app" };
    expect(wrapped.getDatabase(app, "https://demo-unit.firebaseio.com")).toBe(
      original.instance,
    );
    expect(original.calls).toEqual([
      [],
      [app, "https://demo-unit.firebaseio.com"],
    ]);
    expect(original.connections).toEqual([
      [original.instance, "127.0.0.1", 9000],
    ]);
  });

  test("supports custom endpoints and the SDK's inferred default database URL", async () => {
    const { original, sdk } = await decorated("database");
    delete original.instance.app.options.databaseURL;
    original.instance.app.options.projectId = "demo-unit";
    const wrapped = await import(
      moduleUrl(
        createFirebaseModule(sdk, "database", {
          namespace: "demo-unit-default-rtdb",
          host: "localhost",
          port: 9100,
        }),
      )
    );
    expect(wrapped.getDatabase()).toBe(original.instance);
    expect(original.connections).toEqual([
      [original.instance, "localhost", 9100],
    ]);
  });

  test.each(["auth", "database"] as const)(
    "%s connection failures propagate and are never marked successful",
    async (kind) => {
      const { original, wrapped } = await decorated(kind, true);
      const initialize =
        kind === "auth" ? wrapped.getAuth : wrapped.getDatabase;
      expect(() => initialize()).toThrow("connection failed");
      expect(() => initialize()).toThrow("connection failed");
      expect(original.connections).toHaveLength(2);
    },
  );

  test.each([
    [{ port: 0 }, "port"],
    [{ port: 65536 }, "port"],
    [{ port: 9000.5 }, "port"],
    [{ host: "production.example.com" }, "loopback"],
  ])("rejects invalid endpoints %j", (options, message) => {
    expect(() => firebaseEndpoint(options, 9000)).toThrow(message);
  });

  test("normalizes IPv6 loopback and validates namespace", () => {
    expect(firebaseEndpoint({ host: "::1" }, 9000)).toEqual({
      host: "[::1]",
      port: 9000,
    });
    expect(() =>
      createFirebaseModule("sdk", "database", { namespace: " " }),
    ).toThrow("namespace");
  });

  test.each(["server", "client"])(
    "disabled SDKs are untouched in %s",
    async (consumer) => {
      const { dev } = gasboost({ entry: "unused.ts" });
      const resolve = vi.fn();
      const context = { environment: { config: { consumer } }, resolve };
      for (const id of [
        "firebase/auth",
        "firebase/database",
        "firebase/compat/auth",
      ]) {
        expect(
          await hook(dev, "resolveId").call(context, id, "/main.ts", {}),
        ).toBeNull();
      }
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  test("enabled SDKs still leave SSR and subpaths untouched", async () => {
    const { dev } = gasboost({
      entry: "unused.ts",
      localRpc: { auth: { emulator: {} } },
    });
    const resolve = vi.fn();
    const context = {
      environment: { config: { consumer: "server" } },
      resolve,
    };
    expect(
      await hook(dev, "resolveId").call(
        context,
        "firebase/auth",
        "/main.ts",
        {},
      ),
    ).toBeNull();
    context.environment.config.consumer = "client";
    expect(
      await hook(dev, "resolveId").call(
        context,
        "firebase/auth/other",
        "/main.ts",
        {},
      ),
    ).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  test("an unresolved opted-in SDK fails explicitly", async () => {
    const { dev } = gasboost({
      entry: "unused.ts",
      localRpc: { auth: { emulator: {} } },
    });
    const context = {
      environment: { config: { consumer: "client" } },
      resolve: vi.fn(async () => null),
    };
    await expect(
      hook(dev, "resolveId").call(context, "firebase/auth", "/main.ts", {}),
    ).rejects.toThrow("could not be resolved");
  });
});
