///|
pub(all) struct FixtureConfig {
  test_count : Int
  commit_count : Int
  flaky_rate : Double
  co_failure_strength : Double
  files_per_commit : Int
  tests_per_file : Int
  sample_percentage : Double
  seed : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FixtureTest {
  suite : String
  test_name : String
  is_flaky : Bool
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FixtureChangedFile {
  file_path : String
  change_type : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FixtureCommitResult {
  suite : String
  test_name : String
  status : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FixtureCommit {
  sha : String
  changed_files : Array[FixtureChangedFile]
  test_results : Array[FixtureCommitResult]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FixtureFileDep {
  file : String
  suites : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct FixtureData {
  tests : Array[FixtureTest]
  files : Array[String]
  file_deps : Array[FixtureFileDep]
  commits : Array[FixtureCommit]
  config : FixtureConfig
} derive(Eq, Show, FromJson, ToJson)
