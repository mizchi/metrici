# ADR-007: ビルドキャッシュの所有権 — flaker は持たない、bitflow が持つ

**日付:** 2026-03-31
**ステータス:** Accepted

## コンテキスト

vite-task はファイル内容ハッシュ + fspy (syscall 監視) によるビルドキャッシュを実装しており、タスク実行の無駄を排除している。flaker にも同様のキャッシュを持つべきか検討した。

## 決定

**flaker はビルドキャッシュを持たない。bitflow が持つべき。**

### 理由

flaker の価値は「テストを繰り返し実行して統計を取る」こと。キャッシュでテスト実行をスキップすると、flaky 検出に必要なデータが溜まらない。flaky テストは「同じコードで結果が変わる」ことが本質であり、キャッシュヒットで skip するのは目的と矛盾する。

### 責務の分離

| 判断 | 所有者 | ロジック |
|------|--------|---------|
| このタスクはビルド済みか？ | **bitflow** | fingerprint 比較でスキップ |
| このテストを実行すべきか？ | **flaker** | affected + sampling + quarantine |
| この結果をキャッシュから返すか？ | **bitflow** | ビルドタスクのみ。テストは常に実行 |

### actrun との連携での役割分担

```
actrun workflow run ci.yml
  ├── job: build     → bitflow がキャッシュ判定 → skip or execute
  ├── job: lint      → bitflow がキャッシュ判定 → skip or execute
  └── job: test      → flaker がテスト選択 → 常に実行 → 結果蓄積
```

### flaker が代わりに行うこと

キャッシュではなく「選択」でスループットを出す:

- **quarantine**: 既知の flaky を除外（Google TAP 式）
- **affected**: 変更と無関係なテストを除外（依存グラフ解析）
- **sampling**: 全テストの一部をランダム/重み付きで選択
- **orchestrator**: バッチ分割 + 並列実行でスループット最適化

### bitflow との連携可能性

bitflow のキャッシュヒット情報を flaker の flaky 判定に活用できる:

- bitflow キャッシュヒット（= コード変更なし）なのにテストが失敗 → **確実に flaky**
- これは DeFlaker の「差分カバレッジ」アプローチに相当する
- 将来的に bitflow がキャッシュ情報を構造化出力すれば、flaker の true flaky 検出の精度が向上する

## 結果

- flaker はテスト実行結果のキャッシュを持たない
- ビルドキャッシュは bitflow/vite-task の責務
- flaker は「テスト選択の最適化」と「結果の統計分析」に専念する
