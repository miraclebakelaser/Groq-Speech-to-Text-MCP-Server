import test from "node:test";
import assert from "node:assert/strict";

import { TranscribeAudioInputSchema, GroqAudioResponseFormat } from "../schemas/transcribe.js";

test("transcribe schema: defaults items to [] for empty input", () => {
  const parsed = TranscribeAudioInputSchema.parse({});
  assert.deepEqual(parsed.items, []);
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

test("transcribe schema: accepts legacy single shape and wraps as items[0]", () => {
  const parsed = TranscribeAudioInputSchema.parse({ url: "https://example.com/a.wav" });
  assert.equal(parsed.items.length, 0);
  assert.equal((parsed as any).url, "https://example.com/a.wav");
});

test("transcribe schema: accepts common aliases path/audio_path and maps to file_path", () => {
  const parsedPath = TranscribeAudioInputSchema.parse({ items: [{ path: "/abs/a.mp3" }] });
  assert.equal((parsedPath.items[0] as any).path, "/abs/a.mp3");

  const parsedAudioPath = TranscribeAudioInputSchema.parse({ items: [{ audio_path: "/abs/b.mp3" }] });
  assert.equal((parsedAudioPath.items[0] as any).audio_path, "/abs/b.mp3");
});

test("transcribe schema: default model is whisper-large-v3-turbo", () => {
  const parsed = TranscribeAudioInputSchema.parse({ items: [{ url: "https://example.com/a.wav" }] });
  assert.equal(parsed.model, "whisper-large-v3-turbo");
});
