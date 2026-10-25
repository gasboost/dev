# @gasboost/vite

`@gasboost/app` で構築した Google Apps Script アプリケーションを、Vite でビルド・ローカル開発するためのプラグインです。

`@gasboost/vite` は用途ごとに2つの Vite Plugin を提供します。

- `build` — Google Apps Script 向けの production build
- `dev` — ローカル開発時の RPC 実行

## インストール

```bash
pnpm add @gasboost/app
pnpm add -D @gasboost/vite vite
```

npm:

```bash
npm install @gasboost/app
npm install -D @gasboost/vite vite
```

## Quick Start

まず `@gasboost/app` でバックエンドを定義します。

```ts
// src/server.ts

import { AppsScript } from "@gasboost/app";

const app = new AppsScript()
  .get(() => {
    return HtmlService.createHtmlOutput("Hello");
  })
  .post((request) => {
    return ContentService.createTextOutput(request.text());
  })
  .call("sum", (a: number, b: number) => a + b)
  .call("getUser", async (id: string) => ({
    id,
    name: "Taro",
  }));

export default app;
```

`gasboost()` から `build` と `dev` を取得し、1つの `vite.config.ts` の中で mode に応じて使い分けます。

frontend と backend は成果物と build graph が異なるため、同時に1つの Vite build へ混在させません。

```ts
// vite.config.ts

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { gasboost } from "@gasboost/vite";

const { build, dev } = gasboost({
  entry: "src/server.ts",
  envDir: ".env",
});

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

  return {
    plugins: [react(), viteSingleFile(), dev],
    build: {
      outDir: "dist",
    },
  };
});
```

この例では、frontend build と backend build を mode で分離します。

```json
{
  "scripts": {
    "dev": "vite",
    "build:client": "vite build --mode client",
    "build:server": "vite build --mode server",
    "build": "pnpm build:client && pnpm build:server"
  }
}
```

```text
vite
  ↓
gasboost:dev

vite build --mode client
  ↓
frontend build

vite build --mode server
  ↓
gasboost:build
```

frontend 側の React、single-file 化などの設定は利用側プロジェクトの責務です。

## gasboost()

```ts
const { build, dev } = gasboost({
  entry: "src/server.ts",
  envDir: "config",
});
```

戻り値:

```ts
{
  build: Plugin;
  dev: Plugin;
}
```

### `entry`

必須です。

`AppsScript` を定義して default export している entry file を指定します。

```ts
gasboost({
  entry: "src/server.ts",
});
```

### `envDir`

任意です。

build 時に Vite が環境変数ファイルを読み込むディレクトリを指定します。

```ts
gasboost({
  entry: "src/server.ts",
  envDir: "config",
});
```

### `localRpc.override`

任意です。default は `true` です。

Vite Dev Server 上で `@gasboost/client` の transport を Local RPC 用の `FetchTransport` に差し替えるかを指定します。

```ts
gasboost({
  entry: "src/server.ts",
  localRpc: {
    override: false,
  },
});
```

`false` を指定した場合だけ、アプリケーション側で明示した transport を維持します。

### `localRpc.database`

任意です。`@gasboost/sheetorm` のテーブルに使うローカルデータを、
`dbId → SheetTable.name → レコード配列` で指定します。
Consumer にインストールされた SheetORM の `InMemoryGateway` / `InMemoryDataStore` を使用します
（`@gasboost/sheetorm@3.4.0` で検証）。Sheets API の Fake は不要です。

```ts
const { build, dev } = gasboost({
  entry: "src/backend/main.ts",
  localRpc: {
    database: {
      SPREADSHEET_ID: {
        users: [],
        products: [{ id: "p-1", name: "Product A", price: 1000 }],
      },
    },
  },
});
```

本番コードの `new SheetDB({ tables, gateway: new SheetGateway(Sheets!), ... })` は
そのまま使えます。`SheetGateway` は開発 SSR でのみインメモリ実装に差し替えられ、
渡された Sheets 引数は使用しません。`Sheets` グローバルには未定義値を登録して名前解決を可能にします。
明示した `runtime.Sheets` がある場合はそちらを優先します。
空テーブルのヘッダーは登録された `SheetTable.schema` から初期化します。
スキーマを取得するために開発 SSR の `SheetDB` コンストラクターも薄くラップしますが、
元の設定・処理はそのまま引き継ぎます。その他のエクスポートは再エクスポートします。
独自 Gateway を渡した `SheetDB` には初期化を適用しません。

