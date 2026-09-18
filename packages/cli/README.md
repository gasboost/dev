# @gasboost/cli

Gasboost エコシステム共通の開発CLIです。

```bash
pnpm add -D @gasboost/cli
```

## Project Console

プロジェクトの `package.json` に Console script を追加します。

```json
{
  "scripts": {
    "console": "gasboost console open"
  }
}
```

次のコマンドでローカルConsoleを開きます。

```bash
pnpm console
```

自動でBrowserを開かずに起動する場合は `gasboost console open --no-browser` を使用できます。

ConsoleのBrowser UIから実行できるのは、登録済みoperationと各operationのschemaを満たすstructured inputだけです。

`appsScript` capabilityを設定したプロジェクトでは、Google認証、Apps Script project作成、editor表示、local filesのpushをConsoleから実行できます。

## RTDB Security Rules

`@gasboost/realtime-firebase` で定義した Firebase Realtime Database の Security Rules を生成できます。

### Config

プロジェクトルートに `gasboost.config.ts` を作成します。

```ts
import { defineGasboostConfig } from "@gasboost/cli";

export default defineGasboostConfig({
  firebase: {
    realtimeDatabase: {
      source: "./src/backend/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});
```

従来の `rtdb: { source, out }` 形式も互換性のため読み込めますが、
新しい設定では `firebase.realtimeDatabase` を使用してください。

### RTDB definition

`source` で指定した module は `rtdb` を named export します。

```ts
import { FirebaseRtdb } from "@gasboost/realtime-firebase";
import { deals } from "@/database/deals";
import { dealSecurity } from "@/security/dealSecurity";

export const rtdb = FirebaseRtdb.generate({
  tables: [deals] as const,

  rowLevelSecurity: [dealSecurity],

  principal: {
    userId: "auth.uid",
  },
});
```

CLI はこの module を実行し、export された `rtdb` の `rules()` を呼び出します。

### Generate

```bash
gasboost console open [--no-browser]
gasboost rtdb rules
```

成功すると、設定した `out` へ Security Rules が出力されます。

```text
database.rules.json
```

例:

```json
{
  "rules": {
    "deals": {
      "...": "..."
    }
  }
}
```

## TypeScript module loading

Gasboost CLI は application source の読み込みに `jiti` を利用します。

そのため、通常の Node.js native TypeScript execution に限定されず、プロジェクトの `tsconfig.json` に設定された `paths` も利用できます。

例えば次のような設定に対応します。

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

application source 側では通常どおり利用できます。

```ts
import { deals } from "@/database/deals";
```

Gasboost CLI を利用するためだけに import path を書き換える必要はありません。

## Architecture

```text
gasboost.config.ts
        │
        ▼
@gasboost/config
        │
        ▼
loadGasboostConfig
      jiti
        │
        ▼
rtdb.source
        │
        ▼
export const rtdb
        │
        ▼
rtdb.rules()
        │
        ▼
RtdbRulesWriter
        │
        ▼
database.rules.json
```

`@gasboost/cli` は RLS や Firebase Security Rules のコンパイル処理を実装しません。

それらの責務は `@gasboost/realtime-firebase` にあります。

```text
@gasboost/realtime-firebase
  ├─ RLS -> authorization layout
  ├─ runtime path generation
  ├─ projectability validation
  └─ Security Rules generation

@gasboost/cli
  ├─ config load
  ├─ TypeScript module load
  ├─ command routing
  ├─ filesystem output
  ├─ diagnostics
  └─ exit code
```

## Commands

```bash
gasboost rtdb rules
```

現時点ではRTDB Security Rules生成のみを提供します。

今後、Gasboostエコシステム共通のdeveloper toolingを追加していきます。

## Requirements

- Node.js 24+
- pnpm

## License

MIT
