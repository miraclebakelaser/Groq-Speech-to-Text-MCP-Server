import test from "node:test";
import assert from "node:assert/strict";

import { TranscribeAudioInputSchema, GroqAudioResponseFormat } from "../schemas/transcribe.js";

test("transcribe schema: requires items", () => {
  assert.throws(() => TranscribeAudioInputSchema.parse({}), /items/i);
});

test("transcribe schema: each item chooses file_path or url", () => {
  assert.throws(() => TranscribeAudioInputSchema.parse({ items: [{}] }), /choose one source/i);
  assert.throws(
    () =>
      TranscribeAudioInputSchema.parse({
        items: [{ file_path: "a.wav", url: "https://example.com/a.wav" }]
      }),
    /choose one source/i
  );

  const okUrl = TranscribeAudioInputSchema.parse({ items: [{ url: "https://example.com/a.wav" }] });
  assert.equal(okUrl.items[0].url, "https://example.com/a.wav");
});

test("transcribe schema: timestamp_granularities requires verbose_json", () => {
  assert.throws(
    () =>
      TranscribeAudioInputSchema.parse({
        items: [{ url: "https://example.com/a.wav" }],
        response_format: GroqAudioResponseFormat.TEXT,
        timestamp_granularities: ["word"]
      }),
    /verbose_json/i
  );
});

test("transcribe schema: item ids must be unique when provided", () => {
  assert.throws(
    () =>
      TranscribeAudioInputSchema.parse({
        items: [
          { id: "dup", url: "https://example.com/a.wav" },
          { id: "dup", url: "https://example.com/b.wav" }
        ]
      }),
    /duplicate item id/i
  );
});

test("transcribe schema: rejects legacy top-level shortcut fields", () => {
  assert.throws(
    () => TranscribeAudioInputSchema.parse({ url: "https://example.com/a.wav" }),
    /unrecognized key/i
  );
});

test("transcribe schema: rejects alias fields path/audio_path", () => {
  assert.throws(
    () => TranscribeAudioInputSchema.parse({ items: [{ path: "/abs/a.mp3" }] }),
    /unrecognized key/i
  );
  assert.throws(
    () => TranscribeAudioInputSchema.parse({ items: [{ audio_path: "/abs/b.mp3" }] }),
    /unrecognized key/i
  );
});

test("transcribe schema: default model is whisper-large-v3-turbo", () => {
  const parsed = TranscribeAudioInputSchema.parse({ items: [{ url: "https://example.com/a.wav" }] });
  assert.equal(parsed.model, "whisper-large-v3-turbo");
});
