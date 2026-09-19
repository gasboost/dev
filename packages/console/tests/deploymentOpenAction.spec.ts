import { describe, expect, it } from "vitest";
import { deployedWebAppUrl, syncDeploymentOpenAction } from "../ui/src/deploymentOpenAction.js";

describe("deployment open action", () => {
  it("enables Open for a Web App deployment", () => {
    const button = { disabled: true };

    syncDeploymentOpenAction("webapp", "AKfycb123", button);

    expect(button.disabled).toBe(false);
    expect(deployedWebAppUrl("webapp", "AKfycb123")).toBe(
      "https://script.google.com/macros/s/AKfycb123/exec",
    );
  });

  it("disables Open for an API Executable deployment", () => {
    const button = { disabled: false };

    syncDeploymentOpenAction("executionApi", "AKfycb123", button);

    expect(button.disabled).toBe(true);
    expect(deployedWebAppUrl("executionApi", "AKfycb123")).toBeUndefined();
  });

  it("disables Open when no deployment ID is available", () => {
    const button = { disabled: false };

    syncDeploymentOpenAction("webapp", "  ", button);

    expect(button.disabled).toBe(true);
  });
});
