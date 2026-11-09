import {
  AppsScriptRpcError,
  AppsScriptHistoryPipeline,
  AppsScriptTransport,
  FetchTransport,
  appsScriptClient,
  withMetadataProviders,
} from "@gasboost/client";

export const api = {
  AppsScriptRpcError,
  AppsScriptHistoryPipeline,
  AppsScriptTransport,
  FetchTransport,
  appsScriptClient,
  withMetadataProviders,
};

type App = { echo: { input: { value: number }; result: string } };

export async function call(customTransport: boolean) {
  const { client } = appsScriptClient<App>({
    metadataProviders: [() => ({ base: true })],
    ...(customTransport
      ? { transport: { call: async () => ({ contents: '"custom"' }) } }
      : {}),
  });
  const scoped = withMetadataProviders(client, [() => ({ scoped: true })]);
  try {
    return { result: await scoped.echo({ value: 42 }) };
  } catch (error) {
    if (!(error instanceof AppsScriptRpcError)) throw error;
    return { code: error.code, message: error.message };
  }
}
