import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const managedKeys = new Set([
  "GAS_SCRIPT_ID",
  "FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
  "DEPLOYMENT_ID",
]);

export type RuntimeIdentifiers = {
  readonly GAS_SCRIPT_ID?: string;
  readonly FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly DEPLOYMENT_ID?: string;
};

export class EnvFileRepository {
  private readonly path: string;

  public constructor(projectRoot: string) {
    this.path = join(projectRoot, ".env");
  }

  public async read(): Promise<RuntimeIdentifiers> {
    const content = await this.readContent();
    const values: Record<string, string> = {};

    for (const line of content.split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      const key = match?.[1];
      const value = match?.[2];
      if (key === undefined || value === undefined || !managedKeys.has(key)) continue;
      values[key] = value;
    }

    return values;
  }

  public async update(values: RuntimeIdentifiers): Promise<void> {
    const updates = Object.entries(values).filter(
      (entry): entry is [keyof RuntimeIdentifiers, string] =>
        entry[1] !== undefined && managedKeys.has(entry[0]),
    );
    if (updates.length === 0) return;

    const content = await this.readContent();
    const lines = content.length === 0 ? [] : content.split(/\r?\n/);
    const seen = new Set<string>();
    const updatedLines: string[] = [];

    for (const line of lines) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
      const key = match?.[1] as keyof RuntimeIdentifiers | undefined;

      if (key === undefined || !(key in values) || values[key] === undefined) {
        updatedLines.push(line);
        continue;
      }

      if (seen.has(key)) continue;
      seen.add(key);
      updatedLines.push(`${key}=${values[key]}`);
    }

    for (const [key, value] of updates) {
      if (!seen.has(key)) updatedLines.push(`${key}=${value}`);
    }

    await writeFile(this.path, `${updatedLines.join("\n").replace(/\n*$/, "")}\n`, "utf8");
  }

  private async readContent(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return "";
      }
      throw error;
    }
  }
}
