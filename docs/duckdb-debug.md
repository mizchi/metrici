# DuckDB デバッグメモ

`duckdb.node` が見つからない場合は、次の順に確認してください。

1. `pnpm ignored-builds` で `duckdb` が無視されていないか確認
2. `package.json` の `pnpm.onlyBuiltDependencies` に `duckdb` を追加
3. Node ヘッダをローカル指定して再ビルド

```bash
npm_config_nodedir=$(dirname $(dirname $(which node))) pnpm rebuild duckdb
```

## この環境で確認したこと

- 事象: `Cannot find module .../duckdb/lib/binding/duckdb.node`
- 原因1: `pnpm` が `duckdb` のビルドスクリプトを自動無視していた
- 原因2: プロキシ下で `node-gyp` が Node ヘッダを外部取得しようとして 403 になり得る
- 対策: `npm_config_nodedir` を指定してローカル Node ヘッダを使う
