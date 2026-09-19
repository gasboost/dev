import type { CapabilitySelection } from "../capabilities.js";
import type { ProjectFragment } from "../fragment.js";

export function baseFragment(
  capabilities: CapabilitySelection,
): ProjectFragment {
  const buildSteps = [
    "pnpm clean",
    capabilities.frontend ? "pnpm build:client" : null,
    "pnpm build:server",
    "pnpm build:manifest",
    capabilities.realtime ? "pnpm rules" : null,
  ].filter((step): step is string => step !== null);

  return {
    files: {
      ".gitignore": renderGitignore(),
      "appsscript.json": renderAppsScriptManifest(capabilities),
      "gasboost.config.ts": renderGasboostConfig(capabilities),
      "tsconfig.json": renderTsconfig(),
      "vite.config.ts": renderViteConfig(capabilities),
      "src/backend/main.ts": renderBackendMain(capabilities),
    },

    dependencies: {
      "@gasboost/app": "^5.0.0",
    },

    devDependencies: {
      "@gasboost/cli": "^0.3.4",
      "@gasboost/vite": "^1.2.2",
      "@types/google-apps-script": "^2.0.13",
      typescript: "^7.0.2",
      vite: "^8.3.0",
      vitest: "^5.0.0",
    },

    scripts: {
      dev: "pnpm dev:vite",
      "dev:vite": "vite",
      console: "gasboost console open",
      clean:
        "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
      "build:server": "vite build --mode server",
      "build:manifest":
        "node -e \"require('node:fs').copyFileSync('appsscript.json','dist/appsscript.json')\"",
      build: buildSteps.join(" && "),
      typecheck: "tsc --noEmit",
      test: "vitest run --passWithNoTests",
    },
  };
}

function renderGitignore(): string {
  return `node_modules/
dist/
.env
.env.*
!.env.example
.firebase/
coverage/
.DS_Store
`;
}

function renderBackendMain(capabilities: CapabilitySelection): string {
  const imports = [
    'import { AppsScript, type InferAppsScript } from "@gasboost/app";',
  ];

  if (capabilities.authentication) {
    imports.push(
      'import { authentication, handlers } from "@gasboost/auth-app";',
      'import { auth } from "./lib/auth";',
    );
  }

  const chain = ["const app = new AppsScript()"];

  if (capabilities.frontend) {
    chain.push(
      '  .get(() => HtmlService.createHtmlOutputFromFile("index").setTitle("gasboost"))',
    );
  }

  /*
   * Auth handlers must be registered before authentication middleware.
   * AppsScript captures the active middleware set when each handler is
   * registered, so sign-in/sign-up handlers remain public while later
   * application handlers receive authentication middleware.
   */
  if (capabilities.authentication) {
    chain.push("  .calls(handlers(auth))", "  .use(authentication(auth))");
  }

  chain.push('  .call("hello", () => ({ message: "Hello from gasboost" }));');

  return `${imports.join("\n")}

${chain.join("\n")}

export default app;

export type AppType = InferAppsScript<typeof app>;
`;
}

function renderAppsScriptManifest(capabilities: CapabilitySelection): string {
  const manifest: Record<string, unknown> = {
    timeZone: "Asia/Tokyo",
  };

  if (capabilities.database) {
    manifest.dependencies = {
      enabledAdvancedServices: [
        {
          userSymbol: "Sheets",
          version: "v4",
          serviceId: "sheets",
        },
      ],
    };
  }

  manifest.exceptionLogging = "STACKDRIVER";
  manifest.runtimeVersion = "V8";

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function renderGasboostConfig(capabilities: CapabilitySelection): string {
  if (!capabilities.realtime) {
    return `import { defineGasboostConfig } from "@gasboost/cli";

export default defineGasboostConfig({
  appsScript: {
    type: "webapp",
    rootDir: "./dist",
  },
});
`;
  }

  return `import { defineGasboostConfig } from "@gasboost/cli";

export default defineGasboostConfig({
  appsScript: {
    type: "webapp",
    rootDir: "./dist",
  },

  firebase: {
    realtimeDatabase: {
      source: "./src/backend/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});
`;
}

function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["google-apps-script", "vite/client"],
        resolveJsonModule: true,
        esModuleInterop: true,
      },
      include: ["src", "vite.config.ts", "gasboost.config.ts"],
    },
    null,
    2,
  )}\n`;
}

function renderViteConfig(capabilities: CapabilitySelection): string {
  const imports: string[] = [];

  if (capabilities.database) {
    imports.push(
      'import { SheetsStub, SpreadsheetAppStub } from "@gasboost/sheetorm";',
    );
  }

  imports.push('import { gasboost } from "@gasboost/vite";');

  if (capabilities.frontend) {
    imports.push('import react from "@vitejs/plugin-react";');
  }

  imports.push('import { defineConfig } from "vite";');

  if (capabilities.frontend) {
    imports.push('import { viteSingleFile } from "vite-plugin-singlefile";');
  }

  const gasboostOptions = [
    "const { build, dev } = gasboost({",
    '  entry: "src/backend/main.ts",',
  ];

  if (capabilities.database) {
    gasboostOptions.push(
      "  runtime: {",
      "    SpreadsheetApp: SpreadsheetAppStub,",
      "    Sheets: SheetsStub,",
      "  },",
    );
  }

  gasboostOptions.push("});");

  const clientConfig = capabilities.frontend
    ? `  return {
    plugins: [react(), viteSingleFile(), dev],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };`
    : `  return {
    plugins: [dev],
  };`;

  return `${imports.join("\n")}

${gasboostOptions.join("\n")}

export default defineConfig(({ mode }) => {
  if (mode === "server") {
    return {
      plugins: [build],
      build: {
        outDir: "dist",
        emptyOutDir: false,
      },
    };
  }

${clientConfig}
});
`;
}
