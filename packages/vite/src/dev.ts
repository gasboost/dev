import type { AppsScript, RpcMetadata } from "@gasboost/app";
import { NodeUrlFetchApp } from "@gasboost/fake-node";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { type Plugin, isRunnableDevEnvironment } from "vite";
import type { GasboostOptions } from "./gasboost";
import { createLocalDatabase } from "./database";
import { createRtdbModule } from "./rtdb";
import { createFirebaseModule, firebaseEndpoint } from "./firebase";
import { installGasRuntime } from "./runtime";

type RpcRequestBody = {
  input: unknown | undefined;
  metadata?: RpcMetadata;
};

class InvalidRpcRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRpcRequestError";
  }
}

const CLIENT_MODULE_ID = "@gasboost/client";
const VIRTUAL_CLIENT_MODULE_ID = "\0gasboost:client";
const LOCAL_RPC_ENDPOINT = "/__gasboost";
const SHEETORM_MODULE_ID = "@gasboost/sheetorm";
const VIRTUAL_SHEETORM_MODULE_ID = "\0gasboost:sheetorm";
const RTDB_MODULE_ID = "@gasboost/realtime-firebase";
const RTDB_EMULATOR_MODULE_ID = `${RTDB_MODULE_ID}/emulator`;
const VIRTUAL_RTDB_MODULE_ID = "\0gasboost:rtdb";

