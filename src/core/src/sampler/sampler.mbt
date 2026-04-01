///|
fn lcg_next(state : UInt64) -> UInt64 {
  state * 6364136223846793005UL + 1442695040888963407UL
}

///|
pub fn sample_random(
  meta : Array[@types.TestMeta],
  count~ : Int,
  seed~ : UInt64,
) -> Array[@types.TestMeta] {
  let n = meta.length()
  if n == 0 {
    return []
  }
  let actual_count = if count > n { n } else { count }
  // Copy array for Fisher-Yates shuffle
  let arr = Array::makei(n, fn(i) { meta[i] })
  let mut state = seed
  for i in 0..<actual_count {
    state = lcg_next(state)
    let remaining = (n - i).to_uint64()
    let j = i + (state % remaining).to_int()
    arr.swap(i, j)
  }
  Array::makei(actual_count, fn(i) { arr[i] })
}

///|
pub fn sample_weighted(
  meta : Array[@types.TestMeta],
  count~ : Int,
  seed~ : UInt64,
) -> Array[@types.TestMeta] {
  let n = meta.length()
  if n == 0 {
    return []
  }
  let actual_count = if count > n { n } else { count }
  // Build weights
  let weights = Array::makei(n, fn(i) { 1.0 + meta[i].flaky_rate })
  let selected : Array[@types.TestMeta] = []
  let used = Array::make(n, false)
  let mut state = seed
  for _ in 0..<actual_count {
    // Compute total weight of unused items
    let mut total_weight = 0.0
    for i in 0..<n {
      if !used[i] {
        total_weight = total_weight + weights[i]
      }
    }
    // Generate random value in [0, total_weight)
    state = lcg_next(state)
    let rand_val = (state % 1000000UL).to_int().to_double() /
      1000000.0 *
      total_weight
    // Select based on cumulative weight
    let mut cumulative = 0.0
    let mut picked = -1
    for i in 0..<n {
      if !used[i] {
        cumulative = cumulative + weights[i]
        if cumulative > rand_val && picked < 0 {
          picked = i
        }
      }
    }
    // Fallback: pick last unused
    if picked < 0 {
      for i = n - 1; i >= 0; i = i - 1 {
        if !used[i] {
          picked = i
          break
        }
      }
    }
    used[picked] = true
    selected.push(meta[picked])
  }
  selected
}
