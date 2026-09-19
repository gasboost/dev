import {
  normalizeCapabilities,
  type CapabilitySelection,
} from "./capabilities.js";
import { mergeProjectFragments, type ProjectFragment } from "./fragment.js";
import { authFragment } from "./templates/auth.js";
import { baseFragment } from "./templates/base.js";
import { databaseFragment } from "./templates/database.js";
import { frontendFragment } from "./templates/frontend.js";
import { realtimeFragment } from "./templates/realtime.js";

export type GeneratedFile = {
  readonly path: string;
  readonly content: string;
};

export function createProjectFiles({
  projectName,
  capabilities: requestedCapabilities,
}: {
  readonly projectName: string;
  readonly capabilities: CapabilitySelection;
}): readonly GeneratedFile[] {
  const capabilities = normalizeCapabilities(requestedCapabilities);

  const fragments: ProjectFragment[] = [baseFragment(capabilities)];

  if (capabilities.database) {
    fragments.push(
      databaseFragment({
        authentication: capabilities.authentication,
      }),
    );
  }

  if (capabilities.authentication) {
    fragments.push(
      authFragment({
        realtime: capabilities.realtime,
      }),
    );
  }

  if (capabilities.frontend) {
    fragments.push(frontendFragment());
  }

  if (capabilities.realtime) {
    fragments.push(
      realtimeFragment({
        projectName,
      }),
    );
  }

  const merged = mergeProjectFragments(fragments);

  const packageJson = renderPackageJson({
    projectName,
    dependencies: merged.dependencies,
    devDependencies: merged.devDependencies,
    scripts: merged.scripts,
  });

  const files = {
    ...merged.files,
    "package.json": packageJson,
  };

  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({
      path,
      content: ensureTrailingNewline(content),
    }));
}

function renderPackageJson({
  projectName,
  dependencies,
  devDependencies,
  scripts,
}: {
  readonly projectName: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
}): string {
  return `${JSON.stringify(
    {
      name: projectName,
      private: true,
      type: "module",
      scripts: sortRecord(scripts),
      dependencies: sortRecord(dependencies),
      devDependencies: sortRecord(devDependencies),
      engines: {
        node: ">=24",
      },
      packageManager: "pnpm@10.18.0",
    },
    null,
    2,
  )}\n`;
}

function sortRecord(
  record: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