export function createDevPlugin(options: GasboostOptions): Plugin {
  const { runtime, template } = options;

  let resolvedClientModuleId: string | undefined;
  let resolvedSheetormModuleId: string | undefined;
  let resolvedRtdbModuleId: string | undefined;
  const emulator = options.localRpc?.rtdb?.emulator;
  const authEmulator = options.localRpc?.auth?.emulator;
  const firebaseModules = new Map<string, string>();
  const firebaseImports = [
    ...(authEmulator ? ["firebase/auth"] : []),
    ...(emulator ? ["firebase/database"] : []),
  ];
  const database = options.localRpc?.database
    ? createLocalDatabase(options.localRpc.database)
    : undefined;

  return {
    name: "gasboost:dev",
    apply: "serve",
    enforce: "pre",

    config(config) {
      if (authEmulator) firebaseEndpoint(authEmulator, 9099);
      if (emulator) {
        firebaseEndpoint(emulator, 9000);
        if (!emulator.namespace?.trim()) {
          throw new Error(
            "Firebase RTDB Emulator namespace must not be empty.",
          );
        }
      }
      if (database || emulator || authEmulator) {
        // Vite externalizes dependencies before resolveId unless opted out.
        return {
          optimizeDeps: {
            exclude: firebaseImports,
            // Prebundle the shared implementation, not the decorated entry.
            // This also keeps SDK imports in other dependencies on one copy.
            include: firebaseImports
              .filter((id) => {
                try {
                  createRequire(
                    resolve(config.root ?? ".", "package.json"),
                  ).resolve(id);
                  return true;
                } catch {
                  // Backend-only consumers need not install the browser SDK.
                  return false;
                }
              })
              .map((id) => `${id} > @${id}`),
          },
          ssr: {
            noExternal: [
              ...(database ? [SHEETORM_MODULE_ID] : []),
              ...(emulator ? [RTDB_MODULE_ID] : []),
            ],
            // noExternal matches package names, including subpaths. Preserve
            // native loading for the unmodified public RTDB subpaths.
            ...(emulator
              ? {
                  external: [
                    `${RTDB_MODULE_ID}/client`,
                    RTDB_EMULATOR_MODULE_ID,
                  ],
                }
              : {}),
          },
        };
      }
    },

    async resolveId(source, importer, resolveOptions) {
      if (
        this.environment.config.consumer === "client" &&
        firebaseImports.includes(source)
      ) {
        const resolved = await this.resolve(source, importer, {
          ...resolveOptions,
          skipSelf: true,
        });
        if (!resolved)
          throw new Error(`${source} could not be resolved from the consumer.`);
        const id = `\0gasboost:${source}`;
        firebaseModules.set(id, resolved.id);
        return id;
      }
      if (
        emulator &&
        source === RTDB_MODULE_ID &&
        this.environment.name === "ssr"
      ) {
        const resolved = await this.resolve(source, importer, {
          ...resolveOptions,
          skipSelf: true,
        });
        if (!resolved) return null;
        resolvedRtdbModuleId = resolved.id;
        return VIRTUAL_RTDB_MODULE_ID;
      }

      if (
        database &&
        source === SHEETORM_MODULE_ID &&
        this.environment.name === "ssr"
      ) {
        const resolved = await this.resolve(source, importer, {
          ...resolveOptions,
          skipSelf: true,
        });
        if (!resolved) return null;
        resolvedSheetormModuleId = resolved.id;
        return VIRTUAL_SHEETORM_MODULE_ID;
      }

      if (source !== CLIENT_MODULE_ID) {
        return null;
      }

      if (this.environment.config.consumer !== "client") {
        return null;
      }

      const resolved = await this.resolve(source, importer, {
        ...resolveOptions,
        skipSelf: true,
      });

      if (!resolved) {
        return null;
      }

      resolvedClientModuleId = resolved.id;

      return VIRTUAL_CLIENT_MODULE_ID;
    },

    load(id) {
      const firebaseModule = firebaseModules.get(id);
      if (firebaseModule && this.environment.config.consumer === "client") {
        return id === "\0gasboost:firebase/auth"
          ? createFirebaseModule(firebaseModule, "auth", authEmulator!)
          : createFirebaseModule(firebaseModule, "database", emulator!);
      }
      if (id === VIRTUAL_RTDB_MODULE_ID && emulator) {
        if (this.environment.name !== "ssr") return null;
        if (!resolvedRtdbModuleId) {
          throw new Error("@gasboost/realtime-firebase could not be resolved.");
        }
        let emulatorModule: string;
        try {
          // Resolve from the consumer's package, without loading RTDB in Vite.
          emulatorModule = createRequire(resolvedRtdbModuleId).resolve(
            RTDB_EMULATOR_MODULE_ID,
          );
        } catch (cause) {
          throw new Error(
            "Local RPC RTDB emulator requires @gasboost/realtime-firebase@^0.9.0 with the /emulator export.",
            { cause },
          );
        }
        return createRtdbModule(
          nativeModuleBridge(resolvedRtdbModuleId),
          nativeModuleBridge(emulatorModule),
          emulator,
        );
      }

      if (id === VIRTUAL_SHEETORM_MODULE_ID && database) {
        if (this.environment.name !== "ssr") return null;
        if (!resolvedSheetormModuleId) {
          throw new Error("@gasboost/sheetorm could not be resolved.");
        }
        return database.moduleSource(
          nativeModuleBridge(resolvedSheetormModuleId),
        );
      }

      if (id !== VIRTUAL_CLIENT_MODULE_ID) {
        return null;
      }

      if (!resolvedClientModuleId) {
        throw new Error("@gasboost/client could not be resolved.");
      }

      const clientModuleId = JSON.stringify(resolvedClientModuleId);
      const endpoint = JSON.stringify(LOCAL_RPC_ENDPOINT);
      const overrideLocalRpc = options.localRpc?.override !== false;

      return `
import {
  appsScriptClient as originalAppsScriptClient,
  FetchTransport,
} from ${clientModuleId};

export * from ${clientModuleId};

export function appsScriptClient(options = {}) {
  return originalAppsScriptClient({
    ...options,
    transport: ${
      overrideLocalRpc
        ? `new FetchTransport({
        endpoint: ${endpoint},
      })`
        : `options.transport ??
      new FetchTransport({
        endpoint: ${endpoint},
      })`
    },
  });
}
`;
    },

    configureServer(server) {
      // Resolve the GAS global in unchanged `new SheetGateway(Sheets!)` code.
      // The local gateway ignores it; no Sheets API emulator is installed.
      installGasRuntime({
        ...(database ? { Sheets: undefined } : {}),
        ...(emulator ? { UrlFetchApp: new NodeUrlFetchApp() } : {}),
        ...runtime,
      });
      database?.install();

      server.middlewares.use(async (request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const pathname = request.url.split("?")[0];
        const prefix = `${LOCAL_RPC_ENDPOINT}/`;

        if (!pathname.startsWith(prefix)) {
          next();
          return;
        }

        const rpcName = pathname.slice(prefix.length);

        if (!rpcName || rpcName.includes("/")) {
          next();
          return;
        }

        if (request.method !== "POST") {
          response.statusCode = 405;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(
            JSON.stringify({
              error: {
                name: "MethodNotAllowedError",
                message: "Only POST is allowed.",
              },
            }),
          );
          return;
        }

        try {
          const { input, metadata } = await readRequest(request);

          const environment = server.environments.ssr;

          if (!isRunnableDevEnvironment(environment)) {
            throw new Error("Vite SSR environment is not runnable.");
          }

          environment.runner.clearCache();

          const module = (await environment.runner.import(options.entry)) as {
            default: AppsScript;
          };

          const name = decodeURIComponent(rpcName);
          const result =
            metadata === undefined
              ? await module.default.dispatch(name, input)
              : await module.default.dispatch(name, input, metadata);

          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(result.contents);
        } catch (error) {
          response.statusCode =
            error instanceof InvalidRpcRequestError ? 400 : 500;

          response.setHeader("Content-Type", "application/json; charset=utf-8");

          response.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                    }
                  : {
                      name: "UnknownError",
                      message: String(error),
                    },
            }),
          );
        }
      });
    },

    closeBundle() {
      database?.dispose();
    },

    transformIndexHtml(html) {
      if (!template) {
        return html;
      }

      let transformed = html;

      for (const [name, value] of Object.entries(template)) {
        const expression = new RegExp(
          `<\\?=\\s*${escapeRegExp(name)}\\s*\\?>`,
          "g",
        );

        transformed = transformed.replace(expression, () => value);
      }

      return transformed;
    },
  };
}

