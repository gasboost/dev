import type { GasboostOptions } from "./gasboost";

type LocalRpc = NonNullable<GasboostOptions["localRpc"]>;
type Endpoint = { host?: string; port?: number };

export function firebaseEndpoint(options: Endpoint, defaultPort: number) {
  const host = options.host === "::1" ? "[::1]" : (options.host ?? "127.0.0.1");
  const port = options.port ?? defaultPort;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
    throw new Error(
      `Firebase Emulator host must be a loopback address: ${host}`,
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Firebase Emulator port: ${port}`);
  }
  return { host, port };
}

export function createFirebaseModule(
  original: string,
  kind: "auth" | "database",
  options: NonNullable<LocalRpc["auth"]>["emulator"] & { namespace?: string },
): string {
  const endpoint = firebaseEndpoint(options, kind === "auth" ? 9099 : 9000);
  if (kind === "database" && !options.namespace?.trim()) {
    throw new Error("Firebase RTDB Emulator namespace must not be empty.");
  }
  const moduleId = JSON.stringify(original);
  // Keep connection records across virtual-module reloads, using SDK instances
  // as weak keys. A changed endpoint requires a page reload, never a fallback.
  const common = `
export * from ${moduleId};
const key = Symbol.for("gasboost.firebase.${kind}.emulators");
const connected = globalThis[key] ??= new WeakMap();
const configuration = ${JSON.stringify(JSON.stringify({ ...endpoint, namespace: options.namespace }))};
function connect(instance) {
  const previous = connected.get(instance);
  if (previous !== undefined) {
    if (previous !== configuration) throw new Error("Firebase Emulator settings changed; reload the page.");
    return instance;
  }
`;
  if (kind === "auth") {
    return `
import { getAuth as originalGetAuth, initializeAuth as originalInitializeAuth, connectAuthEmulator } from ${moduleId};
${common}
  connectAuthEmulator(instance, ${JSON.stringify(`http://${endpoint.host}:${endpoint.port}`)});
  connected.set(instance, configuration);
  return instance;
}
export function getAuth(...args) { return connect(originalGetAuth(...args)); }
export function initializeAuth(...args) { return connect(originalInitializeAuth(...args)); }
`;
  }
  return `
import { getDatabase as originalGetDatabase, connectDatabaseEmulator } from ${moduleId};
${common}
  connectDatabaseEmulator(instance, ${JSON.stringify(endpoint.host)}, ${endpoint.port});
  connected.set(instance, configuration);
  return instance;
}
export function getDatabase(...args) {
  const database = originalGetDatabase(...args);
  const databaseUrl = args[1] || database.app.options.databaseURL || (database.app.options.projectId + "-default-rtdb.firebaseio.com");
  const url = new URL(databaseUrl.includes("://") ? databaseUrl : "https://" + databaseUrl);
  const namespace = url.searchParams.get("ns") ?? url.hostname.split(".")[0];
  if (namespace !== ${JSON.stringify(options.namespace)}) {
    throw new Error("Firebase RTDB Emulator namespace mismatch: databaseURL=" + url + ", expected=" + ${JSON.stringify(options.namespace)});
  }
  return connect(database);
}
`;
}
