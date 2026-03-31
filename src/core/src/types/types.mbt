///|
pub(all) struct TestMeta {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  last_run_at : String
  avg_duration_ms : Int
  previously_failed : Bool
  is_new : Bool
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FlakyResult {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  flaky_retry_count : Int
  is_quarantined : Bool
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct DetectInput {
  results : Array[TestRunEntry]
  threshold : Double
  min_runs : Int
} derive(FromJson, ToJson)

///|
pub(all) struct TestRunEntry {
  suite : String
  test_name : String
  status : String
  retry_count : Int
} derive(FromJson, ToJson)

///|
pub(all) struct DetectOutput {
  flaky_tests : Array[FlakyResult]
} derive(Eq, Show, FromJson, ToJson)
