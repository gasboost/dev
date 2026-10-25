import type { GasboostOptions } from "./gasboost";

type Emulator = NonNullable<
  NonNullable<GasboostOptions["localRpc"]>["rtdb"]
>["emulator"];

export function createRtdbModule(
  originalModule: string,
  emulatorModule: string,
  options: Emulator,
): string {
  return `
export * from ${JSON.stringify(originalModule)};
import { FirebaseRtdbEmulatorTransport } from ${JSON.stringify(emulatorModule)};

export class FirebaseRtdbRestTransport extends FirebaseRtdbEmulatorTransport {
  constructor(config) {
    super({
      urlFetchApp: config.urlFetchApp,
      databaseName: ${JSON.stringify(options.namespace)},
      host: ${JSON.stringify(options.host)},
      port: ${JSON.stringify(options.port)},
    });
  }

  patch(updates) {
    try {
      super.patch(updates);
    } catch (cause) {
      throw new Error(
        ${JSON.stringify(`Local RPC RTDB Emulator PATCH failed (${options.host ?? "127.0.0.1"}:${options.port ?? 9000}, namespace=${options.namespace}): `)} +
        (cause instanceof Error ? cause.message : String(cause)),
        { cause },
      );
    }
  }
}
`;
}
