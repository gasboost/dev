export type ProjectFragment = {
  readonly files?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
};

export type MergedProjectFragment = {
  readonly files: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly scripts: Record<string, string>;
};

export function mergeProjectFragments(
  fragments: readonly ProjectFragment[],
): MergedProjectFragment {
  const result: MergedProjectFragment = {
    files: {},
    dependencies: {},
    devDependencies: {},
    scripts: {},
  };

  for (const fragment of fragments) {
    mergeEntries(result.files, fragment.files, "file");
    mergeEntries(result.dependencies, fragment.dependencies, "dependency");
    mergeEntries(
      result.devDependencies,
      fragment.devDependencies,
      "devDependency",
    );
    mergeEntries(result.scripts, fragment.scripts, "script");
  }

  for (const name of Object.keys(result.dependencies)) {
    if (name in result.devDependencies) {
      throw new Error(
        `Package '${name}' is defined as both a dependency and a devDependency.`,
      );
    }
  }

  return result;
}

function mergeEntries(
  target: Record<string, string>,
  source: Readonly<Record<string, string>> | undefined,
  kind: string,
): void {
  if (source === undefined) {
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    const current = target[key];

    if (current !== undefined && current !== value) {
      throw new Error(
        `Conflicting ${kind} '${key}': '${current}' and '${value}'.`,
      );
    }

    target[key] = value;
  }
}
