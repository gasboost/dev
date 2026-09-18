import { describe, expect, it, vi } from "vitest";
import { CommandRouter } from "../src/cli/CommandRouter.js";

describe("CommandRouter", () => {
  it("rtdb rules commandを実行する", async () => {
    const execute = vi.fn(async () => "/project/database.rules.json");

    const router = new CommandRouter({
      consoleOpenCommand: { execute: vi.fn() } as never,
      rtdbRulesCommand: { execute } as never,
    });

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
      consoleOpenCommand: { execute: vi.fn() } as never,
      rtdbRulesCommand: { execute } as never,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await router.route([]);

    expect(execute).not.toHaveBeenCalled();

    expect(log).toHaveBeenCalledWith(
      ["Usage:", "  gasboost console open", "  gasboost rtdb rules"].join("\n"),
    );

    log.mockRestore();
  });

  it("未知のcommandは失敗する", async () => {
    const execute = vi.fn();

    const router = new CommandRouter({
      consoleOpenCommand: { execute: vi.fn() } as never,
      rtdbRulesCommand: { execute } as never,
    });

    await expect(router.route(["unknown"])).rejects.toThrow(
      "Unknown command: unknown",
    );
  });

  it("console open commandを実行する", async () => {
    const execute = vi.fn(async () => "http://127.0.0.1:3000");
    const router = new CommandRouter({
      consoleOpenCommand: { execute } as never,
      rtdbRulesCommand: { execute: vi.fn() } as never,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await router.route(["console", "open"]);

    expect(execute).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "Gasboost Console opened: http://127.0.0.1:3000",
    );
    log.mockRestore();
  });
});
