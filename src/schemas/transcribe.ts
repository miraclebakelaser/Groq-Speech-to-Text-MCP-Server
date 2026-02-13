import { z } from "zod";

export enum OutputFormat {
  TEXT = "text",
  MARKDOWN = "markdown",
  JSON = "json"
}

export enum GroqAudioResponseFormat {
  JSON = "json",
  VERBOSE_JSON = "verbose_json",
  TEXT = "text"
}

export enum TimestampGranularity {
  WORD = "word",
  SEGMENT = "segment"
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateSaveAs(
  saveAs: string | undefined,
  ctx: z.RefinementCtx,
  path: Array<string | number> = ["save_as"]
): void {
  if (!isNonEmptyString(saveAs)) return;
  if (saveAs.includes("/") || saveAs.includes("\\") || saveAs.includes("\0")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "save_as should be a filename like \"intro.txt\".",
      path
    });
  }
}

const TranscribeAudioOptionsSchema = z
  .object({
  model: z
    .string()
    .min(1)
    .optional()
    .default("whisper-large-v3-turbo")
    .describe("Groq model ID to use for transcription (default: whisper-large-v3-turbo). Example: whisper-large-v3."),
  language: z
    .string()
    .min(2)
    .max(8)
    .optional()
    .describe("Optional ISO-639-1 language code (e.g. en, es). Can improve accuracy."),
  prompt: z
    .string()
    .max(1000)
    .optional()
    .describe("Optional prompt to guide spelling/terms (e.g. names, acronyms)."),
  temperature: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0)
    .describe("Sampling temperature (0-1). For transcription, 0 is recommended."),
  response_format: z
    .nativeEnum(GroqAudioResponseFormat)
    .optional()
    .default(GroqAudioResponseFormat.TEXT)
    .describe("Groq API response format to request."),
  timestamp_granularities: z
    .array(z.nativeEnum(TimestampGranularity))
    .optional()
    .default([])
    .describe("Timestamp detail to request. Use with response_format=verbose_json (word, segment, or both)."),
  include_metadata: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include metadata (and optionally timestamps) in structured output. Can be large for long audio."),
  output_format: z
    .nativeEnum(OutputFormat)
    .optional()
    .default(OutputFormat.TEXT)
    .describe("How the tool formats its text response: text | markdown | json.")
})
  .strict();

export type TranscribeAudioOptions = z.infer<typeof TranscribeAudioOptionsSchema>;

export type TranscribeAudioRequest = TranscribeAudioOptions & {
  file_path?: string;
  url?: string;
  save_as?: string;
};

export const TranscribeAudioItemSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Optional correlation ID to help match results back to inputs."),
    save_as: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional output filename under ./transcripts. Example: \"intro.txt\". If omitted, a timestamped name is used."
      ),
    file_path: z
      .string()
      .min(1)
      .optional()
      .describe("Local path to an audio file."),
    url: z
      .string()
      .url()
      .optional()
      .describe("Public URL to an audio file.")
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasFile = isNonEmptyString(value.file_path);
    const hasUrl = isNonEmptyString(value.url);
    if (hasFile === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose one source type for each item: a local file path or a public url."
      });
    }

    validateSaveAs(value.save_as, ctx, ["save_as"]);
  });

export type TranscribeAudioItem = z.infer<typeof TranscribeAudioItemSchema>;

const TranscribeAudioToolInputSchemaRaw = z
  .object({
    items: z
      .array(TranscribeAudioItemSchema)
      .min(1)
      .describe(
        "Audio sources to transcribe. Each item provides exactly one of: file_path (local file) or url (public URL)."
      ),
    ...TranscribeAudioOptionsSchema.shape,
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(8)
      .describe("Maximum number of concurrent transcriptions to run (1-10).")
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.timestamp_granularities &&
      value.timestamp_granularities.length > 0 &&
      value.response_format !== GroqAudioResponseFormat.VERBOSE_JSON
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "To request timestamps, set response_format to \"verbose_json\" and provide timestamp_granularities."
      });
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < value.items.length; i++) {
      const id = value.items[i]?.id;
      if (!id) continue;
      if (seenIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate item id '${id}'. IDs must be unique.`,
          path: ["items", i, "id"]
        });
      }
      seenIds.add(id);
    }
  });

export const TranscribeAudioInputSchema = TranscribeAudioToolInputSchemaRaw;

export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInputSchema>;
