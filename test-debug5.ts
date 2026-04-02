const mbt = await import("./_build/js/debug/build/cmd/flaker/flaker.js");
const r = mbt.resolve_affected_json('task("a", srcs=["src/a/*"])', '["src/a/foo.ts"]');
console.log("result (may contain parse errors):", r);
