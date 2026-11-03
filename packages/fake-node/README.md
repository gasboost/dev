# @gasboost/fake-node

Node.js fakes for Google Apps Script services, typed against
`@types/google-apps-script`. Includes `NodeUrlFetchApp`, `NodeUtilities`,
`NodeLockService`, `NodeLock`, and `createNodeLockState`.

## URL Fetch

```ts
import { NodeUrlFetchApp } from "@gasboost/fake-node";

const UrlFetchApp = new NodeUrlFetchApp();
const response = UrlFetchApp.fetch("https://example.com", {
  method: "post",
  contentType: "application/json",
  payload: JSON.stringify({ message: "hello" }),
});
console.log(response.getResponseCode());
console.log(response.getContentText());
```

## Synchronous LockService

```ts
import { NodeLockService } from "@gasboost/fake-node";

const LockService = new NodeLockService({
  scriptId: "test-script",
  userId: "user-1",
  documentId: "spreadsheet-1",
});
const lock = LockService.getScriptLock();
if (!lock.tryLock(1000)) throw new Error("Could not acquire script lock");
try {
  // Read/update shared state, e.g. a CacheService-backed table lock.
} finally {
  lock.releaseLock();
}
```

Services without `sharedState` share a module-local registry. The registry lasts
for the module lifetime; use an explicit state per test for isolation and bounded
memory. Different Workers have separate registries: constructing the same context
in each Worker alone does **not** create a shared lock.

`getScriptLock()` selects a script scope; `getUserLock()` selects a script/user
pair; `getDocumentLock()` selects a script/document pair, or returns `null` without
`documentId`. Different lock kinds are independent. Getters return fresh handles
without acquiring. Each handle tracks its own ownership; a different handle
cannot release it. Repeated getters/independent handles within a single GAS
execution have not been compared with GAS; this fake models them as contenders.

`tryLock(ms)` synchronously returns a boolean, while `waitLock(ms)` throws on
timeout. `hasLock()` reflects the handle's ownership. Reacquiring an owned handle
is a no-op and a single release unlocks it. Releasing an unowned or already released
handle is a no-op. These behaviors follow the official
[Lock documentation](https://developers.google.com/apps-script/reference/lock/lock).
Scopes and document absence follow the official
[LockService documentation](https://developers.google.com/apps-script/reference/lock/lock-service).

Timeouts supported by this fake are non-negative safe integer milliseconds;
`0` makes one immediate attempt. Other values throw `RangeError` on an unowned
handle. Negative/fractional/non-finite values, coercion, maximum GAS timeout,
GAS scheduling precision, and exact GAS exception messages have not been verified
against a GAS runtime and are outside the compatibility claim. Context IDs must
be non-empty strings, with `documentId` optional; these are fake configuration,
not GAS API parameters.

The upstream GAS type currently declares `getDocumentLock()` as non-nullable.
`NodeLockService` keeps a nullable first overload for direct callers and a
compatibility overload solely to implement that upstream interface. Assigning it
to `GoogleAppsScript.Lock.LockService` inherits the upstream typing limitation;
keep the concrete type when checking document absence. No global types are patched.

## Sharing locks between Worker Threads

Register all contexts before starting Workers:

```ts
import { createNodeLockState, NodeLockService } from "@gasboost/fake-node";

const contexts = [
  { scriptId: "script", userId: "alice", documentId: "doc-1" },
  { scriptId: "script", userId: "bob", documentId: "doc-2" },
];
const sharedState = createNodeLockState(contexts);
const service = new NodeLockService({ ...contexts[0], sharedState });
// Pass sharedState via workerData, then construct the service in each Worker.
```

The structured-cloneable descriptor contains immutable ordered `keys` and a
`SharedArrayBuffer`. Pass it intact (no transfer list), preserving the key order
and buffer pairing. Do not mutate its keys or buffer contents. Scopes use JSON
tuples, so delimiters in IDs do not create collisions. Duplicate scopes are
deduplicated. Capacity is fixed at creation: exactly one four-byte Int32 per
distinct script, script/user, and script/document scope. Unknown contexts throw
during service construction; create a new state to register more scopes.
Distinct descriptors from separate creation calls are isolated, even for identical IDs.

The following complete CommonJS example is shipped as
`examples/lock-workers.cjs`. After building this repository, run
`node packages/fake-node/examples/lock-workers.cjs`. After installing the package,
copy it into your project and replace `require("..")` with
`require("@gasboost/fake-node")`, then run `node lock-workers.cjs`.

```js
const assert = require("node:assert/strict");
const { Worker, isMainThread, workerData } = require("node:worker_threads");
const { createNodeLockState, NodeLockService } = require("..");

const context = { scriptId: "example", userId: "user-1" };

if (isMainThread) {
  const sharedState = createNodeLockState([context]);
  const counter = new SharedArrayBuffer(4);
  const jobs = Array.from({ length: 4 }, () => {
    const worker = new Worker(__filename, {
      workerData: { sharedState, counter },
    });
    return new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker exited with code ${code}`));
      });
    });
  });
  Promise.all(jobs).then(() => {
    assert.equal(new Int32Array(counter)[0], 4000);
    console.log("4000 increments protected by a shared ScriptLock");
  });
} else {
  const service = new NodeLockService({
    ...context,
    sharedState: workerData.sharedState,
  });
  const counter = new Int32Array(workerData.counter);
  const lock = service.getScriptLock();
  for (let i = 0; i < 1000; i++) {
    lock.waitLock(5000);
    try {
      counter[0] += 1;
    } finally {
      lock.releaseLock();
    }
  }
}
```

The lock uses `Atomics.compareExchange`, `Atomics.wait` and release notifications,
recomputing remaining time using a monotonic clock. It blocks the calling thread:
a timer, Promise, or another task on that same event loop cannot release a lock
while it waits. Use Workers for actual concurrent execution. Scheduling can delay
return past the requested timeout; fairness and FIFO order are not guaranteed.

There is no automatic release on execution completion, Worker exit, crash, or
termination. Always release in `finally` and keep Workers alive until release;
discard an abandoned state after terminating all its users. Other processes and
machines are unsupported. Shared locks do not make `InMemoryCacheService` or other
ordinary JavaScript objects shared across Workers: those need their own shared
storage implementation. This is a fake for the documented lock behavior within
these constraints, not a complete GAS runtime emulator.

## Validation and release

`pnpm --filter @gasboost/fake-core build` prepares the dependency, then
`pnpm --filter @gasboost/fake-node check` checks formatting, lint, GAS interface
types, unit tests, and real Worker contention. `build` and `pack:check` validate
the publishable package. Version 0.3.0 adds the lock APIs without changing the
existing utility/fetch APIs. The existing publish workflow reads the manifest
version after successful main-branch CI.
