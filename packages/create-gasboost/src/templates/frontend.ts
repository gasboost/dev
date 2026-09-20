import type { ProjectFragment } from "../fragment.js";

export function frontendFragment(): ProjectFragment {
  return {
    files: {
      "index.html": renderIndexHtml(),
      "src/frontend/main.tsx": renderMain(),
      "src/frontend/App.tsx": renderApp(),
      "src/frontend/lib/appsscript.ts": renderAppsScriptClient(),
    },

    dependencies: {
      "@gasboost/client": "^0.3.0",
      "@gasboost/react": "^0.1.2",
      react: "^19.3.0",
      "react-dom": "^19.3.0",
    },

    devDependencies: {
      "@types/react": "^19.3.0",
      "@types/react-dom": "^19.3.0",
      "@vitejs/plugin-react": "^5.2.0",
      "vite-plugin-singlefile": "^2.3.3",
    },

    scripts: {
      "build:client": "vite build --mode client",
    },
  };
}

function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>gasboost</title>
  </head>

  <body>
    <div id="root"></div>

    <script
      type="module"
      src="/src/frontend/main.tsx"
    ></script>
  </body>
</html>
`;
}

function renderMain(): string {
  return `import { AppsScriptRouter } from "@gasboost/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AppsScriptRouter>
      <App />
    </AppsScriptRouter>
  </StrictMode>,
);
`;
}

function renderApp(): string {
  return `import { useState } from "react";
import { client } from "./lib/appsscript";

export function App() {
  const [message, setMessage] = useState(
    "Call the backend to verify your Gasboost app.",
  );

  const [loading, setLoading] = useState(false);

  async function callHello() {
    setLoading(true);

    try {
      const result = await client.hello();

      setMessage(result.message);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : String(error),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>gasboost</h1>

      <p>{message}</p>

      <button
        type="button"
        disabled={loading}
        onClick={() => void callHello()}
      >
        {loading ? "Calling..." : "Call hello"}
      </button>
    </main>
  );
}
`;
}

function renderAppsScriptClient(): string {
  return `import { appsScriptClient } from "@gasboost/client";
import type { AppType } from "../../backend/main";

export const { client } =
  appsScriptClient<AppType>();
`;
}
