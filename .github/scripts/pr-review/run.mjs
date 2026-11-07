#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");

function parseArgs(argv) {
  const args = {
    base: "origin/main",
    head: "HEAD",
    config: ".github/pr-review.config.json",
    output: "review-report.json",
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--head") args.head = argv[++i];
    else if (argv[i] === "--config") args.config = argv[++i];
    else if (argv[i] === "--output") args.output = argv[++i];
  }
  return args;
}

const MAX_BUFFER = 50 * 1024 * 1024;
const MAX_ESLINT_FILES = 50;

function runGit(command) {
  return execSync(command, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  }).trim();
}

function loadConfig(path) {
  const fullPath = join(repoRoot, path);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function getChangedFiles(base, head) {
  const raw = runGit(`git diff --name-status ${base}...${head}`);
  if (!raw) return [];
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status.trim(), path: rest.join("\t").trim() };
    });
}

function getAddedLines(base, head) {
  const raw = runGit(`git diff -U0 ${base}...${head}`);
  const fileLines = new Map();
  let currentFile = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      if (!fileLines.has(currentFile)) fileLines.set(currentFile, []);
      continue;
    }
    if (!currentFile || !line.startsWith("+") || line.startsWith("+++"))
      continue;
    fileLines.get(currentFile).push({ content: line.slice(1), lineHint: null });
  }

  return fileLines;
}

function finding(section, severity, file, message, line = null) {
  return { section, severity, file, message, line };
}

function checkStructure(changedFiles, config) {
  const results = [];
  const { allowedPaths, allowedExactFiles, componentExtensions } =
    config.structure;

  for (const { status, path } of changedFiles) {
    if (status !== "A" || !componentExtensions.includes(extname(path)))
      continue;
    if (allowedExactFiles.includes(path)) continue;
    if (allowedPaths.some((prefix) => path.startsWith(prefix))) continue;
    if (path.includes("/_components/") || path.includes("/components/"))
      continue;

    results.push(
      finding(
        "structure",
        "error",
        path,
        `New component outside allowed trees. Use src/components/ui/, _components/, or settings components.`
      )
    );
  }

  return results;
}

function checkReuse(changedFiles, config) {
  const results = [];
  const newFiles = changedFiles.filter((f) => f.status === "A");

  for (const { path } of newFiles) {
    const name = basename(path).toLowerCase();

    for (const shared of config.reuse.sharedComponents) {
      if (
        name === shared.name &&
        !path.replace(/\\/g, "/").endsWith(shared.path)
      ) {
        results.push(
          finding(
            "reuse",
            "warning",
            path,
            `Similar to existing ${shared.path}. Extend the shared component instead.`
          )
        );
      }
    }

    for (const pattern of config.reuse.duplicatePatterns) {
      if (basename(path).includes(pattern)) {
        results.push(
          finding(
            "reuse",
            "warning",
            path,
            `Filename matches known duplicate pattern "${pattern}". Check buzz-management vs meeting folders.`
          )
        );
      }
    }
  }

  return results;
}

function checkImports(changedFiles, config) {
  const results = [];
  const sourceFiles = changedFiles.filter(
    (f) => /\.(tsx?|jsx?)$/.test(f.path) && f.status !== "D"
  );

  for (const { path } of sourceFiles) {
    const fullPath = join(repoRoot, path);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");

    for (const [index, line] of content.split("\n").entries()) {
      if (
        line.includes(`from "${config.imports.deprecatedAlias}`) ||
        line.includes(`from '${config.imports.deprecatedAlias}`)
      ) {
        results.push(
          finding(
            "imports",
            "warning",
            path,
            `Uses ${config.imports.deprecatedAlias} alias — project uses ${config.imports.preferredAlias} only.`,
            index + 1
          )
        );
      }
    }
  }

  return results;
}

