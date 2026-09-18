export function installDialogControls(root: Document = document): void {
  for (const closeButton of root.querySelectorAll<HTMLElement>("[data-close-dialog]")) {
    closeButton.addEventListener("click", () => {
      const dialogId = closeButton.dataset.closeDialog;
      if (dialogId === undefined) return;
      const dialog = root.getElementById(dialogId);
      if (hasClose(dialog)) dialog.close();
    });
  }
}

function hasClose(value: unknown): value is { readonly close: () => void } {
  return typeof value === "object" && value !== null && "close" in value && typeof value.close === "function";
}
