import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { GeneratedFile } from "./generator.js";

export async function assertEmptyProjectDirectory(
  targetDirectory: string,
): Promise<void> {
  const root = resolve(targetDirectory);

  try {
    const stats = await lstat(root);

    if (!stats.isDirectory()) {
      throw new Error(
        `Target path already exists and is not a directory: ${root}`,
      );
    }

    const entries = await readdir(root);

    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${root}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export async function writeProjectFiles({
  targetDirectory,
  files,
}: {
  readonly targetDirectory: string;
  readonly files: readonly GeneratedFile[];
}): Promise<void> {
  const root = resolve(targetDirectory);

  await assertEmptyProjectDirectory(root);
  await mkdir(root, { recursive: true });

  for (const file of files) {
    const destination = resolve(root, file.path);

    if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
      throw new Error(
        `Generated file path escapes the project directory: ${file.path}`,
      );
    }

    await mkdir(dirname(destination), {
      recursive: true,
    });

    await writeFile(destination, file.content, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}
