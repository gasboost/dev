import { describe, expect, it, vi } from "vitest";
import {
  installFirebaseProjectActionRefresh,
  syncFirebaseProjectActions,
} from "../ui/src/firebaseProjectActions.js";

describe("Firebase project UI actions", () => {
  it("認証済みかつProject ID入力済みのときcreate/connectを有効化する", () => {
    const projectId = { value: " my-app " };
    const create = { disabled: true };
    const connect = { disabled: true };

    syncFirebaseProjectActions(
      { authenticated: true },
      projectId,
      create,
      connect,
    );

    expect(create.disabled).toBe(false);
    expect(connect.disabled).toBe(false);
  });

  it("Project IDを空に戻すとcreate/connectを無効化する", () => {
    const projectId = { value: "   " };
    const create = { disabled: false };
    const connect = { disabled: false };

    syncFirebaseProjectActions(
      { authenticated: true },
      projectId,
      create,
      connect,
    );

    expect(create.disabled).toBe(true);
    expect(connect.disabled).toBe(true);
  });

  it("未ログインではProject ID入力済みでもcreate/connectを無効のままにする", () => {
    const projectId = { value: "my-app" };
    const create = { disabled: false };
    const connect = { disabled: false };

    syncFirebaseProjectActions(
      { authenticated: false },
      projectId,
      create,
      connect,
    );

    expect(create.disabled).toBe(true);
    expect(connect.disabled).toBe(true);
  });

  it("Project ID入力時にaction stateを再評価する", () => {
    const updateActions = vi.fn();
    const projectId = fakeInput();

    installFirebaseProjectActionRefresh(projectId, updateActions);
    projectId.input();

    expect(updateActions).toHaveBeenCalledOnce();
  });
});

function fakeInput(): {
  readonly value: string;
  readonly addEventListener: HTMLInputElement["addEventListener"];
  readonly input: () => void;
} {
  let inputListener: (() => void) | undefined;
  return {
    value: "",
    addEventListener(event: string, listener: EventListenerOrEventListenerObject) {
      if (event === "input" && typeof listener === "function") {
        inputListener = () => listener(new Event("input"));
      }
    },
    input() {
      inputListener?.();
    },
  };
}
