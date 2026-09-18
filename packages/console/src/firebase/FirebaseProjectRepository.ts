import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FirebaseProjectState = {
  readonly enabled: boolean;
  readonly projectId?: string;
  readonly firebaseJson: boolean;
  readonly firebaserc: boolean;
};

export class FirebaseProjectRepository {
  private readonly projectRoot: string;

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
    await writeFile(
      join(this.projectRoot, ".firebaserc"),
      `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`,
      "utf8",
    );
  }

  private async readFirebasercProjectId(): Promise<string | undefined> {
    try {
      const value = JSON.parse(
        await readFile(join(this.projectRoot, ".firebaserc"), "utf8"),
      ) as { readonly projects?: { readonly default?: unknown } };
      return typeof value.projects?.default === "string"
        ? value.projects.default
        : undefined;
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
