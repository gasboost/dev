import type { AppsScript } from "@gasboost/app";
import type { IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { type Plugin, isRunnableDevEnvironment } from "vite";
import type { GasboostOptions } from "./gasboost";
import { createLocalDatabase } from "./database";
import { installGasRuntime } from "./runtime";

type RpcRequestBody = {
  input: unknown | undefined;
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

export function createDevPlugin(options: GasboostOptions): Plugin {
  const { runtime, template } = options;

  let resolvedClientModuleId: string | undefined;
  let resolvedSheetormModuleId: string | undefined;
  const database = options.localRpc?.database
    ? createLocalDatabase(options.localRpc.database)
    : undefined;

  return {
    name: "gasboost:dev",
    apply: "serve",
    enforce: "pre",

    config() {
      if (database) {
        // Vite externalizes dependencies before resolveId unless opted out.
        return { ssr: { noExternal: [SHEETORM_MODULE_ID] } };
      }
    },

    async resolveId(source, importer, resolveOptions) {
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
      if (id === VIRTUAL_SHEETORM_MODULE_ID && database) {
        if (this.environment.name !== "ssr") return null;
        if (!resolvedSheetormModuleId) {
          throw new Error("@gasboost/sheetorm could not be resolved.");
        }
        // A native module bridge keeps the original package external even when
        // Vite's noExternal setting routes its public import through our shim.
        const bridge = `export * from ${JSON.stringify(pathToFileURL(resolvedSheetormModuleId).href)};`;
        const original = `data:text/javascript;base64,${Buffer.from(bridge).toString("base64")}`;
        return database.moduleSource(original);
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
      installGasRuntime(database ? { Sheets: undefined, ...runtime } : runtime);
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
          const { input } = await readRequest(request);

          const environment = server.environments.ssr;

          if (!isRunnableDevEnvironment(environment)) {
            throw new Error("Vite SSR environment is not runnable.");
          }

          environment.runner.clearCache();

          const module = (await environment.runner.import(options.entry)) as {
            default: AppsScript;
          };

          const result = await module.default.dispatch(
            decodeURIComponent(rpcName),
            input,
          );

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

      resolve({
        input: "input" in body ? body.input : undefined,
      });
    });
  });
}
