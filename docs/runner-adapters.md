# Runner Adapters

metrici はテストランナーごとの違いを吸収する Runner Adapter を提供します。テストケースの個別実行、一覧取得、結果パースを統一的に扱えます。

## 組み込みアダプタ

### Vitest

```toml
[runner]
type = "vitest"
command = "pnpm vitest"    # デフォルト
```

| 操作 | 実行されるコマンド |
|------|------------------|
| テスト実行 | `pnpm vitest run -t "testA\|testB" --reporter json` |
| テスト一覧 | `pnpm vitest --list --reporter json` |

結果パース: Vitest JSON reporter の `testResults[].assertionResults[]` からステータス・所要時間・エラーメッセージを抽出。

### Playwright Test

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test"    # デフォルト
```

| 操作 | 実行されるコマンド |
|------|------------------|
| テスト実行 | `pnpm exec playwright test --grep "testA\|testB" --reporter json` |
| テスト一覧 | `pnpm exec playwright test --list --reporter json` |

結果パース: Playwright JSON reporter の `suites[].specs[].tests[].results[]` から retry 検出を含むステータスを抽出。`retry_count > 0 && 最終 pass` のテストは `flaky` ステータスとして記録。

### Moon Test (MoonBit)

```toml
[runner]
type = "moontest"
command = "moon test"    # デフォルト
```

| 操作 | 実行されるコマンド |
|------|------------------|
| テスト実行 | `moon test --filter "pkg::testA\|pkg::testB"` |
| テスト一覧 | `moon test --dry-run` |

結果パース: stdout の `test <name> ... ok/FAILED` パターンをパース。パッケージパスをスイート名、テスト関数名をテスト名として分離。

## カスタムアダプタ

任意のテストランナーを JSON プロトコルで接続できます。

```toml
[runner]
type = "custom"
execute = "node ./my-runner.js execute"
list = "node ./my-runner.js list"
```

### プロトコル仕様

#### `execute` コマンド

metrici が stdin に JSON を送り、stdout から JSON を受け取ります。

**stdin:**

```json
{
  "tests": [
    { "suite": "tests/login.spec.ts", "testName": "should redirect" },
    { "suite": "tests/home.spec.ts", "testName": "should load" }
  ],
  "opts": {
    "cwd": "/path/to/project",
    "timeout": 30000,
    "retries": 0,
    "env": { "NODE_ENV": "test" }
  }
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `tests` | `TestId[]` | 実行するテスト一覧 |
| `tests[].suite` | `string` | ファイルパスまたはスイート名 |
| `tests[].testName` | `string` | テストケース名 |
| `opts.cwd` | `string?` | 作業ディレクトリ |
| `opts.timeout` | `number?` | タイムアウト（ミリ秒） |
| `opts.retries` | `number?` | リトライ回数 |
| `opts.env` | `object?` | 追加の環境変数 |

**stdout:**

```json
{
  "exitCode": 1,
  "results": [
    {
      "suite": "tests/login.spec.ts",
      "testName": "should redirect",
      "status": "passed",
      "durationMs": 1200,
      "retryCount": 0
    },
    {
      "suite": "tests/home.spec.ts",
      "testName": "should load",
      "status": "failed",
      "durationMs": 5000,
      "retryCount": 0,
      "errorMessage": "Timeout waiting for element"
    }
  ],
  "durationMs": 6200,
  "stdout": "...",
  "stderr": "..."
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `exitCode` | `number` | プロセス終了コード（0 = 全 pass） |
| `results` | `TestCaseResult[]` | 各テストの結果 |
| `results[].status` | `string` | `"passed"` / `"failed"` / `"skipped"` / `"flaky"` |
| `results[].durationMs` | `number` | 実行時間（ミリ秒） |
| `results[].retryCount` | `number` | リトライ回数（0 = リトライなし） |
| `results[].errorMessage` | `string?` | エラーメッセージ（失敗時） |
| `results[].variant` | `object?` | 実行環境の情報（`{"os": "linux", "browser": "chromium"}` 等） |
| `durationMs` | `number` | 全体の実行時間 |
| `stdout` | `string` | 標準出力（ログ用） |
| `stderr` | `string` | 標準エラー出力 |

#### `list` コマンド

引数なしで実行され、stdout に TestId の JSON 配列を返します。

**stdout:**

```json
[
  { "suite": "tests/login.spec.ts", "testName": "should redirect" },
  { "suite": "tests/login.spec.ts", "testName": "should display form" },
  { "suite": "tests/home.spec.ts", "testName": "should load" }
]
```

### カスタムアダプタの実装例

#### Node.js

```javascript
#!/usr/bin/env node
import { execSync } from "node:child_process";

const mode = process.argv[2]; // "execute" or "list"

if (mode === "list") {
  // テスト一覧を返す
  const tests = [
    { suite: "tests/math.test.ts", testName: "add" },
    { suite: "tests/math.test.ts", testName: "multiply" },
  ];
  console.log(JSON.stringify(tests));
} else if (mode === "execute") {
  // stdin から実行対象を読む
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { tests, opts } = JSON.parse(input);

  const results = [];
  const start = Date.now();

  for (const test of tests) {
    const cmd = `npx vitest run -t "${test.testName}" ${test.suite}`;
    try {
      execSync(cmd, { cwd: opts?.cwd, timeout: opts?.timeout });
      results.push({ ...test, status: "passed", durationMs: 0, retryCount: 0 });
    } catch (e) {
      results.push({
        ...test, status: "failed", durationMs: 0, retryCount: 0,
        errorMessage: e.stderr?.toString() ?? "Unknown error",
      });
    }
  }

  console.log(JSON.stringify({
    exitCode: results.some(r => r.status === "failed") ? 1 : 0,
    results,
    durationMs: Date.now() - start,
    stdout: "",
    stderr: "",
  }));
}
```

#### Python

```python
#!/usr/bin/env python3
import json, sys, subprocess, time

mode = sys.argv[1]  # "execute" or "list"

if mode == "list":
    tests = [
        {"suite": "tests/test_math.py", "testName": "test_add"},
        {"suite": "tests/test_math.py", "testName": "test_multiply"},
    ]
    print(json.dumps(tests))

elif mode == "execute":
    data = json.load(sys.stdin)
    tests = data["tests"]
    results = []
    start = time.time()

    for t in tests:
        cmd = f"pytest {t['suite']}::{t['testName']} -x"
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        results.append({
            "suite": t["suite"],
            "testName": t["testName"],
            "status": "passed" if proc.returncode == 0 else "failed",
            "durationMs": 0,
            "retryCount": 0,
            "errorMessage": proc.stderr if proc.returncode != 0 else None,
        })

    print(json.dumps({
        "exitCode": 1 if any(r["status"] == "failed" for r in results) else 0,
        "results": results,
        "durationMs": int((time.time() - start) * 1000),
        "stdout": "",
        "stderr": "",
    }))
```

#### Shell Script

```bash
#!/bin/bash
# my-runner.sh execute|list

if [ "$1" = "list" ]; then
  echo '[{"suite":"tests/test.sh","testName":"test_basic"}]'
elif [ "$1" = "execute" ]; then
  INPUT=$(cat)
  # ... run tests based on $INPUT ...
  echo '{"exitCode":0,"results":[],"durationMs":0,"stdout":"","stderr":""}'
fi
```

## TestId の設計

`TestId` はテストケースを一意に識別するための言語中立な構造です。

```typescript
interface TestId {
  suite: string;      // ファイルパスまたはスイート名
  testName: string;   // テストケース名
}
```

| ランナー | suite の例 | testName の例 |
|---------|-----------|---------------|
| Vitest | `tests/math.test.ts` | `add returns sum` |
| Playwright | `tests/login.spec.ts` | `should redirect after login` |
| MoonBit | `mizchi/pkg/module` | `test_add` |
| pytest | `tests/test_math.py` | `test_add` |
| Go | `./pkg/math` | `TestAdd` |

`suite` と `testName` の組み合わせでテストケースを一意に特定します。同じテスト名が異なるスイートに存在しても区別できます。

## metrici との統合フロー

```
metrici sample --strategy hybrid --count 20
  → TestId[] を出力

metrici run --strategy hybrid --count 20
  → sample で TestId[] を選択
  → RunnerAdapter.execute(TestId[]) で実行
  → ExecuteResult.results を DB に自動格納
  → metrici eval で健全性評価
```

Runner Adapter の結果は自動的に metrici の DuckDB に格納されるため、実行するたびにデータが蓄積され、flaky 検出・トレンド分析・bisect の精度が向上します。
