import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { once } from "node:events";
import {
  createNodeLockState,
  NodeLock,
  NodeLockService,
} from "./NodeLockService";

const context = { scriptId: "script", userId: "user", documentId: "doc" };
const workers: Worker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

function runWorker(data: object, body: string) {
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const { NodeLockService } = require(workerData.modulePath);
     const service = new NodeLockService(workerData.context);
     const lock = service[workerData.method || 'getScriptLock']();
     ${body}`,
    {
      eval: true,
      workerData: {
        modulePath: resolve(__dirname, "../dist/index.js"),
        ...data,
      },
    },
  );
  workers.push(worker);
  return worker;
}

describe("NodeLockService", () => {
  it("implements GAS types and does not acquire on get", () => {
    expectTypeOf(
      new NodeLockService(context).getDocumentLock(),
    ).toEqualTypeOf<NodeLock | null>();
    const service: GoogleAppsScript.Lock.LockService = new NodeLockService(
      context,
    );
    const locks: GoogleAppsScript.Lock.Lock[] = [
      service.getScriptLock(),
      service.getUserLock(),
      service.getDocumentLock()!,
    ];
    for (const lock of locks) expect(lock.hasLock()).toBe(false);
    expect(
      new NodeLockService({
        ...context,
        documentId: undefined,
      }).getDocumentLock(),
    ).toBeNull();
  });

  it("tracks ownership per handle, ignores repeated acquisition/release, and reacquires", () => {
    const sharedState = createNodeLockState([context]);
    const service = new NodeLockService({ ...context, sharedState });
    const owner = service.getScriptLock();
    const other = service.getScriptLock();
    other.releaseLock();
    expect(owner.tryLock(0)).toBe(true);
    expect(owner.tryLock(0)).toBe(true);
    owner.waitLock(0);
    expect(owner.hasLock()).toBe(true);
    expect(other.tryLock(0)).toBe(false);
    expect(other.hasLock()).toBe(false);
    other.releaseLock();
    expect(other.tryLock(0)).toBe(false);
    owner.releaseLock();
    expect(owner.hasLock()).toBe(false);
    expect(other.tryLock(0)).toBe(true);
    owner.releaseLock();
    expect(other.hasLock()).toBe(true);
    other.releaseLock();
    expect(owner.tryLock(0)).toBe(true);
    owner.releaseLock();
  });

  it("shares default scopes between services in one module instance", () => {
    const a = new NodeLockService(context).getScriptLock();
    const b = new NodeLockService({
      ...context,
      userId: "other",
    }).getScriptLock();
    a.waitLock(0);
    try {
      expect(b.tryLock(0)).toBe(false);
    } finally {
      a.releaseLock();
    }
  });

  it.each(["getScriptLock", "getUserLock", "getDocumentLock"] as const)(
    "separates script/user/document scopes for %s",
    (method) => {
      const contexts = [
        context,
        { ...context, scriptId: "other" },
        { ...context, userId: "other" },
        { ...context, documentId: "other" },
      ];
      const sharedState = createNodeLockState(contexts);
      const services = contexts.map(
        (value) => new NodeLockService({ ...value, sharedState }),
      );
      const owner = services[0][method]()!;
      owner.waitLock(0);
      try {
        for (let index = 0; index < services.length; index++) {
          const candidate = services[index][method]()!;
          const independent =
            index === 1 ||
            (method === "getUserLock" && index === 2) ||
            (method === "getDocumentLock" && index === 3);
          expect(candidate.tryLock(0)).toBe(independent);
          candidate.releaseLock();
        }
        // Different lock kinds do not conflict even with identical IDs.
        for (const otherMethod of [
          "getScriptLock",
          "getUserLock",
          "getDocumentLock",
        ] as const) {
          if (otherMethod === method) continue;
          const lock = services[0][otherMethod]()!;
          expect(lock.tryLock(0)).toBe(true);
          lock.releaseLock();
        }
      } finally {
        owner.releaseLock();
      }
    },
  );

  it("waits synchronously for the timeout and throws from waitLock", () => {
    const sharedState = createNodeLockState([context]);
    const service = new NodeLockService({ ...context, sharedState });
    const owner = service.getScriptLock();
    const contender = service.getScriptLock();
    owner.waitLock(0);
    try {
      const start = performance.now();
      expect(contender.tryLock(60)).toBe(false);
      expect(performance.now() - start).toBeGreaterThanOrEqual(50);
      expect(() => contender.waitLock(20)).toThrow(/timeout/);
      expect(contender.hasLock()).toBe(false);
    } finally {
      owner.releaseLock();
    }
  });

  it("rejects unsupported inputs and unregistered or malformed shared state", () => {
    const lock = new NodeLock(new SharedArrayBuffer(4));
    for (const timeout of [
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => lock.tryLock(timeout)).toThrow(RangeError);
      expect(() => lock.waitLock(timeout)).toThrow(RangeError);
    }
    expect(() => new NodeLock(new SharedArrayBuffer(4), 1)).toThrow();
    expect(() => new NodeLockService({ ...context, scriptId: "" })).toThrow();
    const sharedState = createNodeLockState([context, context]);
    expect(sharedState.keys).toHaveLength(3);
    expect(sharedState.buffer.byteLength).toBe(12);
    expect(
      () => new NodeLockService({ ...context, userId: "missing", sharedState }),
    ).toThrow(/not registered/);
    expect(
      () =>
        new NodeLockService({
          ...context,
          sharedState: { ...sharedState, buffer: new SharedArrayBuffer(4) },
        }),
    ).toThrow(/Invalid/);
    expect(
      () =>
        new NodeLockService({
          ...context,
          sharedState: {
            keys: ["duplicate", "duplicate"],
            buffer: new SharedArrayBuffer(8),
          },
        }),
    ).toThrow(/Invalid/);
    // Tuple serialization avoids delimiter collisions.
    expect(
      createNodeLockState([
        { scriptId: "a:b", userId: "c" },
        { scriptId: "a", userId: "b:c" },
      ]).keys,
    ).toHaveLength(4);
  });

  it("wakes a real Worker promptly when the owner releases", async () => {
    const sharedState = createNodeLockState([context]);
    const owner = new NodeLockService({
      ...context,
      sharedState,
    }).getScriptLock();
    owner.waitLock(0);
    const worker = runWorker(
      { context: { ...context, sharedState } },
      `
      parentPort.postMessage('ready');
      const start = performance.now();
      lock.waitLock(5000);
      parentPort.postMessage({ elapsed: performance.now() - start, held: lock.hasLock() });
      lock.releaseLock();`,
    );
    try {
      await once(worker, "message");
      const acquired = once(worker, "message");
      await new Promise((resolve) => setTimeout(resolve, 100));
      owner.releaseLock();
      const [result] = await acquired;
      expect(result.held).toBe(true);
      expect(result.elapsed).toBeLessThan(3000);
    } finally {
      owner.releaseLock();
    }
  }, 10000);

  it.each(["getScriptLock", "getUserLock", "getDocumentLock"] as const)(
    "serializes 8,000 real competing Worker critical sections for %s",
    async (method) => {
      const sharedState = createNodeLockState([context]);
      const counter = new SharedArrayBuffer(12);
      const jobs = Array.from({ length: 4 }, () => {
        const worker = runWorker(
          { context: { ...context, sharedState }, counter, method },
          `
        const values = new Int32Array(workerData.counter);
        Atomics.add(values, 2, 1); Atomics.notify(values, 2);
        while (Atomics.load(values, 2) < 4) {
          const ready = Atomics.load(values, 2);
          if (ready < 4) Atomics.wait(values, 2, ready, 5000);
        }
        for (let i = 0; i < 2000; i++) {
          lock.waitLock(5000);
          try {
            if (Atomics.add(values, 1, 1) !== 0) throw new Error('overlap');
            const count = values[0];
            for (let j = 0; j < 20; j++) Math.sqrt(j);
            values[0] = count + 1;
            Atomics.sub(values, 1, 1);
          } finally { lock.releaseLock(); }
        }
        parentPort.postMessage('done');`,
        );
        return once(worker, "message");
      });
      await Promise.all(jobs);
      expect(new Int32Array(counter)[0]).toBe(8000);
      expect(new Int32Array(counter)[1]).toBe(0);
    },
    20000,
  );

  it("runs the complete shipped Worker consumer example", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolve(__dirname, "../examples/lock-workers.cjs")],
      { timeout: 10000 },
    );
    expect(stdout).toContain(
      "4000 increments protected by a shared ScriptLock",
    );
  }, 15000);

  it.each([
    ["getScriptLock", { ...context, scriptId: "parallel" }],
    ["getUserLock", { ...context, userId: "parallel" }],
    ["getDocumentLock", { ...context, documentId: "parallel" }],
  ] as const)(
    "allows real Workers in different %s scopes to overlap",
    async (method, other) => {
      const sharedState = createNodeLockState([context, other]);
      const barrier = new SharedArrayBuffer(4);
      await Promise.all(
        [context, other].map((value) => {
          const worker = runWorker(
            { context: { ...value, sharedState }, method, barrier },
            `
        const barrier = new Int32Array(workerData.barrier);
        lock.waitLock(5000);
        try {
          Atomics.add(barrier, 0, 1); Atomics.notify(barrier, 0);
          while (Atomics.load(barrier, 0) < 2) {
            if (Atomics.wait(barrier, 0, 1, 3000) === 'timed-out') throw new Error('no overlap');
          }
          parentPort.postMessage('overlapped');
        } finally { lock.releaseLock(); }`,
          );
          return once(worker, "message");
        }),
      );
    },
    15000,
  );
});
