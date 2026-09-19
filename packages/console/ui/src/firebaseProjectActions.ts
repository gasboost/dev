type FirebaseProjectStatus = {
  readonly authenticated: boolean;
};

type FirebaseProjectInput = Pick<HTMLInputElement, "value" | "addEventListener">;
type FirebaseProjectButton = Pick<HTMLButtonElement, "disabled">;

export function installFirebaseProjectActionRefresh(
  firebaseProjectId: FirebaseProjectInput,
  updateActions: () => void,
): void {
  firebaseProjectId.addEventListener("input", updateActions);
}

export function syncFirebaseProjectActions(
  status: FirebaseProjectStatus | undefined,
  firebaseProjectId: Pick<HTMLInputElement, "value">,
  firebaseProjectCreate: FirebaseProjectButton,
  firebaseConnect: FirebaseProjectButton,
): void {
  const firebaseAuthenticated = status?.authenticated === true;
  const firebaseProjectInput = firebaseProjectId.value.trim();
  firebaseProjectCreate.disabled =
    !firebaseAuthenticated || firebaseProjectInput.length === 0;
  firebaseConnect.disabled =
    !firebaseAuthenticated || firebaseProjectInput.length === 0;
}
