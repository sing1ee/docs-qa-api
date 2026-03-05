import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

/** Ensure path is within project directory */
function safePath(projectDir: string, filePath: string): string {
  const resolved = resolve(projectDir, filePath);
  if (!resolved.startsWith(projectDir)) {
    throw new Error(`Path "${filePath}" is outside project directory`);
  }
  return resolved;
}

export interface GrepArgs {
  pattern: string;
  glob?: string;
}

export interface ReadFileArgs {
  path: string;
  start_line?: number;
  end_line?: number;
}

/** grep tool: search codebase for pattern */
export function grepTool(projectDir: string, args: GrepArgs): string {
  const { pattern, glob: fileGlob } = args;
  const includeFlag = fileGlob ? `--include='${fileGlob}'` : "";
  const cmd = `grep -rn ${includeFlag} --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git -m 50 -- ${JSON.stringify(pattern)} .`;

  try {
    const result = execSync(cmd, {
      cwd: projectDir,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    });
    const lines = result.trim().split("\n");
    if (lines.length >= 50) {
      return lines.join("\n") + "\n\n(truncated at 50 matches)";
    }
    return lines.join("\n") || "No matches found.";
  } catch (e: any) {
    if (e.status === 1) return "No matches found.";
    return `Error: ${e.message}`;
  }
}

/** read_file tool: read file content with optional line range */
export function readFileTool(projectDir: string, args: ReadFileArgs): string {
  const absPath = safePath(projectDir, args.path);
  try {
    const content = readFileSync(absPath, "utf-8");
    const lines = content.split("\n");

    const start = (args.start_line ?? 1) - 1;
    const end = args.end_line ?? lines.length;
    const selected = lines.slice(Math.max(0, start), end);

    // Add line numbers
    return selected.map((line, i) => `${start + i + 1}: ${line}`).join("\n");
  } catch (e: any) {
    return `Error reading file: ${e.message}`;
  }
}

/** Execute a tool by name */
export function executeTool(
  projectDir: string,
  name: string,
  args: Record<string, unknown>
): string {
  switch (name) {
    case "grep":
      return grepTool(projectDir, args as unknown as GrepArgs);
    case "read_file":
      return readFileTool(projectDir, args as unknown as ReadFileArgs);
    default:
      return `Unknown tool: ${name}`;
  }
}

/** Tool definitions for LLM function calling */
export const toolDefinitions = [
  {
    name: "grep",
    description:
      "Search for a pattern (string or regex) across the codebase. Returns matching lines with file paths and line numbers. Limited to 50 matches.",
    parameters: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string" as const,
          description: "Search pattern (string or regex)",
        },
        glob: {
          type: "string" as const,
          description:
            'Optional file glob filter, e.g. "*.ts" or "*.md"',
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file. Returns content with line numbers. Use start_line/end_line to read specific sections of large files.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "File path relative to project root",
        },
        start_line: {
          type: "number" as const,
          description: "Start line number (1-based, inclusive)",
        },
        end_line: {
          type: "number" as const,
          description: "End line number (1-based, inclusive)",
        },
      },
      required: ["path"],
    },
  },
];
