import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGasboostConfig, ModuleLoader } from "@gasboost/config";
import { RtdbRulesCommand } from "../src/rtdb/RtdbRulesCommand.js";
import { RtdbRulesWriter } from "../src/rtdb/RtdbRulesWriter.js";

describe("gasboost rtdb rules integration", () => {
  const directories: string[] = [];

  afterEach(async () => {
    for (const directory of directories) {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }

    directories.length = 0;
  });

  it("RLSからFirebase RTDB Security Rulesを生成する", async () => {
    const root = await mkdtemp(join(process.cwd(), ".gasboost-cli-rtdb-"));

    directories.push(root);

    await mkdir(join(root, "src"), {
      recursive: true,
    });

    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["./src/*"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      join(root, "src", "tables.ts"),
      `
import { z } from "zod";

export const principalSchema = z.object({
  userId: z.string(),
});

export const deals = {
  name: "deals",
  schema: z.object({
    id: z.string(),
    ownerId: z.string(),
    title: z.string(),
  }),
  primaryKey: "id",
} as const;
`.trimStart(),
      "utf8",
    );

    await writeFile(
      join(root, "src", "security.ts"),
      `
import {
  column,
  eq,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import {
  deals,
  principalSchema,
} from "@/tables";

export const dealSecurity =
  new RowLevelSecurity({
    table: deals,

    select: {
      using: eq(
        column(
          deals,
          "ownerId",
        ),
        principal(
          principalSchema,
          "userId",
        ),
      ),
    },

    insert: {
      check: eq(
        column(
          deals,
          "ownerId",
        ),
        principal(
          principalSchema,
          "userId",
        ),
      ),
    },

    update: {
      using: eq(
        column(
          deals,
          "ownerId",
        ),
        principal(
          principalSchema,
          "userId",
        ),
      ),

      check: eq(
        column(
          deals,
          "ownerId",
        ),
        principal(
          principalSchema,
          "userId",
        ),
      ),
    },

    delete: {
      using: eq(
        column(
          deals,
          "ownerId",
        ),
        principal(
          principalSchema,
          "userId",
        ),
      ),
    },
  });
`.trimStart(),
      "utf8",
    );

    await writeFile(
      join(root, "src", "rtdb.ts"),
      `
import {
  FirebaseRtdb,
} from "@gasboost/realtime-firebase";
import {
  deals,
} from "@/tables";
import {
  dealSecurity,
} from "@/security";

export const rtdb =
  FirebaseRtdb.generate({
    tables: [
      deals,
    ] as const,

    rowLevelSecurity: [
      dealSecurity,
    ],

    principal: {
      userId: "auth.uid",
    },
  });
`.trimStart(),
      "utf8",
    );

    await writeFile(
      join(root, "gasboost.config.ts"),
      `
export default {
  firebase: {
    realtimeDatabase: {
      source: "./src/rtdb.ts",
      out: "./database.rules.json",
    },
  },
};
`.trimStart(),
      "utf8",
    );

    const moduleLoader = new ModuleLoader(root);

    const command = new RtdbRulesCommand({
      loadConfig: () => loadGasboostConfig({ projectRoot: root }),
      moduleLoader,
      writer: new RtdbRulesWriter(root),
    });

    const outputPath = await command.execute();

    expect(outputPath).toBe(join(root, "database.rules.json"));

    const output = await readFile(outputPath, "utf8");

    const rules = JSON.parse(output) as {
      readonly rules: unknown;
    };

    expect(rules).toHaveProperty("rules");

    expect(output).toContain("deals");

    expect(output).toContain("ownerId");

    expect(output).toContain("auth.uid");
  });
});
