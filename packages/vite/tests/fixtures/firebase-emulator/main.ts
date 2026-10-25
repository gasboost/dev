import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken, signOut } from "firebase/auth";
import { getDatabase, ref, onValue, set } from "firebase/database";

// The Consumer's normal initialization code: no dev checks or Emulator calls.
const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDatabase = getDatabase(firebaseApp);

const values: unknown[] = [];
const errors: string[] = [];
Object.assign(window, {
  emulatorE2e: {
    values,
    errors,
    async signIn(token: string) {
      await signOut(firebaseAuth);
      return (await signInWithCustomToken(firebaseAuth, token)).user.uid;
    },
    read() {
      return new Promise((resolve, reject) => {
        onValue(
          ref(firebaseDatabase, "syncVersions/employees"),
          (snapshot) => resolve(snapshot.val()),
          reject,
          { onlyOnce: true },
        );
      });
    },
    async write() {
      await set(ref(firebaseDatabase, "syncVersions/employees"), 999);
    },
    watch() {
      onValue(
        ref(firebaseDatabase, "syncVersions/employees"),
        (snapshot) => values.push(snapshot.val()),
        (error) => errors.push(error.message),
      );
    },
  },
});
