import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import AdmZip from "adm-zip";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    i++;
  }
  return args;
}

async function githubGetJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function githubDownload(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Artifact download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function withArtifactSuffix(fileName, artifactId) {
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  return `${stem}__artifact_${artifactId}${ext}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes("/")) {
    console.error("Error: --repo <owner/name> or GITHUB_REPOSITORY is required");
    process.exit(1);
  }

  const outDir = resolve(args.out ?? ".artifacts/self-host-metrics");
  const artifactName = args["artifact-name"] ?? "flaker-self-host-metrics";
  const days = Number(args.days ?? "30");
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const [owner, name] = repo.split("/");

  mkdirSync(outDir, { recursive: true });

  let page = 1;
  let artifactsSeen = 0;
  let parquetFiles = 0;

  while (true) {
    const payload = await githubGetJson(
      `https://api.github.com/repos/${owner}/${name}/actions/artifacts?per_page=100&page=${page}`,
      token,
    );
    const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
    if (artifacts.length === 0) {
      break;
    }

    for (const artifact of artifacts) {
      if (artifact.name !== artifactName || artifact.expired) {
        continue;
      }
      const createdAt = Date.parse(artifact.created_at ?? "");
      if (Number.isFinite(createdAt) && createdAt < cutoffMs) {
        continue;
      }

      artifactsSeen++;
      const zipBuffer = await githubDownload(artifact.archive_download_url, token);
      const zip = new AdmZip(zipBuffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = basename(entry.entryName);
        if (!entryName.endsWith(".parquet")) continue;
        const target = join(outDir, withArtifactSuffix(entryName, artifact.id));
        writeFileSync(target, entry.getData());
        parquetFiles++;
      }
    }

    if (artifacts.length < 100) {
      break;
    }
    page++;
  }

  console.log(`Downloaded ${artifactsSeen} artifacts, extracted ${parquetFiles} parquet files to ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
