# flaker Management Theory

この skill が前提にしている理論は 4 つある。

- staged build / fast feedback
- flaky test quarantine
- deterministic visual testing
- AI 時代の proactive QA

## 1. staged build / fast feedback

PR の commit build は速くあるべきで、重い検査は後段に逃がす。
だから flaker 運用では:

- PR gate を小さく保つ
- full execution は nightly / schedule に置く

を基本にする。

参考:

- Martin Fowler, Continuous Integration  
  <https://martinfowler.com/articles/continuousIntegration.html>

## 2. flaky test quarantine

non-deterministic test を healthy な gate suite と混ぜると、CI への信頼が壊れる。
したがって:

- quarantine する
- stable なら戻す
- quarantine を放置しない

が必要になる。

参考:

- Martin Fowler, Eradicating Non-Determinism in Tests  
  <https://martinfowler.com/articles/nonDeterminism.html>
- Google Testing Blog, Flaky Tests at Google and How We Mitigate Them  
  <https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html?m=1>
- Google Testing Blog, Where do our flaky tests come from?  
  <https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html>

## 3. deterministic visual testing

VRT は threshold 以前に環境固定が本体。
Playwright の visual comparison でも baseline と比較対象は同一環境が前提で、`mask` `stylePath` `animation disable` などを使ってノイズを消す。

参考:

- Playwright Best Practices  
  <https://playwright.dev/docs/best-practices>
- Playwright Visual comparisons  
  <https://playwright.dev/docs/next/test-snapshots>
- Playwright Page Assertions  
  <https://playwright.dev/docs/api/class-pageassertions>

## 4. proactive QA in AI-accelerated development

AI 生成コードでは `理解の負債` と `意図の負債` が増えやすい。
だからテストは `Verdict` だけでなく `Learning` の役割を持たせるべきで、QA は後追い検出だけでなく、先に意図・契約・リスクを作る方向に寄る。

参考:

- 翻訳記事: <https://nihonbuson.hatenadiary.jp/entry/QA-activities-in-response-to-generated-code>
- 元記事と discussion は翻訳記事のリンク先を辿ること

この skill が `Learning lane`、per-test contract、failure reason の記録を強く勧める理由はここにある。
