import type { z } from "zod";

export type OperationProgress = {
  readonly message: string;
  readonly percentage?: number;
};

export type OperationContext = {
  readonly log: (message: string) => void;
  readonly progress: (progress: OperationProgress) => void;
};

export type OperationDefinition<TInput, TOutput> = {
  readonly id: string;
  readonly input: z.ZodType<TInput>;
  readonly handler: (
    input: TInput,
    context: OperationContext,
  ) => Promise<TOutput> | TOutput;
};

// The registry erases per-operation generics after register() has checked them.
export type RegisteredOperation = OperationDefinition<any, any>;

export class OperationRegistry {
  private readonly operations = new Map<string, RegisteredOperation>();

  public register<TInput, TOutput>(
    operation: OperationDefinition<TInput, TOutput>,
  ): void {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(operation.id)) {
      throw new Error(`Invalid operation ID: ${operation.id}`);
    }

    if (this.operations.has(operation.id)) {
      throw new Error(`Operation is already registered: ${operation.id}`);
    }

    this.operations.set(operation.id, operation as RegisteredOperation);
  }

  public get(id: string): RegisteredOperation | undefined {
    return this.operations.get(id);
  }
}