各 `SheetDB` に登録するテーブルは、空の場合も `[]` で宣言してください。
未宣言のテーブルは DB ID とテーブル名を含むエラーになります。
列順はレコードのプロパティ順によらずスキーマから決まり、値は文字列に変換されません。

データは開発サーバー単位で一度だけ複製し、各テーブルの初回初期化時に投入します。
作成・更新・削除した状態は別 RPC、モジュール再評価、HMR をまたいで保持されます。
seed の再投入は行いません。設定・スキーマを変更するときやデータをリセットするときは
開発サーバーを再起動してください。サーバー終了時に保持データを解放します。
`localRpc.override: false` とも併用できます。

未指定時の挙動は従来どおりです。フロントエンドと本番 build は元の SheetORM を使用し、
サーバー専用の seed と差し替えコードはフロントエンド bundle に入りません。

### `localRpc.rtdb.emulator`

`@gasboost/realtime-firebase` の本番用 Transport を、開発 SSR 内でのみ RTDB Emulator 用に差し替えます。
明示的な opt-in で、Consumer には `@gasboost/realtime-firebase@^0.9.0` 以降が必要です。
RTDB を使わない Consumer では、このパッケージのインストールや import は不要です。

```ts
const { build, dev } = gasboost({
  entry: "src/backend/main.ts",
  localRpc: {
    database: {
      SPREADSHEET_ID: { employees: [] },
    },
    rtdb: {
      emulator: {
        namespace: "demo-my-app-default-rtdb", // 必須
        host: "127.0.0.1", // 省略時の値
        port: 9000, // 省略時の値
      },
    },
  },
});
```

本番 Backend の `new FirebaseRtdbRestTransport({ databaseUrl, urlFetchApp, cacheService, credentialsProvider })` は変更不要です。
互換ラッパーが元の `urlFetchApp` と上記 Emulator 設定を `FirebaseRtdbEmulatorTransport` へ渡します。
`databaseUrl`・`cacheService`・`credentialsProvider` は使用せず、Google OAuth や本番 RTDB へ通信しません。
`UrlFetchApp` グローバルには opt-in 時のみ `NodeUrlFetchApp` を用意し、`runtime.UrlFetchApp` の明示指定を優先します。

`SheetDB.afterCommit` から既存の `FirebaseRtdb.publish()` を呼ぶと、同じ Consumer コードで
`syncVersions/<table>` の version が指定 namespace へ PATCH されます。
`FirebaseRtdb`・`PropertiesVersionStore`・`FirebaseCustomToken` 等の他の export と `/client` は維持します。
`localRpc.database`、`localRpc.override: false` とも併用できます。

Emulator の起動は Firebase CLI で行ってください。未起動・HTTP エラー時は Local RPC に通信エラーを返し、本番へのフォールバックは行いません。
接続可能な host は Emulator Transport が許可するループバックアドレスです。
署名鍵や Security Rules の準備は Consumer 側で行います。
同じ設定で Browser の `firebase/database` も Emulator へ自動接続します（下記）。

未指定時は RTDB の import・動作を変更しません。本番 build には、この差し替えや Emulator 実装を追加しません。

### Browser Firebase Auth / RTDB Emulator（1.6.0 以降）

`gasboost:dev` は、設定した Firebase SDK の **package root import** を Browser の serve 時だけ差し替えます。
Consumer 自身が `firebase` をインストールしてください。Firebase を使わない場合は追加依存不要です。

```ts
const { build, dev } = gasboost({
  entry: "src/backend/main.ts",
  localRpc: {
    rtdb: { emulator: { namespace: "demo-my-app" } }, // Backend + Browser、既定 port: 9000
    auth: { emulator: { host: "127.0.0.1", port: 9099 } }, // Browser のみ
  },
});
```

Auth と RTDB は独立した opt-in です。host の既定値は `127.0.0.1`、ループバックアドレスのみ指定できます。
`localRpc.override: false`、`localRpc.database` と併用できます。Vite の mode 名に依存せず、`vite build --mode staging` / production build では差し替えません。

Consumer の Firebase 初期化・利用コードは変更不要です。

```ts
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getDatabase, ref, onValue } from "firebase/database";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
export const firebaseAuth = getAuth(app);
export const firebaseDatabase = getDatabase(app);
```

