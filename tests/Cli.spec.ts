import { describe, expect, it, vi } from "vitest";
import { Cli } from "../src/cli/Cli.js";

describe("Cli", () => {
  it("command成功時はexit code 0を返す", async () => {
    const route = vi.fn(async () => undefined);

    const cli = new Cli({
      route,
    } as never);

    await expect(cli.run(["rtdb", "rules"])).resolves.toBe(0);

    expect(route).toHaveBeenCalledWith(["rtdb", "rules"]);
  });

  it("command失敗時はerrorを表示してexit code 1を返す", async () => {
    const route = vi.fn(async () => {
      throw new Error("projectability error");
    });

    const cli = new Cli({
      route,
    } as never);

    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(cli.run(["rtdb", "rules"])).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith("projectability error");

    error.mockRestore();
  });
});
