import { expect, expectTypeOf, test } from "vitest";

import { gasboost, type GasboostOptions } from "../src";

test("@gasboost/viteからgasboostをexportする", () => {
  expect(gasboost).toBeTypeOf("function");
});

test("GasboostOptionsのentryは必須", () => {
  expectTypeOf<GasboostOptions["entry"]>().toEqualTypeOf<string>();
});

test("GasboostOptionsのenvDirはoptional", () => {
  const options: GasboostOptions = {
    entry: "src/main.ts",
  };

  expect(options.envDir).toBeUndefined();
});

test("envDirを指定できる", () => {
  const options: GasboostOptions = {
    entry: "src/main.ts",
    envDir: "config",
  };

  expect(options.envDir).toBe("config");
});

test("localRpc.overrideを指定できる", () => {
  const options: GasboostOptions = {
    entry: "src/main.ts",
    localRpc: {
      override: false,
    },
  };

  expect(options.localRpc?.override).toBe(false);
});

test("localRpc.databaseに型付きレコードと空テーブルを指定できる", () => {
  const users: { id: string; enabled: boolean }[] = [
    { id: "u-1", enabled: true },
  ];
  const options: GasboostOptions = {
    entry: "src/main.ts",
    localRpc: {
      override: false,
      database: { primary: { users, products: [] } },
    },
  };

  expect(options.localRpc?.database?.primary.users).toEqual(users);
});

test("build と dev を返す", () => {
  const { build, dev } = gasboost({
    entry: "src/server.ts",
  });

  expect(build.name).toBe("gasboost:build");
  expect(dev.name).toBe("gasboost:dev");
});

test("dev は serve のみで動作する", () => {
  const { dev } = gasboost({
    entry: "src/server.ts",
  });

  expect(dev.apply).toBe("serve");
});

test("build は build のみで動作する", () => {
  const { build } = gasboost({
    entry: "src/server.ts",
  });

  expect(build.apply).toBe("build");
});
