import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  InMemoryCacheService,
  type InMemoryCacheServiceOptions,
} from "../index";

const scopes = [
  ["document", "getDocumentCache"],
  ["user", "getUserCache"],
  ["script", "getScriptCache"],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InMemoryCacheService", () => {
  it("ルートから初期データの型をimportできる", () => {
    expectTypeOf<
      ConstructorParameters<typeof InMemoryCacheService>[0]
    >().toEqualTypeOf<InMemoryCacheServiceOptions | undefined>();
  });

  it("引数なしでは各領域が空で、同じキーの値が領域間で混ざらない", () => {
    const service = new InMemoryCacheService();
    const caches = scopes.map(([, getter]) => service[getter]());

    for (const cache of caches) {
      expect(cache?.get("key")).toBeNull();
    }
    caches.forEach((cache, index) => cache?.put("key", String(index)));
    caches.forEach((cache, index) => {
      expect(cache?.get("key")).toBe(String(index));
    });
    expect(new Set(caches).size).toBe(3);
  });

  it("各領域の初期データを独立して設定できる", () => {
    const service = new InMemoryCacheService({
      document: { key: "document", documentOnly: "value" },
      user: { key: "user", userOnly: "value" },
      script: { key: "script", scriptOnly: "value" },
    });

    for (const [scope, getter] of scopes) {
      expect(
        service[getter]()?.getAll([
          "key",
          "documentOnly",
          "userOnly",
          "scriptOnly",
        ]),
      ).toEqual({ key: scope, [`${scope}Only`]: "value" });
    }
  });

  it.each(scopes)(
    "%sのCacheを再取得しても保存・変更・削除結果を共有する",
    (_scope, getter) => {
      const service = new InMemoryCacheService();
      const cache = service[getter]();
      expect(cache).not.toBeNull();
      expect(service[getter]()).toBe(cache);

      cache?.put("key", "original");
      expect(service[getter]()?.get("key")).toBe("original");
      service[getter]()?.put("key", "updated");
      expect(service[getter]()?.get("key")).toBe("updated");
      service[getter]()?.remove("key");
      expect(service[getter]()?.get("key")).toBeNull();
    },
  );

  it.each(scopes)(
    "%sのデータを別サービスや初期データと共有しない",
    (scope, getter) => {
      const initial = { key: "seed" };
      const options: InMemoryCacheServiceOptions = { [scope]: initial };
      const first = new InMemoryCacheService(options);
      const second = new InMemoryCacheService(options);
      initial.key = "changed input";

      expect(first[getter]()?.get("key")).toBe("seed");
      first[getter]()?.put("key", "updated");
      expect(second[getter]()?.get("key")).toBe("seed");
      first[getter]()?.remove("key");
      expect(second[getter]()?.get("key")).toBe("seed");
      expect(initial.key).toBe("changed input");
      expect(new InMemoryCacheService()[getter]()?.get("key")).toBeNull();
    },
  );

  it("初期データにも600秒のTTLを適用し、再取得で延長しない", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const service = new InMemoryCacheService({
      document: { key: "document" },
      user: { key: "user" },
      script: { key: "script" },
    });

    now.mockReturnValue(1000 + 599_999);
    for (const [scope, getter] of scopes) {
      expect(service[getter]()?.get("key")).toBe(scope);
    }
    now.mockReturnValue(1000 + 600_001);
    for (const [, getter] of scopes) {
      expect(service[getter]()?.get("key")).toBeNull();
    }
  });

  it.each(scopes)(
    "%sの初期データにもキー長と値サイズの検証を適用する",
    (scope) => {
      expect(
        () =>
          new InMemoryCacheService({
            [scope]: { ["k".repeat(251)]: "value" },
          }),
      ).toThrow("Argument too large: key");
      expect(
        () =>
          new InMemoryCacheService({
            [scope]: { key: "v".repeat(100 * 1024 + 1) },
          }),
      ).toThrow("Argument too large: value");
    },
  );
});
