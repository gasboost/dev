import { describe, expect, it } from "vitest";
import { CAPABILITY_PROFILES } from "../src/capabilities.js";
import { createProjectFiles } from "../src/generator.js";
import { frontendRegistryItem } from "../src/registry.js";

describe("capability skeletons", () => {
  it.each(CAPABILITY_PROFILES)(
    "generates only selected foundations: %j",
    (capabilities) => {
      const generated = createProjectFiles({
        projectName: "my-app",
        capabilities,
      });
      const files = new Map(generated.map((file) => [file.path, file.content]));
      const pkg = JSON.parse(files.get("package.json")!);
      const contents = generated.map((file) => file.content).join("\n");
      for (const path of [
        "package.json",
        "vite.config.ts",
        "vitest.config.ts",
        "tests/mocks/runtime.ts",
        "src/backend/main.ts",
      ])
        expect(files.has(path)).toBe(true);
      expect(
        generated.some((file) =>
          /\.(test|spec)\.[cm]?[jt]sx?$/.test(file.path),
        ),
      ).toBe(false);
      expect(
        [...files.keys()].some((path) => path.startsWith("src/frontend/")),
      ).toBe(false);
      expect(files.has("components.json")).toBe(capabilities.frontend);
      expect(files.has("index.html")).toBe(capabilities.frontend);
      expect(files.has("src/backend/lib/sheets.ts")).toBe(
        capabilities.database,
      );
      expect(files.has("tests/mocks/db.ts")).toBe(capabilities.database);
      expect(files.has("src/backend/lib/bootstrap.ts")).toBe(
        capabilities.authentication,
      );
      expect(files.has("src/backend/lib/firebase.ts")).toBe(
        capabilities.realtime,
      );
      expect(contents).not.toMatch(
        /itemsTable|\.call\("hello"|getApplicationStatus|--mode (server|client)|HtmlService.*(?:vi\.|mock)/,
      );
      expect(pkg.scripts.test).toContain("--passWithNoTests");
      expect(pkg.scripts["build:server"]).toContain("BUILD_TARGET=server");
      expect(files.get("gasboost.config.ts")).toContain(
        'from "@gasboost/config"',
      );
      if (!capabilities.database)
        expect(pkg.dependencies["@gasboost/sheetorm"]).toBeUndefined();
      if (!capabilities.authentication)
        expect(pkg.dependencies["@gasboost/auth"]).toBeUndefined();
      if (!capabilities.realtime) expect(contents).not.toContain("firebase");
      if (capabilities.database) {
        expect(files.get("src/backend/lib/db.ts")).toContain('from "./sheets"');
        expect(files.get("tests/mocks/db.ts")).toContain("importOriginal");
        expect(files.get("tests/mocks/db.ts")).not.toContain(
          'vi.mock("../../src/backend/lib/db"',
        );
      }
    },
  );
  it("selects exactly one complete registry item for each frontend profile", () => {
    expect(CAPABILITY_PROFILES.map(frontendRegistryItem)).toEqual([
      undefined,
      "gasboost/ui/frontend",
      undefined,
      "gasboost/ui/frontend",
      undefined,
      "gasboost/ui/frontend-auth",
      "gasboost/ui/frontend-auth-realtime",
    ]);
    expect(
      frontendRegistryItem({
        database: false,
        authentication: false,
        frontend: false,
        realtime: true,
      }),
    ).toBe("gasboost/ui/frontend-auth-realtime");
  });
});