// Native bridges keep CJS dependencies external while their public root
// imports are routed through Vite's SSR virtual modules.
function nativeModuleBridge(id: string): string {
  const bridge = `export * from ${JSON.stringify(pathToFileURL(id).href)};`;
  return `data:text/javascript;base64,${Buffer.from(bridge).toString("base64")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRequest(request: IncomingMessage): Promise<RpcRequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    request.on("error", reject);

    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");

      if (!raw) {
        resolve({
          input: undefined,
        });
        return;
      }

      let body: unknown;

      try {
        body = JSON.parse(raw);
      } catch {
        reject(
          new InvalidRpcRequestError(
            "Invalid RPC request body. Expected valid JSON.",
          ),
        );
        return;
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        reject(
          new InvalidRpcRequestError(
            "Invalid RPC request body. Expected an object.",
          ),
        );
        return;
      }

      const metadata = "metadata" in body ? body.metadata : undefined;

      if (
        metadata !== undefined &&
        (typeof metadata !== "object" ||
          metadata === null ||
          Array.isArray(metadata))
      ) {
        reject(
          new InvalidRpcRequestError(
            "Invalid RPC request body. Expected metadata to be an object.",
          ),
        );
        return;
      }

      resolve({
        // Match AppsScriptTransport's serializable positional placeholder.
        // Without metadata, preserve the existing no-input behavior.
        input:
          "input" in body
            ? body.input
            : metadata === undefined
              ? undefined
              : null,
        metadata: metadata as RpcMetadata | undefined,
      });
    });
  });
}
