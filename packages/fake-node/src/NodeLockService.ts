import { performance } from "node:perf_hooks";

export interface NodeLockContext {
  scriptId: string;
  userId: string;
  documentId?: string;
}

/** Structured-cloneable descriptor. Pass the entire descriptor in workerData. */
export interface NodeLockState {
  readonly keys: readonly string[];
  readonly buffer: SharedArrayBuffer;
}

function scopeKeys(context: NodeLockContext): string[] {
  for (const value of [context.scriptId, context.userId]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError("scriptId and userId must be non-empty strings");
    }
  }
  if (
    context.documentId !== undefined &&
    (typeof context.documentId !== "string" || context.documentId.length === 0)
  ) {
    throw new TypeError("documentId must be a non-empty string when provided");
  }
  return [
    JSON.stringify(["script", context.scriptId]),
    JSON.stringify(["user", context.scriptId, context.userId]),
    ...(context.documentId === undefined
      ? []
      : [JSON.stringify(["document", context.scriptId, context.documentId])]),
  ];
}

/** Fixed capacity: one Int32 (four bytes) per distinct registered scope. */
export function createNodeLockState(
  contexts: readonly NodeLockContext[],
): NodeLockState {
  const keys = Object.freeze([...new Set(contexts.flatMap(scopeKeys))]);
  return Object.freeze({
    keys,
    buffer: new SharedArrayBuffer(keys.length * Int32Array.BYTES_PER_ELEMENT),
  });
}

export class NodeLock implements GoogleAppsScript.Lock.Lock {
  private readonly state: Int32Array;
  private held = false;

  constructor(buffer: SharedArrayBuffer, index = 0) {
    if (
      !(buffer instanceof SharedArrayBuffer) ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      (index + 1) * Int32Array.BYTES_PER_ELEMENT > buffer.byteLength
    ) {
      throw new RangeError("Expected a shared Int32 lock slot");
    }
    this.state = new Int32Array(
      buffer,
      index * Int32Array.BYTES_PER_ELEMENT,
      1,
    );
  }

  hasLock(): boolean {
    return this.held;
  }

  releaseLock(): void {
    if (!this.held) return;
    this.held = false;
    Atomics.store(this.state, 0, 0);
    Atomics.notify(this.state, 0);
  }

  tryLock(timeoutInMillis: number): boolean {
    // GAS documents re-acquisition as a no-op (not a recursive lock).
    if (this.held) return true;
    if (!Number.isSafeInteger(timeoutInMillis) || timeoutInMillis < 0) {
      throw new RangeError(
        "timeoutInMillis must be a non-negative safe integer",
      );
    }
    const deadline = performance.now() + timeoutInMillis;
    for (;;) {
      if (Atomics.compareExchange(this.state, 0, 0, 1) === 0) {
        this.held = true;
        return true;
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) return false;
      // Expected-value checking prevents lost wakeups between CAS and wait.
      if (Atomics.wait(this.state, 0, 1, remaining) === "timed-out")
        return false;
    }
  }

  waitLock(timeoutInMillis: number): void {
    if (!this.tryLock(timeoutInMillis)) {
      throw new Error("Could not acquire lock within the specified timeout");
    }
  }
}

// Defaults share scopes within this module instance, never across Workers.
const localScopes = new Map<string, SharedArrayBuffer>();

export class NodeLockService implements GoogleAppsScript.Lock.LockService {
  private readonly keys: readonly string[];
  private readonly slots?: Map<string, number>;
  private readonly buffer?: SharedArrayBuffer;

  constructor(options: NodeLockContext & { sharedState?: NodeLockState }) {
    this.keys = scopeKeys(options);
    if (options.sharedState !== undefined) {
      const { keys, buffer } = options.sharedState;
      if (
        !(buffer instanceof SharedArrayBuffer) ||
        buffer.byteLength !== keys.length * Int32Array.BYTES_PER_ELEMENT ||
        new Set(keys).size !== keys.length
      ) {
        throw new TypeError("Invalid NodeLockState descriptor");
      }
      this.slots = new Map(keys.map((key, index) => [key, index]));
      this.buffer = buffer;
      for (const key of this.keys) {
        if (!this.slots.has(key)) {
          throw new Error(`Lock scope was not registered: ${key}`);
        }
      }
    }
  }

  getScriptLock(): NodeLock {
    return this.getLock(this.keys[0]);
  }

  getUserLock(): NodeLock {
    return this.getLock(this.keys[1]);
  }

  getDocumentLock(): NodeLock | null;
  // Compatibility overload for @types/google-apps-script, which omits null.
  // Direct callers see the first (nullable) overload; no global type is changed.
  getDocumentLock(): NodeLock;
  getDocumentLock(): NodeLock | null {
    return this.keys[2] === undefined ? null : this.getLock(this.keys[2]);
  }

  private getLock(key: string): NodeLock {
    if (this.buffer !== undefined && this.slots !== undefined) {
      return new NodeLock(this.buffer, this.slots.get(key)!);
    }
    let buffer = localScopes.get(key);
    if (buffer === undefined) {
      buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      localScopes.set(key, buffer);
    }
    return new NodeLock(buffer);
  }
}