`getAuth(app?)` / `initializeAuth(app, deps)` の直後に同期的に `connectAuthEmulator`、
`getDatabase(app?, url?)` の直後に `connectDatabaseEmulator` を一度だけ実行し、元の SDK の同一インスタンスを返します。
他の export は元の SDK をそのまま再エクスポートします。接続済みインスタンスは仮想モジュール再読込時も記録し、設定が変わった場合はページ再読込を要求します。
既に SDK の通信が始まっている場合の接続エラーは伝播し、本番 Firebase へフォールバックしません。Emulator 未起動時も SDK は Emulator への接続を試み続けるかエラーを返します。

`.env.development` 等は Vite 標準の仕組みで Consumer が管理します。Plugin は `.env` や FirebaseApp の設定を書き換えません。
例えば以下では namespace も `demo-my-app` とし、`firebase emulators:start --only auth,database --project demo-my-app` で起動します。

```dotenv
VITE_FIREBASE_PROJECT_ID=demo-my-app
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-my-app.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://demo-my-app.firebaseio.com
VITE_FIREBASE_APP_ID=demo-app-id
```

**databaseURL のデータベース名と `localRpc.rtdb.emulator.namespace` を一致させてください。**
`getDatabase` の明示 URL も検査し、不一致時はエラーにします。例えば `demo-my-app-default-rtdb` という DB 名なら namespace も同名にします。
これにより Browser と Backend が別の namespace を読む事故を防ぎます。

対象は `firebase/auth` / `firebase/database` です。Compat SDK、別 import 経路、事前ビルド済みの依存に内包された Firebase 初期化は対象外です。
ラッパー対象の root import を `optimizeDeps.exclude` に追加し、内部 SDK の依存事前バンドルは維持します。
Consumer で対象を `optimizeDeps.include` に強制指定しないでください。

Browser の回帰テストは実 Firebase SDK と Vite の依存事前バンドル、Playwright Chromium、Auth HTTP / RTDB WebSocket プロトコル fixture を利用します。
初回は `pnpm --filter @gasboost/vite exec playwright install chromium`、その後 `pnpm --filter @gasboost/vite test` で実行できます。

実 Firebase CLI の Auth / RTDB Emulator を使う E2E は `pnpm --filter @gasboost/vite test:e2e` で実行します（Java 21 以降と Chromium が必要）。
`emulators:exec` が demo project の Emulator を起動・停止し、失敗時は非ゼロで終了します。CI でも必須チェックとして実行します。
既存 Consumer 形式の初期化コードから Custom Token でサインインし、SheetDB の commit → Backend の同一 namespace への root PATCH →
Rules で認証と custom claim を要求する Browser の `onValue` が `syncVersions/employees` の更新を受信するまでを検証します。
未認証・権限不足の read と Browser の write が拒否されることも確認し、Emulator 宛の HTTP / WebSocket 通信はモックしません。
専用ポート（Auth 19099 / RTDB 19000 / hub 19440 / logging 19450）を空けて実行してください。
この E2E はリポジトリ内の Consumer fixture を使用し、REDNOSE POS 自体は起動しません。

---

# Build Plugin

`build` は `vite build` のときだけ動作し、GAS backend build を担当します。

frontend / backend を同じ `vite.config.ts` で扱う場合は、server 用 mode のときだけ `plugins` に含めてください。

```ts
const { build } = gasboost({
  entry: "src/server.ts",
});

export default defineConfig(({ mode }) => {
  if (mode === "server") {
    return {
      plugins: [build],
    };
  }

  return {
    plugins: [],
  };
});
```

`build` plugin は次の処理を担当します。

- entry file の静的解析
- `AppsScript` に登録された GET / POST / RPC の検出
- GAS が認識するグローバル関数宣言の生成
- GAS 向け Vite build configuration
- 環境変数の読み込み

## グローバル関数の生成

例えば次のアプリケーションを定義した場合:

```ts
const app = new AppsScript()
  .get(...)
  .post(...)
  .call("getUser", ...)
  .call("sum", ...);

export default app;
```

build plugin は GAS が認識するためのグローバル関数宣言を生成します。

```js
function doGet() {}
function doPost() {}
function getUser() {}
function sum() {}
```

これらは関数名を Google Apps Script に認識させるための宣言です。

実際のハンドラ登録と dispatch は `@gasboost/app` がランタイム上で行います。

```text
@gasboost/vite
  static analysis
  global function declarations
        ↓
@gasboost/app
  runtime registration
  dispatch
```

## 静的解析

entry file には1つの `AppsScript` インスタンスを定義し、default export します。

```ts
const app = new AppsScript();

app.get(...);
app.call("getUser", ...);

export default app;
```

