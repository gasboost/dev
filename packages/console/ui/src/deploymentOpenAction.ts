export function deployedWebAppUrl(type: string, deploymentId: string): string | undefined {
  const id = deploymentId.trim();
  return type === "webapp" && id.length > 0
    ? `https://script.google.com/macros/s/${id}/exec`
    : undefined;
}

export function syncDeploymentOpenAction(
  type: string,
  deploymentId: string,
  button: Pick<HTMLButtonElement, "disabled">,
): void {
  button.disabled = deployedWebAppUrl(type, deploymentId) === undefined;
}
