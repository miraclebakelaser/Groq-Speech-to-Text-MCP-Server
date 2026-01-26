import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { transcribeAudioTool } from "../tools/transcribe.js";
import { GroqAudioResponseFormat } from "../schemas/transcribe.js";
import { TranscribeAudioInputSchema } from "../schemas/transcribe.js";

function response(status: number, body: string, contentType: string): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

test("transcribeAudioTool: auto-saves .txt for response_format=text", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalCwd = process.cwd();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
  try {
    process.chdir(dir);
    process.env.GROQ_API_KEY = "test-key";
    globalThis.fetch = (async () => response(200, "hello world", "text/plain")) as unknown as typeof fetch;

    const input = TranscribeAudioInputSchema.parse({
      items: [{ url: "https://example.com/audio.wav" }],
      response_format: GroqAudioResponseFormat.TEXT
    });
    const result = await transcribeAudioTool(input);

    assert.equal(result.isError ?? false, false);
    const first = (result.structured as any).results[0];
    assert.equal(first.ok, true);
    assert.equal(first.output.saved, true);
    assert.equal(first.output.saved_format, "text");
    const savedPath = first.output.saved_path as string;
    assert.ok(savedPath.endsWith(".txt"));

    const contents = await fs.readFile(savedPath, "utf8");
    assert.equal(contents.trim(), "hello world");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GROQ_API_KEY = originalApiKey;
    process.chdir(originalCwd);
  }
});

test("transcribeAudioTool: save_as uses an explicit filename (no timestamp)", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalCwd = process.cwd();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
  try {
    process.chdir(dir);
    process.env.GROQ_API_KEY = "test-key";
    globalThis.fetch = (async () => response(200, "hello", "text/plain")) as unknown as typeof fetch;

    const input = TranscribeAudioInputSchema.parse({
      items: [{ url: "https://example.com/audio.wav", save_as: "episode_S01E04.txt" }],
      response_format: GroqAudioResponseFormat.TEXT
    });
    const result = await transcribeAudioTool(input);

    assert.equal(result.isError ?? false, false);
    const first = (result.structured as any).results[0];
    assert.equal(first.ok, true);
    const savedPath = first.output.saved_path as string;
    assert.ok(savedPath.endsWith("transcripts/episode_S01E04.txt"));
    const contents = await fs.readFile(savedPath, "utf8");
    assert.equal(contents.trim(), "hello");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GROQ_API_KEY = originalApiKey;
    process.chdir(originalCwd);
  }
});

test("transcribeAudioTool: auto-saves .json for response_format=json", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalCwd = process.cwd();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
  try {
    process.chdir(dir);
    process.env.GROQ_API_KEY = "test-key";
    globalThis.fetch = (async () => response(200, JSON.stringify({ text: "ok" }), "application/json")) as unknown as typeof fetch;

    const input = TranscribeAudioInputSchema.parse({
      items: [{ url: "https://example.com/audio.wav" }],
      response_format: GroqAudioResponseFormat.JSON
    });
    const result = await transcribeAudioTool(input);

    assert.equal(result.isError ?? false, false);
    const first = (result.structured as any).results[0];
    assert.equal(first.ok, true);
    assert.equal(first.output.saved, true);
    assert.equal(first.output.saved_format, "json");
    const savedPath = first.output.saved_path as string;
    assert.ok(savedPath.endsWith(".json"));

    const contents = await fs.readFile(savedPath, "utf8");
    const savedJson = JSON.parse(contents) as any;
    assert.equal(savedJson.transcript, "ok");
    assert.equal(savedJson.groq_response.text, "ok");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GROQ_API_KEY = originalApiKey;
    process.chdir(originalCwd);
  }
});