チェーン形式にも対応しています。

```ts
const app = new AppsScript()
  .get(...)
  .post(...)
  .call("getUser", ...);

export default app;
```

RPC 名は文字列リテラルで指定する必要があります。

```ts
app.call("getUser", handler);
```

次のような動的な名前は静的解析の対象外です。

```ts
const name = "getUser";

app.call(name, handler);
```

build 時に GAS のグローバル関数名を確定する必要があるためです。

## 検証

静的解析時には、曖昧なアプリケーション定義をエラーとして扱います。

- GET ハンドラの重複
- POST ハンドラの重複
- RPC 名の重複
- entry 内の複数 `AppsScript` インスタンス
- default export されていない `AppsScript`

## GAS 向け build configuration

現在の build 設定:

- target: ECMAScript 2019
- output format: CommonJS
- output directory: `dist`
- `entry` を build input として利用

## 環境変数

Vite 標準の環境変数機構を利用します。

```text
config/
├── .env
├── .env.development
└── .env.production
```

```ts
const { build } = gasboost({
  entry: "src/server.ts",
  envDir: "config",
});
```

アプリケーションでは通常の Vite と同様に参照できます。

```ts
const apiUrl = import.meta.env.VITE_API_URL;
```

---

# Dev Plugin

`dev` は Vite Dev Server 上でのみ動作します。

frontend の開発用 Vite config に追加して利用します。

```ts
const { dev } = gasboost({
  entry: "src/server.ts",
});

export default defineConfig({
  plugins: [dev],
});
```

`dev` plugin は、GAS にデプロイしなくてもローカル環境から `AppsScript` の RPC を実行できるエンドポイントを Vite Dev Server に追加します。

## Local RPC

ローカル RPC のエンドポイントは次の形式です。

```text
POST /__gasboost/{rpcName}
```

例えば、

```ts
const app = new AppsScript().call(
  "sum",
  ({ a, b }: { a: number; b: number }) => a + b,
);

export default app;
```

に対して、

```http
POST /__gasboost/sum
Content-Type: application/json
```

```json
{
  "input": { "a": 1, "b": 2 }
}
```

を送信すると、内部では次の dispatch が実行されます。

```ts
app.dispatch("sum", { a: 1, b: 2 });
```

レスポンス:

```json
3
```

## RPC Request

Request Body は次の形式です。

```ts
type RpcRequestBody = {
  input?: unknown;
  metadata?: Record<string, unknown>;
};
```

業務データは単一の `input` として渡します。例えば:

```ts
app.call("example", (input: { id: number; name: string; active: boolean }) => {
  // ...
});
```

に対して、

```json
{
  "input": { "id": 1, "name": "Taro", "active": true },
  "metadata": {
    "@my-app/tracing": { "traceId": "trace-1" }
  }
}
```

のように送信できます。

`metadata` は任意です。指定すると `app.dispatch(name, input, metadata)` の
第3引数へそのまま渡され、middleware の `context.invocation.metadata` で参照できます。
Vite はmetadataをinputへ混ぜず、そのキーや値の意味も解釈しません。
metadata自体はオブジェクトである必要がありますが、内部の値のschemaは定義しません。

`@gasboost/app` 5.2.0以降と`@gasboost/client` 0.5.0以降では、
metadata providerとRPC単位のmetadataをLocal RPCでも利用できます。

```ts
const { client } = appsScriptClient<AppType>({
  metadataProviders: [() => ({ "@my-app/tracing": { traceId: "trace-1" } })],
});

await client.example(
  { id: 1, name: "Taro", active: true },
  { metadata: { "@my-app/request": { id: "request-1" } } },
);
```

開発時の自動差し替えによる`FetchTransport`もmetadataを維持します。
未指定時は従来どおりinputだけをdispatchへ渡します。

### 引数なし RPC

Request Body が空の場合は、引数なし RPC として扱われます。

```http
POST /__gasboost/noArgs
```

内部では次のように dispatch されます。

```ts
app.dispatch("noArgs", undefined);
```

明示的に送る場合は次でも構いません。

```json
{}
```

inputを省略してmetadataだけを送信することもできます。
この場合は本番の`AppsScriptTransport`と同じく`input`を`null`としてdispatchへ渡します。
middlewareの`context.invocation.input`とhandlerのinputも`null`になります。
metadataも省略した場合は、従来どおり`undefined`です。

```json
{
  "metadata": { "@my-app/tracing": { "traceId": "trace-1" } }
}
```

