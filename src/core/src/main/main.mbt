///|
fn main {
  ()
}

///|
pub fn detect_flaky_json(input_json : String) -> String {
  let input : @types.DetectInput = try! @json.from_json(
    try! @json.parse(input_json),
  )
  let output = @flaky_detector.detect_flaky(input)
  output.to_json().stringify()
}

///|
pub fn sample_random_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_random(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_weighted_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_weighted(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}
