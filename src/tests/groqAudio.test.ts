import test from "node:test";
import assert from "node:assert/strict";

import { groqCreateTranscription } from "../services/groqAudio.js";
import { GroqAudioResponseFormat } from "../schemas/transcribe.js";
import { HttpError } from "../services/errors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("groqCreateTranscription: retries on 429 then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: "rate_limited" });
      return jsonResponse(200, { text: "ok" });
    }) as unknown as typeof fetch;

    const result = await groqCreateTranscription("test-key", {
      url: "https://example.com/audio.wav",
      model: "whisper-large-v3-turbo",
      response_format: GroqAudioResponseFormat.JSON
    });

    assert.equal(calls, 2);
    assert.ok(result.rawText.includes("\"text\""));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("groqCreateTranscription: does not retry on 400", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse(400, { error: "bad_request" });
    }) as unknown as typeof fetch;

    await assert.rejects(
      () =>
        groqCreateTranscription("test-key", {
          url: "https://example.com/audio.wav",
          model: "whisper-large-v3-turbo",
          response_format: GroqAudioResponseFormat.JSON
        }),
      (err) => err instanceof HttpError && err.status === 400
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

