const mbt = await import("./src/core/_build/js/debug/build/src/main/main.js");
const r = mbt.resolve_affected_json('task("a", srcs=["src/a/*"])', '["src/a/foo.ts"]');
console.log("result (may contain parse errors):", r);
