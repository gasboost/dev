import type { ProjectFragment } from "../fragment.js";

export function frontendFragment({
  authentication,
}: {
  authentication: boolean;
}): ProjectFragment {
  return {
    files: {
      "index.html": `<!doctype html>
<html lang="ja">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>GAS BOOST</title></head>
  <body>
    <div id="root"></div>
    ${authentication ? '<script type="application/json" id="bootstrap-data"><?!= __BOOTSTRAP__ ?></script>' : ""}
    <script type="module" src="/src/frontend/main.tsx"></script>
  </body>
</html>
`,
      "components.json": `{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/frontend/style.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
`,
    },
    dependencies: { react: "^19.3.1", "react-dom": "^19.3.1" },
    devDependencies: {
      "@types/react": "^19.3.0",
      "@types/react-dom": "^19.3.0",
      "@vitejs/plugin-react": "^6.2.1",
      "@tailwindcss/vite": "^4.3.5",
      tailwindcss: "^4.3.5",
      "vite-plugin-singlefile": "^2.3.3",
    },
    scripts: { "build:client": "cross-env BUILD_TARGET=client vite build" },
  };
}
