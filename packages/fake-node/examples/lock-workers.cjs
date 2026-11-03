/* global require, __filename */
/* eslint-disable @typescript-eslint/no-require-imports -- Runnable CommonJS consumer example. */
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
