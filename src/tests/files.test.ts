import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { readAudioFile } from "../services/files.js";
import { writeTextFile } from "../services/writes.js";

test("readAudioFile: errors for missing file", async () => {
  await assert.rejects(() => readAudioFile("does-not-exist.wav"), /not found/i);
});

test("readAudioFile: reads bytes and filename", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
  const filePath = path.join(dir, "audio.wav");
  await fs.writeFile(filePath, Buffer.from([1, 2, 3]));

  const result = await readAudioFile(filePath);
  assert.equal(result.filename, "audio.wav");
  assert.equal(result.bytes.length, 3);
});

test("readAudioFile: rejects oversized file (Groq upload cap)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
  const filePath = path.join(dir, "big.wav");
  await fs.writeFile(filePath, "x");
  await fs.truncate(filePath, 26 * 1024 * 1024);

  await assert.rejects(() => readAudioFile(filePath), /too large/i);
});

test("writeTextFile: creates parent directories and respects overwrite", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
  const outputPath = path.join(dir, "nested", "out.txt");

  const first = await writeTextFile({ outputPath, contents: "hello", overwrite: false });
  assert.equal(first.bytesWritten > 0, true);

  await assert.rejects(
    () => writeTextFile({ outputPath, contents: "again", overwrite: false }),
    /EEXIST/i
  );

  const overwritten = await writeTextFile({ outputPath, contents: "again", overwrite: true });
  assert.equal(overwritten.savedPath, outputPath);
});
