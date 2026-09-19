import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FirebaseProjectState = {
  readonly enabled: boolean;
  readonly projectId?: string;
  readonly firebaseJson: boolean;
  readonly firebaserc: boolean;
};

export class FirebaseProjectRepository {
  public readonly projectRoot: string;

  public constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  public async read(): Promise<FirebaseProjectState> {
    const [firebaseJson, rcProjectId] = await Promise.all([
      this.exists("firebase.json"),
      this.readFirebasercProjectId(),
    ]);

    return {
      enabled: firebaseJson || rcProjectId !== undefined,
      ...(rcProjectId === undefined ? {} : { projectId: rcProjectId }),
      firebaseJson,
      firebaserc: rcProjectId !== undefined,
    };
  }

  public async enable(): Promise<void> {
    if (!(await this.exists("firebase.json"))) {
      await writeFile(
        join(this.projectRoot, "firebase.json"),
        `${JSON.stringify({ database: { rules: "database.rules.json" } }, null, 2)}\n`,
        "utf8",
      );
    }
  }

  public async connect(projectId: string): Promise<void> {
    await this.enable();
    const current = (await this.readFirebasercObject()) ?? {};
    const projects =
      typeof current.projects === "object" &&
      current.projects !== null &&
      !Array.isArray(current.projects)
        ? (current.projects as Record<string, unknown>)
        : {};
    await writeFile(
      join(this.projectRoot, ".firebaserc"),
      `${JSON.stringify(
        { ...current, projects: { ...projects, default: projectId } },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  private async readFirebasercProjectId(): Promise<string | undefined> {
    const value = await this.readFirebasercObject();
    if (value === undefined) return undefined;
    const projects = value.projects;
    if (typeof projects !== "object" || projects === null || Array.isArray(projects)) {
      return undefined;
    }
    const projectMap = projects as Record<string, unknown>;
    return typeof projectMap.default === "string" ? projectMap.default : undefined;
  }

  private async readFirebasercObject(): Promise<Record<string, unknown> | undefined> {
    try {
      const value = JSON.parse(
        await readFile(join(this.projectRoot, ".firebaserc"), "utf8"),
      ) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Expected a JSON object.");
      }
      return value as Record<string, unknown>;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw new Error(".firebaserc exists but does not contain valid Firebase settings.", {
        cause: error,
      });
    }
  }

  private async exists(relativePath: string): Promise<boolean> {
    try {
      await readFile(join(this.projectRoot, relativePath), "utf8");
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}
