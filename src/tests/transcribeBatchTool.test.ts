import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { transcribeAudioTool } from "../tools/transcribe.js";
import { TranscribeAudioInputSchema } from "../schemas/transcribe.js";

function textResponse(status: number, body: string, contentType: string): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

test("transcribeAudioTool: returns per-item results and respects concurrency", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalCwd = process.cwd();

  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
    process.chdir(dir);
    process.env.GROQ_API_KEY = "test-key";

    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;

    globalThis.fetch = (async () => {
      calls += 1;
      const callNumber = calls;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));

        if (callNumber % 2 === 0)
          return textResponse(400, JSON.stringify({ error: "bad_request" }), "application/json");
        return textResponse(200, "hello", "text/plain");
      } finally {
        inFlight -= 1;
      }
    }) as unknown as typeof fetch;

    const parsed = TranscribeAudioInputSchema.parse({
      items: [
        { id: "a", url: "https://example.com/a.wav" },
        { id: "b", url: "https://example.com/b.wav" },
        { id: "c", url: "https://example.com/c.wav" },
        { id: "d", url: "https://example.com/d.wav" },
        { id: "e", url: "https://example.com/e.wav" }
      ],
      concurrency: 2
    });

    const result = await transcribeAudioTool(parsed);

    assert.equal(maxInFlight <= 2, true);

    const structured = result.structured as any;
    assert.equal(structured.summary.total, 5);
    assert.equal(structured.summary.ok, 3);
    assert.equal(structured.summary.failed, 2);
    assert.equal(structured.results.length, 5);

    assert.equal(structured.results[0].ok, true);
    assert.equal(structured.results[0].id, "a");
    assert.equal(structured.results[0].output.transcript, "hello");

    assert.equal(structured.results[1].ok, false);
    assert.equal(structured.results[1].id, "b");
    assert.equal(structured.results[1].error.code, "groq_api_error");
    assert.equal(structured.results[1].error.status, 400);

    assert.equal(typeof result.contentText, "string");
    assert.match(result.contentText, /transcription complete/i);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GROQ_API_KEY = originalApiKey;
    process.chdir(originalCwd);
  }
});

test("transcribeAudioTool: errors when GROQ_API_KEY is missing", async () => {
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalCwd = process.cwd();
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groq-stt-"));
    process.chdir(dir);
    delete process.env.GROQ_API_KEY;

    const parsed = TranscribeAudioInputSchema.parse({
      items: [{ url: "https://example.com/a.wav" }]
    });

    const result = await transcribeAudioTool(parsed);

    assert.equal(result.isError, true);
    assert.match(result.contentText, /GROQ_API_KEY is not set/i);
  } finally {
    process.env.GROQ_API_KEY = originalApiKey;
    process.chdir(originalCwd);
  }
});

test("transcribeAudioTool: schema rejects empty input", () => {
  assert.throws(() => TranscribeAudioInputSchema.parse({}), /items/i);
});

test("transcribeAudioTool: schema rejects legacy single-input shortcut", () => {
  assert.throws(
    () => TranscribeAudioInputSchema.parse({ url: "https://example.com/a.wav" }),
    /unrecognized key/i
  );
});
