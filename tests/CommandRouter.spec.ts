import { describe, expect, it, vi } from "vitest";
import { CommandRouter } from "../src/cli/CommandRouter.js";

describe("CommandRouter", () => {
  it("rtdb rules commandを実行する", async () => {
    const execute = vi.fn(async () => "/project/database.rules.json");

    const router = new CommandRouter({
      execute,
    } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await router.route(["rtdb", "rules"]);

    expect(execute).toHaveBeenCalledOnce();

    expect(log).toHaveBeenCalledWith(
      "Firebase RTDB Security Rules generated: /project/database.rules.json",
    );

    log.mockRestore();
  });

  it("引数なしではhelpを表示する", async () => {
    const execute = vi.fn();

    const router = new CommandRouter({
      execute,
    } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await router.route([]);

    expect(execute).not.toHaveBeenCalled();

    expect(log).toHaveBeenCalledWith(
      ["Usage:", "  gasboost rtdb rules"].join("\n"),
    );

    log.mockRestore();
  });

  it("未知のcommandは失敗する", async () => {
    const execute = vi.fn();

    const router = new CommandRouter({
      execute,
    } as never);

    await expect(router.route(["unknown"])).rejects.toThrow(
      "Unknown command: unknown",
    );
  });
});
