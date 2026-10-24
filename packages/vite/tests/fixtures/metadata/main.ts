import {
  AppsScript,
  type InferAppsScript,
  type RpcMetadata,
} from "@gasboost/app";

type Observation = { input: unknown; metadata?: RpcMetadata };

const app = new AppsScript()
  .use<{}, { observed: Observation }>((context, next) => {
    if (context.invocation.type === "call") {
      context.state.set("observed", {
        input: context.invocation.input,
        metadata: context.invocation.metadata,
      });
    }
    return next();
  })
  .call("echo", (input: Record<string, unknown>, context) => ({
    input,
    observed: context.state.get("observed"),
  }))
  .call("noInput", (_input: undefined, context) => ({
    observed: context.state.get("observed"),
  }));

export type AppType = InferAppsScript<typeof app>;
export default app;
