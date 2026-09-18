import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { OperationRegistry, RegisteredOperation } from "./OperationRegistry.js";
import { OperationRegistry as Registry } from "./OperationRegistry.js";
import { openBrowser as openSystemBrowser } from "./openBrowser.js";

const MAX_INPUT_BYTES = 64 * 1024;

export type ConsoleRuntime = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export async function startConsoleRuntime({
  uiDirectory,
  operations,
  openBrowser = true,
  browserOpener = openSystemBrowser,
}: {
  readonly uiDirectory: string;
  readonly operations: readonly RegisteredOperation[];
  readonly openBrowser?: boolean;
  readonly browserOpener?: (url: string) => Promise<void>;
}): Promise<ConsoleRuntime> {
  const registry = new Registry();

  for (const operation of operations) {
    registry.register(operation);
  }

  const sessionToken = randomBytes(32).toString("base64url");
  let origin = "";
  const server = createServer((request, response) => {
    void routeRequest({
      request,
      response,
      origin,
      sessionToken,
      registry,
      uiDirectory,
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error("Console runtime did not receive a TCP address.");
  }

  origin = `http://127.0.0.1:${address.port}`;

  if (openBrowser) {
    try {
      await browserOpener(origin);
    } catch (error) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      throw error;
    }
  }

  return {
    url: origin,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => {
          if (error === undefined) resolveClose();
          else reject(error);
        });
      }),
  };
}

async function routeRequest({
  request,
  response,
  origin,
  sessionToken,
  registry,
  uiDirectory,
}: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly origin: string;
  readonly sessionToken: string;
  readonly registry: OperationRegistry;
  readonly uiDirectory: string;
}): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", origin);

    if (request.method === "POST" && url.pathname.startsWith("/api/operations/")) {
      await executeOperation({ request, response, origin, sessionToken, registry, url });
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveUi({ request, response, uiDirectory, sessionToken, pathname: url.pathname });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

async function executeOperation({
  request,
  response,
  origin,
  sessionToken,
  registry,
  url,
}: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly origin: string;
  readonly sessionToken: string;
  readonly registry: OperationRegistry;
  readonly url: URL;
}): Promise<void> {
  if (request.headers.origin !== origin) {
    sendJson(response, 403, { error: "Invalid origin" });
    return;
  }

  if (request.headers["x-gasboost-session"] !== sessionToken) {
    sendJson(response, 403, { error: "Invalid session" });
    return;
  }

  if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
    sendJson(response, 415, { error: "Content-Type must be application/json" });
    return;
  }

  const operationId = decodeURIComponent(url.pathname.slice("/api/operations/".length));
  const operation = registry.get(operationId);

  if (operation === undefined) {
    sendJson(response, 404, { error: "Operation is not registered" });
    return;
  }

  let rawInput: unknown;

  try {
    rawInput = JSON.parse(await readBody(request));
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON input",
    });
    return;
  }

  const input = operation.input.safeParse(rawInput);

  if (!input.success) {
    sendJson(response, 400, {
      error: "Operation input did not match its schema",
      issues: input.error.issues,
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });

  const event = (name: string, data: unknown): void => {
    response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await operation.handler(input.data, {
      log: (message) => event("log", { message }),
      progress: (progress) => event("progress", progress),
    });
    event("result", result);
  } catch (error) {
    event("error", {
      message: error instanceof Error ? error.message : "Operation failed",
    });
  } finally {
    response.end();
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;

    if (length > MAX_INPUT_BYTES) {
      throw new Error("Operation input is too large");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function serveUi({
  request,
  response,
  uiDirectory,
  sessionToken,
  pathname,
}: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly uiDirectory: string;
  readonly sessionToken: string;
  readonly pathname: string;
}): Promise<void> {
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const root = resolve(uiDirectory);
  let filePath = resolve(root, requestedPath);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    if (!(await stat(filePath)).isFile()) throw new Error("Not a file");
  } catch {
    filePath = resolve(root, "index.html");

    try {
      if (!(await stat(filePath)).isFile()) throw new Error("Not a file");
    } catch {
      sendJson(response, 404, { error: "Console UI was not found" });
      return;
    }
  }

  const headers = {
    "Content-Type": contentType(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };

  if (filePath.endsWith("index.html")) {
    const html = await readFile(filePath, "utf8");
    response.writeHead(200, headers);

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(html.replace("__GASBOOST_SESSION_TOKEN__", sessionToken));
    return;
  }

  response.writeHead(200, headers);

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

function contentType(path: string): string {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[extname(path)] ?? "application/octet-stream"
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}
