///|
fn make_test_meta(name : String, flaky_rate : Double) -> @types.TestMeta {
  @types.TestMeta::{
    suite: "suite",
    test_name: name,
    flaky_rate,
    total_runs: 10,
    fail_count: 0,
    last_run_at: "2026-01-01",
    avg_duration_ms: 100,
    previously_failed: false,
    is_new: false,
  }
}

///|
test "random sampling selects correct count" {
  let items = Array::makei(20, fn(i) {
    make_test_meta("test_" + i.to_string(), 0.0)
  })
  let result = @sampler.sample_random(items, count=5, seed=42UL)
  assert_eq(result.length(), 5)
}

///|
test "random sampling returns all when count > total" {
  let items = [make_test_meta("a", 0.0), make_test_meta("b", 0.0)]
  let result = @sampler.sample_random(items, count=10, seed=42UL)
  assert_eq(result.length(), 2)
}

///|
test "weighted sampling prefers flaky tests" {
  let stable = make_test_meta("stable", 0.0)
  let flaky = make_test_meta("flaky", 0.8)
  let items = [stable, flaky]
  let mut flaky_count = 0
  for i in 0..<100 {
    let result = @sampler.sample_weighted(
      items,
      count=1,
      seed=i.to_uint64() * 12345UL + 1UL,
    )
    if result[0].test_name == "flaky" {
      flaky_count += 1
    }
  }
  assert_true(flaky_count > 50)
}
