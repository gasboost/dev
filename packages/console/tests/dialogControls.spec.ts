import { describe, expect, it, vi } from "vitest";
import { installDialogControls } from "../ui/src/dialogControls.js";

describe("dialog controls", () => {
  it("data-close-dialog button clickで対象dialogだけを閉じる", () => {
    const close = vi.fn();
    const otherClose = vi.fn();
    const button = fakeButton("push-dialog");
    const document = fakeDocument([button], {
      "push-dialog": { close },
      "deployment-dialog": { close: otherClose },
    });

    installDialogControls(document);
    button.click();

    expect(close).toHaveBeenCalledOnce();
    expect(otherClose).not.toHaveBeenCalled();
  });
});

function fakeButton(dialogId: string): {
  readonly dataset: { readonly closeDialog: string };
  readonly addEventListener: (event: string, listener: () => void) => void;
  readonly click: () => void;
} {
  let clickListener: (() => void) | undefined;
  return {
    dataset: { closeDialog: dialogId },
    addEventListener(event, listener) {
      if (event === "click") clickListener = listener;
    },
    click() {
      clickListener?.();
    },
  };
}

function fakeDocument(
  buttons: readonly ReturnType<typeof fakeButton>[],
  elements: Record<string, { readonly close: () => void }>,
): Document {
  return {
    querySelectorAll: () => buttons,
    getElementById: (id: string) => elements[id] ?? null,
  } as unknown as Document;
}
