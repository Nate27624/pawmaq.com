import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CHUNK_SIZE = 80;
const BINARY_FILE_PATTERN =
  /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mov|webm|woff2?|ttf|eot|mp3|wav|ogg|avif|heic)$/i;

function runGitCommand(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const errorText = result.stderr?.trim() || `git ${args.join(" ")} failed`;
    throw new Error(errorText);
  }
  return result.stdout;
}

function parseNullSeparatedList(value) {
  return value
    .split("\u0000")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveTargets(mode) {
  if (mode === "--staged") {
    return parseNullSeparatedList(runGitCommand(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]));
  }
  if (mode === "--tracked") {
    return parseNullSeparatedList(runGitCommand(["ls-files", "-z"]));
  }
  throw new Error("Usage: node scripts/security/secretlint-scan.mjs --staged|--tracked");
}

function filterFiles(paths) {
  return paths.filter((filePath) => existsSync(filePath) && !BINARY_FILE_PATTERN.test(filePath));
}

function chunk(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function runSecretlintBatch(files) {
  const command = [
    "--maskSecrets",
    "--format",
    "stylish",
    "--secretlintignore",
    ".secretlintignore",
    ...files
  ];
  const binary = process.platform === "win32"
    ? resolve(process.cwd(), "node_modules", ".bin", "secretlint.cmd")
    : resolve(process.cwd(), "node_modules", ".bin", "secretlint");
  const result = spawnSync(binary, command, {
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`secretlint execution error: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function main() {
  const mode = process.argv[2] ?? "";
  const targets = filterFiles(resolveTargets(mode));
  if (targets.length === 0) {
    console.log(`secretlint (${mode.replace("--", "")}): no text files to scan`);
    return;
  }

  let hasFailures = false;
  for (const files of chunk(targets, CHUNK_SIZE)) {
    const status = runSecretlintBatch(files);
    if (status !== 0) {
      hasFailures = true;
    }
  }

  if (hasFailures) {
    process.exitCode = 1;
    return;
  }
  console.log(`secretlint (${mode.replace("--", "")}): scanned ${targets.length} file(s)`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`secretlint scan failed: ${message}`);
  process.exitCode = 1;
}
