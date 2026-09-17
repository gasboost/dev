import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("gasboost CLI E2E", () => {
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

  it("gasboost rtdb rulesでSecurity Rulesを生成する", async () => {
    const root = await mkdtemp(join(process.cwd(), ".gasboost-cli-e2e-"));

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
  rtdb: {
    source: "./src/rtdb.ts",
    out: "./database.rules.json",
  },
};
`.trimStart(),
      "utf8",
    );

    const result = await new Promise<{
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), "dist", "bin.js"), "rtdb", "rules"],
        {
          cwd: root,
          env: process.env,
        },
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);

      child.on("close", (code) => {
        resolve({
          code,
          stdout,
          stderr,
        });
      });
    });

    expect(result.code).toBe(0);

    expect(result.stderr).toBe("");

    expect(result.stdout).toContain("Firebase RTDB Security Rules generated:");

    const output = await readFile(join(root, "database.rules.json"), "utf8");

    expect(output).toContain("deals");

    expect(output).toContain("ownerId");

    expect(output).toContain("auth.uid");
  });

  it("projectability errorではexit code 1を返す", async () => {
    const root = await mkdtemp(join(process.cwd(), ".gasboost-cli-e2e-"));

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
    status: z.string(),
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
  literal,
  or,
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
      using: or(
        eq(
          column(
            deals,
            "ownerId",
          ),
          principal(
            principalSchema,
            "userId",
          ),
        ),
        eq(
          column(
            deals,
            "status",
          ),
          literal("public"),
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
  rtdb: {
    source: "./src/rtdb.ts",
    out: "./database.rules.json",
  },
};
`.trimStart(),
      "utf8",
    );

    const result = await new Promise<{
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), "dist", "bin.js"), "rtdb", "rules"],
        {
          cwd: root,
          env: process.env,
        },
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);

      child.on("close", (code) => {
        resolve({
          code,
          stdout,
          stderr,
        });
      });
    });

    expect(result.code).toBe(1);

    expect(result.stdout).toBe("");

    expect(result.stderr).toContain(
      "uses or(), which cannot be projected to a single RTDB subscription scope.",
    );

    await expect(
      readFile(join(root, "database.rules.json"), "utf8"),
    ).rejects.toThrow();
  });
});
