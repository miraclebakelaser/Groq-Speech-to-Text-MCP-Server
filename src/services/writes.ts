import fs from "node:fs/promises";
import path from "node:path";

export async function writeTextFile(options: {
  outputPath: string;
  contents: string;
  overwrite: boolean;
}): Promise<{ savedPath: string; bytesWritten: number }> {
  const { outputPath, contents, overwrite } = options;

  if (outputPath.includes("\0")) {
    throw new Error("Invalid output_path (contains null byte).");
  }

  const resolvedTarget = path.resolve(outputPath);
  const parent = path.dirname(resolvedTarget);

  await fs.mkdir(parent, { recursive: true });

  const flag = overwrite ? "w" : "wx";
  await fs.writeFile(resolvedTarget, contents, { encoding: "utf8", flag });
  const savedStat = await fs.stat(resolvedTarget);
  return { savedPath: resolvedTarget, bytesWritten: savedStat.size };
}
