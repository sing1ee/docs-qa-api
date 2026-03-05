import { readFileSync, statSync } from "node:fs";
import { relative, basename, dirname } from "node:path";
import { glob } from "glob";

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.*",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DOC_EXTENSIONS = [".md", ".mdx", ".txt"];

/** Extract exported symbols from a TypeScript/JavaScript file */
function extractTsExports(content: string): string[] {
  const symbols: string[] = [];
  const exportRegex =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(content)) !== null) {
    symbols.push(match[1]);
  }
  // Also catch: export { name1, name2 }
  const reExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    symbols.push(...names.filter(Boolean));
  }
  return [...new Set(symbols)];
}

/** Extract title and summary from a markdown file */
function extractMdSummary(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  const titleLine = lines.find((l) => l.startsWith("#"));
  const title = titleLine ? titleLine.replace(/^#+\s*/, "") : "";
  const bodyLines = lines
    .filter((l) => !l.startsWith("#") && !l.startsWith("---"))
    .slice(0, 3)
    .join(" ")
    .slice(0, 150);
  return [title, bodyLines].filter(Boolean).join(" — ");
}

/** Count lines in content */
function countLines(content: string): number {
  return content.split("\n").length;
}

/** Build a tree-style directory listing */
function buildTree(files: string[], projectDir: string): string {
  const relpaths = files.map((f) => relative(projectDir, f)).sort();
  const lines: string[] = [];
  const dirs = new Set<string>();

  for (const rp of relpaths) {
    const parts = rp.split("/");
    // Ensure parent dirs are shown
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") + "/";
      if (!dirs.has(dir)) {
        dirs.add(dir);
        const indent = "  ".repeat(i - 1);
        lines.push(`${indent}${parts[i - 1]}/`);
      }
    }
    const indent = "  ".repeat(parts.length - 1);
    lines.push(`${indent}${parts[parts.length - 1]}`);
  }

  return lines.join("\n");
}

export async function buildIndex(projectDir: string): Promise<string> {
  const files = await glob("**/*.{ts,tsx,js,jsx,md,mdx,txt}", {
    cwd: projectDir,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  // Sort for consistent output
  files.sort();

  const tree = buildTree(files, projectDir);
  const summaries: string[] = [];

  for (const file of files) {
    const relPath = relative(projectDir, file);
    const ext = file.slice(file.lastIndexOf("."));

    try {
      const content = readFileSync(file, "utf-8");
      const lineCount = countLines(content);

      if (TS_EXTENSIONS.includes(ext)) {
        const exports = extractTsExports(content);
        const exportStr = exports.length > 0 ? `\n  exports: ${exports.join(", ")}` : "";
        summaries.push(`- ${relPath} (${lineCount} lines)${exportStr}`);
      } else if (DOC_EXTENSIONS.includes(ext)) {
        const summary = extractMdSummary(content);
        summaries.push(`- ${relPath} (${lineCount} lines)\n  ${summary}`);
      }
    } catch {
      summaries.push(`- ${relPath} (unreadable)`);
    }
  }

  return `## Directory Structure\n\n${tree}\n\n## File Summaries\n\n${summaries.join("\n")}`;
}
