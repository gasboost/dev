import { initializeApp } from "firebase/app";
import * as auth from "firebase/auth";
import * as database from "firebase/database";
import * as originalAuth from "fixture:original-auth";
import * as originalDatabase from "fixture:original-database";

const config = {
  apiKey: "demo-api-key",
  authDomain: "demo-gasboost.firebaseapp.com",
  databaseURL: "https://demo-gasboost.firebaseio.com",
  projectId: "demo-gasboost",
  appId: "demo-app-id",
};
const app = initializeApp(config);
const firebaseAuth = auth.getAuth(app);
const firebaseDatabase = database.getDatabase(app);
const second = initializeApp(config, "second");
const initialized = auth.initializeAuth(second, {
  persistence: auth.inMemoryPersistence,
});

Object.assign(window, {
  fixture: {
    app,
    auth,
    database,
    firebaseAuth,
    firebaseDatabase,
    initialized,
    identity:
      firebaseAuth === originalAuth.getAuth(app) &&
      firebaseDatabase === originalDatabase.getDatabase(app) &&
      firebaseAuth === auth.getAuth(app) &&
      initialized === auth.getAuth(second) &&
      initialized ===
        auth.initializeAuth(second, {
          persistence: auth.inMemoryPersistence,
        }) &&
      firebaseDatabase === database.getDatabase(app) &&
      firebaseAuth === auth.getAuth() &&
      firebaseDatabase === database.getDatabase(),
    exports:
      auth.signInWithCustomToken === originalAuth.signInWithCustomToken &&
      database.ref === originalDatabase.ref &&
      database.onValue === originalDatabase.onValue,
    async signIn() {
      return (await auth.signInWithCustomToken(firebaseAuth, "custom-token"))
        .user.uid;
    },
    value() {
      return new Promise((resolve, reject) => {
        database.onValue(
          database.ref(firebaseDatabase, "counter"),
          (snapshot) => resolve(snapshot.val()),
          reject,
          { onlyOnce: true },
        );
      });
    },
    mismatch() {
      return database.getDatabase(app, "https://other.firebaseio.com");
    },
    explicitUrl() {
      const third = initializeApp(config, "explicit-url");
      const db = database.getDatabase(third, config.databaseURL);
      return db === originalDatabase.getDatabase(third, config.databaseURL);
    },
    lateAuth() {
      const late = originalAuth.initializeAuth(
        initializeApp(config, "late-auth"),
      );
      void originalAuth
        .signInWithCustomToken(late, "custom-token")
        .catch(() => {});
      return auth.getAuth(late.app);
    },
    lateDatabase() {
      const late = originalDatabase.getDatabase(
        initializeApp(config, "late-database"),
      );
      originalDatabase.ref(late, "counter");
      return database.getDatabase(late.app);
    },
  },
});
