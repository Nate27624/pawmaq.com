import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PRIVATE_KEY_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/,
  /PuTTY-User-Key-File-\d+:\s*ssh-(?:rsa|ed25519|dss)/i
];

const BINARY_FILE_PATTERN =
  /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mov|webm|woff2?|ttf|eot|mp3|wav|ogg|avif|heic)$/i;
const ALLOW_INLINE_MARKER = "security-ignore-private-key";

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
  throw new Error("Usage: node scripts/security/private-key-scan.mjs --staged|--tracked");
}

function isLikelyBinary(content) {
  return content.includes("\u0000");
}

function scanFileForPrivateKeys(filePath) {
  if (!existsSync(filePath) || BINARY_FILE_PATTERN.test(filePath)) {
    return [];
  }
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  if (!content || isLikelyBinary(content)) {
    return [];
  }
  if (content.includes(ALLOW_INLINE_MARKER)) {
    return [];
  }

  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of PRIVATE_KEY_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          filePath,
          line: index + 1,
          excerpt: line.trim().slice(0, 160)
        });
      }
    }
  }
  return findings;
}

function main() {
  const mode = process.argv[2] ?? "";
  const targets = resolveTargets(mode);
  const findings = [];
  for (const filePath of targets) {
    findings.push(...scanFileForPrivateKeys(filePath));
  }

  if (findings.length === 0) {
    console.log(`private-key scan (${mode.replace("--", "")}): no matches in ${targets.length} file(s)`);
    return;
  }

  console.error("Potential private key material detected:");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} -> ${finding.excerpt}`);
  }
  console.error(`Add '${ALLOW_INLINE_MARKER}' only for intentional non-sensitive test fixtures.`);
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`private-key scan failed: ${message}`);
  process.exitCode = 1;
}
