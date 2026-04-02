# TODO

## 進行中
- [x] DuckDB のネイティブバイナリが無い環境で CLI が即死しないよう、`duckdb` 初期化を遅延ロード + エラーメッセージ改善する
- [x] `resolveAffectedFallback` のパーサを複数行 `task(...)` 定義に対応させる
- [x] `resolveAffectedFallback` の glob 解釈を MoonBit 実装仕様と突き合わせる（差分テスト追加）

## 次のマイルストーン
- [x] `flaker doctor` コマンドを追加し、DuckDB/MoonBit の実行環境チェックを 1 コマンドで確認可能にする
- [x] CI で「MoonBit あり / なし」の 2 パターンを回し、フォールバック経路を常時検証する

## 完了済み
- [x] MoonBit 未ビルド時でも affected target を解決できる TypeScript fallback を実装
