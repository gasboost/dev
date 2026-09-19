import { basename, resolve } from "node:path";

export function projectNameFromTarget(targetDirectory: string): string {
  const directoryName = basename(resolve(targetDirectory));

  const normalized = directoryName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/g, "")
    .replace(/[._-]+$/g, "");

  return normalized.length > 0 ? normalized : "gasboost-app";
}
