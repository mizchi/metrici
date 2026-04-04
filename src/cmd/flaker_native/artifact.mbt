///|
fn bytes_to_string(b : Bytes) -> String {
  let buf = StringBuilder::new()
  for i = 0; i < b.length(); i = i + 1 {
    buf.write_char(Char::from_int(b[i].to_int()))
  }
  buf.to_string()
}

///| A parsed test result.
struct TestResult {
  suite : String
  test_name : String
  status : String
  duration_ms : Int
  error_message : String
}

///| Download artifact and import test results for a workflow run.
///  Returns number of test results imported.
pub async fn process_run_artifact(
  client : @github_client.GitHubClient,
  db : @duckdb.Connection,
  config : FlakerConfig,
  run : @github_actions.WorkflowRun,
) -> Int {
  let run_id = run.id.to_int()

  let artifacts = @github_actions.list_artifacts(
    client,
    config.owner,
    config.name,
    run_id,
  )

  for artifact in artifacts.artifacts {
    if artifact.name == config.artifact_name && !artifact.expired {
      // Download artifact (ZIP)
      let zip_bytes = @github_actions.download_artifact(
        client,
        config.owner,
        config.name,
        artifact.id.to_int(),
      )
      // Extract JSON files from ZIP and parse test results
      let entries = unzip(zip_bytes)
      let mut count = 0
      for entry in entries {
        if entry.name.has_suffix(".json") {
          let text = bytes_to_string(entry.data)
          let results = parse_vitest_json_text(text)
          if results.length() > 0 {
            insert_test_results(db, results, run)
            count = count + results.length()
          }
        }
      }
      return count
    }
  }
  0
}

///| Try to parse text as vitest JSON reporter output.
fn parse_vitest_json_text(text : String) -> Array[TestResult] {
  let json = try {
    @json.parse(text)
  } catch {
    _ => return []
  }
  parse_vitest_json(json)
}

///| Parse vitest --reporter=json output.
fn parse_vitest_json(json : Json) -> Array[TestResult] {
  let results : Array[TestResult] = []
  guard json.as_object() is Some(root) else { return results }
  guard root.get("testResults") is Some(Json::Array(test_files)) else {
    return results
  }
  for file_json in test_files {
    guard file_json.as_object() is Some(file_obj) else { continue }
    let file_name = match file_obj.get("name") {
      Some(Json::String(s)) => s
      _ => continue
    }
    guard file_obj.get("assertionResults") is Some(Json::Array(assertions)) else {
      continue
    }
    for assertion_json in assertions {
      guard assertion_json.as_object() is Some(a) else { continue }
      let full_name = match a.get("fullName") {
        Some(Json::String(s)) => s
        _ => continue
      }
      let status_str = match a.get("status") {
        Some(Json::String(s)) => s
        _ => continue
      }
      if status_str == "pending" || status_str == "todo" {
        continue
      }
      let duration = match a.get("duration") {
        Some(Json::Number(n)) => n.to_int()
        _ => 0
      }
      let error_msg = match a.get("failureMessages") {
        Some(Json::Array(msgs)) if msgs.length() > 0 =>
          match msgs[0] {
            Json::String(s) => s
            _ => ""
          }
        _ => ""
      }
      let parts = full_name.split(" > ")
      let parts_arr : Array[String] = []
      for p in parts {
        parts_arr.push(p.to_string())
      }
      let test_name = if parts_arr.length() > 0 {
        parts_arr[parts_arr.length() - 1]
      } else {
        full_name
      }
      let suite = if parts_arr.length() > 1 {
        let buf = StringBuilder::new()
        for i = 0; i < parts_arr.length() - 1; i = i + 1 {
          if i > 0 {
            buf.write_string(" > ")
          }
          buf.write_string(parts_arr[i])
        }
        buf.to_string()
      } else {
        file_name
      }
      results.push({
        suite,
        test_name,
        status: if status_str == "passed" { "passed" } else { "failed" },
        duration_ms: duration,
        error_message: error_msg,
      })
    }
  }
  results
}

///| Insert test results into DuckDB.
fn insert_test_results(
  db : @duckdb.Connection,
  results : Array[TestResult],
  run : @github_actions.WorkflowRun,
) -> Unit {
  let run_id = run.id.to_int()
  for r in results {
    let suite = r.suite.replace(old="'", new="''")
    let name = r.test_name.replace(old="'", new="''")
    let err = r.error_message.replace(old="'", new="''")
    let sql = "INSERT INTO test_results (id, workflow_run_id, suite, test_name, status, duration_ms, error_message, commit_sha, created_at) VALUES (nextval('test_results_id_seq'), \{run_id}, '\{suite}', '\{name}', '\{r.status}', \{r.duration_ms}, '\{err}', '\{run.head_sha}', '\{run.created_at}')"
    exec_sql(db, sql)
  }
}
