import { z } from "zod";

export const TranscribeAudioOutputSchema = z
  .object({
    model: z.string(),
    transcript: z.string(),
    truncated: z.boolean(),
    request: z.record(z.unknown()),
    response: z.record(z.unknown()),
    metadata: z.unknown().optional(),
    saved: z.boolean().optional(),
    saved_path: z.string().optional(),
    bytes_written: z.number().optional(),
    saved_format: z.string().optional(),
    saved_mime_type: z.string().optional(),
    save_error: z.string().optional()
  })
  .passthrough();

export const TranscribeAudioListOutputSchema = z
  .object({
    model: z.string(),
    truncated: z.boolean(),
    request: z.record(z.unknown()),
    summary: z
      .object({
        total: z.number(),
        ok: z.number(),
        failed: z.number()
      })
      .strict(),
    results: z.array(
      z.union([
        z
          .object({
            index: z.number(),
            id: z.string().optional(),
            source: z
              .object({
                file_path: z.string().optional(),
                url: z.string().optional()
              })
              .strict(),
            ok: z.literal(true),
            output: TranscribeAudioOutputSchema
          })
          .strict(),
        z
          .object({
            index: z.number(),
            id: z.string().optional(),
            source: z
              .object({
                file_path: z.string().optional(),
                url: z.string().optional()
              })
              .strict(),
            ok: z.literal(false),
            error: z
              .object({
                code: z.string(),
                message: z.string(),
                status: z.number().optional(),
                body: z.string().nullable().optional(),
                body_truncated: z.boolean().optional()
              })
              .strict()
          })
          .strict()
      ])
    )
  })
  .passthrough();

// Backwards-compatible export name (previously used for the separate batch tool).
export const TranscribeAudioBatchOutputSchema = TranscribeAudioListOutputSchema;
