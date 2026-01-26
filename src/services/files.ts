import fs from "node:fs/promises";
import path from "node:path";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${bytes} bytes (~${mb.toFixed(1)}MB)`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${bytes} bytes (~${kb.toFixed(1)}KB)`;
  return `${bytes} bytes`;
}

const GROQ_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class FileInputError extends Error {
  readonly code:
    | "invalid_file_path"
    | "file_not_found"
    | "file_path_not_a_file"
    | "file_empty"
    | "file_too_large";
  readonly details?: Record<string, unknown>;

  constructor(
    code: FileInputError["code"],
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "FileInputError";
    this.code = code;
    this.details = details;
  }
}

export async function readAudioFile(filePath: string): Promise<{
  filename: string;
  bytes: Buffer;
}> {
  if (filePath.includes("\0")) {
    throw new FileInputError("invalid_file_path", "Invalid file_path (contains null byte).");
  }

  const resolved = path.resolve(filePath);

  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) {
    throw new FileInputError("file_not_found", `Audio file not found at file_path='${filePath}'.`);
  }
  if (!stat.isFile()) {
    throw new FileInputError("file_path_not_a_file", `file_path must point to a file, got: '${filePath}'.`);
  }
  if (stat.size === 0) {
    throw new FileInputError(
      "file_empty",
      "Audio file is empty (0 bytes). Provide a non-empty audio file or use url.",
      { size_bytes: 0 }
    );
  }
  if (stat.size > GROQ_MAX_ATTACHMENT_BYTES) {
    throw new FileInputError(
      "file_too_large",
      `Audio file too large (${formatBytes(stat.size)}). Groq file uploads are limited to ${formatBytes(GROQ_MAX_ATTACHMENT_BYTES)}. Please provide a smaller file or use url.`,
      { size_bytes: stat.size, max_bytes: GROQ_MAX_ATTACHMENT_BYTES }
    );
  }

  const buffer = await fs.readFile(resolved);
  return { filename: path.basename(resolved), bytes: buffer };
}
