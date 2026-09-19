export type CapabilitySelection = {
  readonly database: boolean;
  readonly authentication: boolean;
  readonly frontend: boolean;
  readonly realtime: boolean;
};

export const CAPABILITY_PROFILES = [
  {
    database: false,
    authentication: false,
    frontend: false,
    realtime: false,
  },
  {
    database: false,
    authentication: false,
    frontend: true,
    realtime: false,
  },
  {
    database: true,
    authentication: false,
    frontend: false,
    realtime: false,
  },
  {
    database: true,
    authentication: false,
    frontend: true,
    realtime: false,
  },
  {
    database: true,
    authentication: true,
    frontend: false,
    realtime: false,
  },
  {
    database: true,
    authentication: true,
    frontend: true,
    realtime: false,
  },
  {
    database: true,
    authentication: true,
    frontend: true,
    realtime: true,
  },
] as const satisfies readonly CapabilitySelection[];

export function normalizeCapabilities(
  selection: CapabilitySelection,
): CapabilitySelection {
  const realtime = selection.realtime;

  const authentication = selection.authentication || realtime;

  const frontend = selection.frontend || realtime;

  const database = selection.database || authentication || realtime;

  return {
    database,
    authentication,
    frontend,
    realtime,
  };
}