## RPC Response

`@gasboost/app` の `dispatch()` が返す `AppsScriptResponse.contents` を、そのまま HTTP Response Body として返します。

例えば、

```ts
app.call("getUser", () => ({
  id: 1,
  name: "Taro",
}));
```

に対するレスポンスは:

```json
{
  "id": 1,
  "name": "Taro"
}
```

となります。

Response の Content-Type は:

```text
application/json; charset=utf-8
```

です。

## Async RPC

非同期 RPC にも対応しています。

```ts
app.call("loadUser", async (id: string) => {
  const user = await loadUser(id);

  return user;
});
```

dev plugin は `dispatch()` の完了を待ってからレスポンスを返します。

## 開発中の module loading

RPC リクエストごとに、指定された `entry` を Vite の `ssrLoadModule()` で読み込みます。

```text
POST /__gasboost/sum
        ↓
ssrLoadModule("src/server.ts")
        ↓
AppsScript.dispatch("sum", ...)
```

そのため、Vite Dev Server 上の最新のサーバーコードを利用して RPC を実行できます。

## Error Response

### 不正な Request Body

JSON として不正な body や、bodyがオブジェクトでない場合は `400` を返します。
また、`metadata` に `null`・配列・文字列などを指定した場合も `400` を返します。

```json
{
  "metadata": "invalid"
}
```

レスポンス例:

```json
{
  "error": {
    "name": "InvalidRpcRequestError",
    "message": "Invalid RPC request body. Expected metadata to be an object."
  }
}
```

JSON 自体が不正な場合も `400` です。

### POST 以外

Local RPC endpoint は POST のみ受け付けます。

```http
GET /__gasboost/sum
```

は `405` になります。

```json
{
  "error": {
    "name": "MethodNotAllowedError",
    "message": "Only POST is allowed."
  }
}
```

### 未登録 RPC

存在しない RPC を呼び出した場合は `500` を返します。

```text
POST /__gasboost/unknown
```

```json
{
  "error": {
    "name": "Error",
    "message": "Function unknown is not registered."
  }
}
```

### Handler Error

RPC handler 内で例外が発生した場合も `500` として JSON で返されます。

```json
{
  "error": {
    "name": "TypeError",
    "message": "handler failed"
  }
}
```

## Local RPC の対象 path

次の形式だけを RPC として扱います。

```text
/__gasboost/{rpcName}
```

例えば以下は対象です。

```text
/__gasboost/getUser
/__gasboost/sum
```

一方、次のような path は RPC として扱いません。

```text
/__gasboost/
/__gasboost/foo/bar
/api/users
```

通常の Vite middleware chain に処理を渡します。

query string が付いていても RPC 名は正しく解決されます。

```text
/__gasboost/hello?foo=bar
```

URL encoded な RPC 名も decode されます。

```text
/__gasboost/hello%20world
```

---

## Client Transport

`@gasboost/client` を利用している場合、dev plugin はローカル開発時の transport を自動で Local RPC に切り替えます。

アプリケーション側では development / production を判定する必要はありません。

```ts
import { appsScriptClient } from "@gasboost/client";
import type { App } from "./server";

const { client } = appsScriptClient<App>();

const result = await client.sum(1, 2);
```

Vite Dev Server 上では、dev plugin が自動的に `FetchTransport` を適用します。

```text
appsScriptClient()
        ↓
FetchTransport
        ↓
POST /__gasboost/{rpcName}
        ↓
AppsScript.dispatch()
```

そのため、ローカル開発用に transport を切り替えるコードを書く必要はありません。

```ts
// 不要
appsScriptClient({
  transport: import.meta.env.DEV
    ? new FetchTransport({
        endpoint: "/__gasboost",
      })
    : new AppsScriptTransport(),
});
```

明示的に `transport` を指定した場合も、default では Local RPC 用の `FetchTransport` に差し替えます。

```ts
appsScriptClient({
  transport: customTransport,
});
```

この場合も Vite Dev Server 上では `POST /__gasboost/{rpcName}` を利用します。

実 GAS / Bridge との integration test などで明示 transport を維持したい場合は、`localRpc.override` を `false` にしてください。

```ts
const { dev } = gasboost({
  entry: "src/server.ts",
  localRpc: {
    override: false,
  },
});
```

production build では dev plugin による差し替えは行われません。

GAS 上では `appsScriptClient()` のデフォルトである `AppsScriptTransport` がそのまま利用されます。

