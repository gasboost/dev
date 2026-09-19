import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PROFILES,
  normalizeCapabilities,
} from "../src/capabilities.js";

describe("normalizeCapabilities", () => {
  it("Authentication enables Database", () => {
    expect(
      normalizeCapabilities({
        database: false,
        authentication: true,
        frontend: false,
        realtime: false,
      }),
    ).toEqual({
      database: true,
      authentication: true,
      frontend: false,
      realtime: false,
    });
  });

  it("Realtime enables Database, Authentication and Frontend", () => {
    expect(
      normalizeCapabilities({
        database: false,
        authentication: false,
        frontend: false,
        realtime: true,
      }),
    ).toEqual({
      database: true,
      authentication: true,
      frontend: true,
      realtime: true,
    });
  });

  it("defines exactly seven normalized profiles", () => {
    expect(CAPABILITY_PROFILES).toHaveLength(7);

    const profiles = new Set(
      CAPABILITY_PROFILES.map((profile) => JSON.stringify(profile)),
    );

    expect(profiles.size).toBe(7);

    for (const profile of CAPABILITY_PROFILES) {
      expect(normalizeCapabilities(profile)).toEqual(profile);
    }
  });
});
