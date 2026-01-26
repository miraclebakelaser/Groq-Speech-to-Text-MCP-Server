import fs from "node:fs/promises";
import path from "node:path";

const TRANSCRIPTS_DIR = "transcripts";

function timestampSlug(date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  const ms = pad(date.getUTCMilliseconds(), 3);
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}${ms}Z`;
}

function sanitizeSegment(segment: string): string {
  const trimmed = segment.trim();
  const replaced = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const collapsed = replaced.replace(/_+/g, "_");
  return collapsed.replace(/^_+|_+$/g, "").slice(0, 120) || "transcript";
}

function baseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    const last = pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname;
    const withoutExt = last.replace(/\.[a-zA-Z0-9]+$/, "");
    return sanitizeSegment(withoutExt.length > 0 ? withoutExt : "audio");
  } catch {
    return "audio";
  }
}

export function deriveTranscriptBaseName(source: { file_path?: string; url?: string }): string {
  if (source.file_path) {
    const base = path.basename(source.file_path).replace(/\.[a-zA-Z0-9]+$/, "");
    return sanitizeSegment(base);
  }
  if (source.url) return baseNameFromUrl(source.url);
  return "transcript";
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function reserveTranscriptPath(options: {
  baseName: string;
  extension: "txt" | "json";
  saveAs?: string;
}): Promise<string> {
  const dirPath = path.resolve(TRANSCRIPTS_DIR);
  await ensureDir(dirPath);

  const ext = options.extension;

  if (options.saveAs) {
    const raw = options.saveAs.trim();
    const safe = sanitizeSegment(raw);
    const extMatch = safe.match(/\.([a-zA-Z0-9]+)$/);
    const providedExt = extMatch ? extMatch[1].toLowerCase() : null;
    if (providedExt && providedExt !== ext) {
      throw new Error(`save_as extension '.${providedExt}' does not match expected '.${ext}'.`);
    }
    const filename = providedExt ? safe : `${safe}.${ext}`;
    return path.join(dirPath, filename);
  }

  const base = sanitizeSegment(options.baseName);

  const ts = timestampSlug();
  const first = path.join(dirPath, `${base}__${ts}.${ext}`);
  if (!(await exists(first))) return first;

  for (let i = 2; i <= 10_000; i++) {
    const candidate = path.join(dirPath, `${base}__${ts}__${i}.${ext}`);
    if (!(await exists(candidate))) return candidate;
  }

  throw new Error("Unable to reserve a transcript filename (too many collisions).");
}
