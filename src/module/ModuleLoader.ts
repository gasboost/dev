import { createJiti } from "jiti";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export class ModuleLoader {
  private readonly projectRoot: string;

  private readonly jiti: ReturnType<typeof createJiti>;

  public constructor(projectRoot: string) {
    this.projectRoot = projectRoot;

    this.jiti = createJiti(
      pathToFileURL(resolve(projectRoot, "gasboost.config.ts")).href,
      {
        tsconfigPaths: true,
      },
    );
  }

  public async import<T extends object>(path: string): Promise<T> {
    const modulePath = resolve(this.projectRoot, path);

    return (await this.jiti.import(modulePath)) as T;
  }
}