const HARDCODED_URL_RE = /https?:\/\/[^\s"'`<>\\)]+/gi;

function extractHardcodedUrls(content) {
  const matches = content.match(HARDCODED_URL_RE) || [];
  return matches
    .map((url) => url.replace(/[.,;]+$/, ""))
    .filter((url) => /^https?:\/\/[^/?#]+/i.test(url));
}

function isAllowedUrl(url, allowPatterns) {
  return allowPatterns.some((pattern) => new RegExp(pattern, "i").test(url));
}

function checkHardcodedUrls(addedLines, config) {
  const results = [];
  const {
    allowPatterns = [],
    scanExtensions,
    excludePathPrefixes = [],
  } = config.hardcodedUrls;

  for (const [file, lines] of addedLines.entries()) {
    if (!scanExtensions.includes(extname(file))) continue;
    if (
      excludePathPrefixes.some((prefix) =>
        file.replace(/\\/g, "/").startsWith(prefix)
      )
    ) {
      continue;
    }

    for (const { content } of lines) {
      if (!content.includes("http")) continue;

      const urls = extractHardcodedUrls(content);
      for (const url of urls) {
        if (isAllowedUrl(url, allowPatterns)) continue;

        results.push(
          finding(
            "hardcodedUrls",
            "error",
            file,
            `Hardcoded URL added: "${url}". Put base URLs and secrets in environment variables (e.g. process.env.NEXT_PUBLIC_BASE_URL).`
          )
        );
      }
    }
  }

  return results;
}

function shannonEntropy(value) {
  if (!value) return 0;
  const freq = new Map();
  for (const ch of value) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const ATTR_OR_PATH_NAMES = new Set([
  "id",
  "src",
  "href",
  "className",
  "class",
  "type",
  "name",
  "htmlFor",
  "xmlns",
  "xmlnsXlink",
  "in",
  "in2",
  "result",
  "fill",
  "stroke",
  "d",
  "viewBox",
  "width",
  "height",
  "alt",
  "title",
  "placeholder",
  "target",
  "rel",
  "role",
  "lang",
  "style",
  "scrollableTarget",
]);

function looksLikePathOrUrl(value) {
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[./]/.test(value)) return true;
  if (
    /\.(svg|png|jpe?g|gif|webp|mp3|mp4|css|js|json|woff2?|tsx?|jsx?)$/i.test(
      value
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeSecretValue(value, minLength, minEntropy) {
  if (!value || /\s/.test(value)) return false;
  if (value.length < minLength) return false;
  if (looksLikePathOrUrl(value)) return false;
  if (value.includes("process.env") || value.includes("import.meta.env")) {
    return false;
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return false;
  if (shannonEntropy(value) < minEntropy) return false;
  return true;
}

function checkGenericSecretAssignments(content, file, config, results) {
  const generic = config.secrets.genericAssignments;
  if (!generic) return;

  const { minLength = 20, minEntropy = 3.5 } = generic;
  const assignmentRe =
    /(?:(const|let|var)\s+)?([A-Za-z_][\w]*)\s*=\s*["']([^"']+)["']/g;

  for (const match of content.matchAll(assignmentRe)) {
    const declared = Boolean(match[1]);
    const name = match[2];
    const value = match[3];
    if (!name || !value) continue;
    if (!declared && ATTR_OR_PATH_NAMES.has(name)) continue;
    if (!looksLikeSecretValue(value, minLength, minEntropy)) continue;

    results.push(
      finding(
        "secrets",
        "error",
        file,
        `Hardcoded secret assigned to "${name}". Put keys and secrets in environment variables.`
      )
    );
  }
}

function checkSecrets(changedFiles, addedLines, config) {
  const results = [];

  for (const { status, path } of changedFiles) {
    if (status === "D") continue;
    for (const pattern of config.secrets.forbiddenFilePatterns) {
      if (new RegExp(pattern, "i").test(path)) {
        results.push(
          finding(
            "secrets",
            "error",
            path,
            "Env or credential file must not be committed. Add to .gitignore and remove from the PR."
          )
        );
      }
    }
  }

  for (const [file, lines] of addedLines.entries()) {
    if (config.secrets.excludeFromLineScan.includes(file)) continue;
    if (!config.secrets.scanExtensions.includes(extname(file))) continue;
    if (file.replace(/\\/g, "/").startsWith("cypress/")) continue;

    for (const { content } of lines) {
      if (!content.trim() || content.trim().startsWith("//")) continue;

      for (const { name, pattern } of config.secrets.addedLinePatterns) {
        if (new RegExp(pattern).test(content)) {
          results.push(
            finding(
              "secrets",
              "error",
              file,
              `Possible secret detected (${name}). Use environment variables instead.`
            )
          );
        }
      }

      checkGenericSecretAssignments(content, file, config, results);
    }
  }

  return results;
}

function runJscpd(changedFiles, config) {
  const results = [];
  const sourceFiles = changedFiles
    .filter(
      (f) =>
        f.status !== "D" &&
        /^src\/.*\.(tsx?|jsx?)$/.test(f.path.replace(/\\/g, "/"))
    )
    .map((f) => f.path);

  if (sourceFiles.length === 0) return results;

  try {
    const listPath = join(
      repoRoot,
      ".github/scripts/pr-review/changed-files.txt"
    );
    writeFileSync(listPath, sourceFiles.join("\n"));
    const cmd = [
      "pnpm exec jscpd",
      `--min-lines ${config.jscpd.minLines}`,
      `--min-tokens ${config.jscpd.minTokens}`,
      "--reporters json",
      "--silent",
      ...sourceFiles.map((f) => `"${f}"`),
    ].join(" ");
    execSync(cmd, { cwd: repoRoot, stdio: "pipe" });
  } catch (error) {
    const stdout = error.stdout?.toString() || "";
    if (stdout.includes("duplicates") || stdout.includes("clone")) {
      results.push(
        finding(
          "duplicates",
          "warning",
          "multiple",
          "jscpd detected duplicate code blocks in changed files. Consider extracting shared code."
        )
      );
    }
  }

  return results;
}

function runEslint(changedFiles) {
  const results = [];
  const lintFiles = changedFiles
    .filter((f) => f.status !== "D" && /\.(tsx?|jsx?)$/.test(f.path))
    .map((f) => f.path)
    .slice(0, MAX_ESLINT_FILES);

  if (lintFiles.length === 0) return results;

  try {
    execSync(`pnpm exec eslint ${lintFiles.map((f) => `"${f}"`).join(" ")}`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch (error) {
    const output =
      (error.stdout?.toString() || "") + (error.stderr?.toString() || "");
    const lines = output.split("\n").filter((l) => l.trim());
    for (const line of lines.slice(0, 20)) {
      if (line.includes(" error ") || line.includes(" warning ")) {
        results.push(finding("eslint", "error", "changed-files", line.trim()));
      }
    }
    if (results.length === 0) {
      results.push(
        finding(
          "eslint",
          "error",
          "changed-files",
          "ESLint reported issues in changed files."
        )
      );
    }
  }

  return results;
}

function renderMarkdown(findings, changedCount) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const sections = [
    "structure",
    "reuse",
    "hardcodedUrls",
    "secrets",
    "duplicates",
    "imports",
    "eslint",
  ];
  const titles = {
    structure: "Structure",
    reuse: "Reuse existing components",
    hardcodedUrls: "Hardcoded URLs",
    secrets: "Env / secrets",
    duplicates: "Duplicate code (jscpd)",
    imports: "Imports",
    eslint: "ESLint (changed files)",
  };

  let md = `## PR Review Bot\n\n**${changedCount} files changed** | ${errors.length} errors | ${warnings.length} warnings\n\n`;

  for (const section of sections) {
    const items = findings.filter((f) => f.section === section);
    if (items.length === 0) continue;
    md += `### ${titles[section]}\n\n`;
    for (const item of items) {
      const prefix = item.severity === "error" ? "ERROR" : "WARN";
      const loc = item.line ? `:${item.line}` : "";
      md += `- **${prefix}**: \`${item.file}${loc}\` — ${item.message}\n`;
    }
    md += "\n";
  }

  if (findings.length === 0) {
    md += "No issues found in changed files.\n";
  }

  return md;
}

function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.config);
  const changedFiles = getChangedFiles(args.base, args.head);
  const addedLines = getAddedLines(args.base, args.head);

  const findings = [
    ...checkStructure(changedFiles, config),
    ...checkReuse(changedFiles, config),
    ...checkImports(changedFiles, config),
    ...checkHardcodedUrls(addedLines, config),
    ...checkSecrets(changedFiles, addedLines, config),
    ...runJscpd(changedFiles, config),
    ...runEslint(changedFiles),
  ];

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const report = {
    changedFiles: changedFiles.length,
    errors: errors.length,
    warnings: warnings.length,
    findings,
    markdown: renderMarkdown(findings, changedFiles.length),
    success: config.failOnWarnings
      ? errors.length + warnings.length === 0
      : errors.length === 0,
  };

  writeFileSync(join(repoRoot, args.output), JSON.stringify(report, null, 2));
  writeFileSync(
    join(repoRoot, args.output.replace(/\.json$/, ".md")),
    report.markdown
  );

  if (!report.success) {
    process.exit(1);
  }
}

main();