```text
appsScriptClient()
        ↓
AppsScriptTransport
        ↓
google.script.run
```

つまり、同じ application code のまま local development と GAS production の両方で利用できます。

```ts
const { client } = appsScriptClient<App>();
```

---

## HtmlTemplate variables

GAS の `HtmlTemplate` では、`<?= variable ?>` を使用してサーバー側の値を HTML に埋め込めます。

```html
<script>
  const variables = "<?= variables ?>";
</script>
```

GAS 上では `HtmlTemplate` によって評価されますが、Vite Dev Server では GAS のテンプレート処理が実行されません。

`@gasboost/vite` では、`template` オプションを指定することで、開発時にこれらの template variables を置換できます。

```ts
import { gasboost } from "@gasboost/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    gasboost({
      entry: "./src/backend/main.ts",
      template: {
        variables: JSON.stringify({
          scriptId: "local-script-id",
          isSetupCompleted: true,
          isTermsAccepted: true,
        }),
      },
    }).dev,
  ],
});
```

例えば、次の HTML は、

```html
<script>
  const variables = "<?= variables ?>";
</script>
```

Vite の開発環境では次のように変換されます。

```html
<script>
  const variables =
    '{"scriptId":"local-script-id","isSetupCompleted":true,"isTermsAccepted":true}';
</script>
```

複数の template variable も指定できます。

```ts
gasboost({
  entry: "./src/backend/main.ts",
  template: {
    environment: "development",
    userName: "Tiger",
  },
});
```

```html
<p>Environment: <?= environment ?></p>
<p>User: <?= userName ?></p>
```

`template` の型は `Record<string, string>` です。

値の serialize は `@gasboost/vite` では行いません。オブジェクトなどを埋め込む場合は、利用側で `JSON.stringify()` などを使用して文字列へ変換してください。

`template` による置換は Vite Dev Server でのみ行われます。production build では値を埋め込まず、GAS 上で実際の `HtmlTemplate` が template expression を評価します。

---

# build と dev の責務

```text
gasboost()
   │
   ├─ build
   │    ├─ AppsScript の静的解析
   │    ├─ GAS グローバル関数生成
   │    ├─ GAS 向け build config
   │    └─ backend production build
   │
   └─ dev
        ├─ Vite Dev Server middleware
        ├─ Local RPC endpoint
        ├─ entry の ssrLoadModule
        └─ AppsScript.dispatch
```

frontend と backend を1つの `vite.config.ts` で扱う場合は、mode で分岐します。

```ts
const { build, dev } = gasboost({
  entry: "src/server.ts",
});

export default defineConfig(({ mode }) => {
  if (mode === "server") {
    return {
      plugins: [build],
    };
  }

  return {
    plugins: [dev],
  };
});
```

`build` を通常の frontend build に含めると、server entry が Vite の build input になるため、frontend と backend の build は分離してください。

---

## GAS ランタイム

`@gasboost/vite` は、build 時と local RPC 実行時に server entry を実際に評価します。

一般的な GAS API は、デフォルトのローカルランタイムから提供されます。

```ts
import { gasboost } from "@gasboost/vite";

export default gasboost({
  entry: "./src/server.ts",
});
```

entry の初期化時に追加の GAS API が必要な場合は、`runtime` から差し込めます。

```ts
import { SpreadsheetAppStub } from "@gasboost/sheetorm";
import { gasboost } from "@gasboost/vite";

export default gasboost({
  entry: "./src/server.ts",
  runtime: {
    SpreadsheetApp: SpreadsheetAppStub,
  },
});
```

`runtime` に渡した値は、デフォルトのローカルランタイムを上書きします。

このランタイムは build 時の entry 評価と、local RPC 実行時の両方で利用されます。

基本的には、module 初期化時に必要な API だけを差し込み、実際の GAS API 呼び出しは handler 実行時まで遅延させることを推奨します。

## ランタイム解析

GET / POST / RPC の登録状態は、entry ファイルを静的解析するのではなく、実際に評価された `AppsScript` インスタンスから取得します。

そのため、import 先、ヘルパー関数、loop、`AppsScript.calls()` 経由の登録にも対応できます。

```ts
const app = new AppsScript();

for (const [name, handler] of Object.entries(handlers)) {
  app.call(name, handler);
}

export default app;
```

## 関連パッケージ

- `@gasboost/app` — GAS バックエンドランタイムと RPC 定義
- `@gasboost/client` — フロントエンド側の型安全 RPC クライアント

## License

MIT
