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
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Local path to an audio file."),
    audio_path: z
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
    const hasFile = typeof value.file_path === "string" && value.file_path.length > 0;
    const hasPath = typeof value.path === "string" && value.path.length > 0;
    const hasAudioPath = typeof value.audio_path === "string" && value.audio_path.length > 0;
    const hasUrl = typeof value.url === "string" && value.url.length > 0;
    const localCount = (hasFile ? 1 : 0) + (hasPath ? 1 : 0) + (hasAudioPath ? 1 : 0);
    const hasLocal = localCount > 0;
    if (localCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose one local path field: file_path, path, or audio_path.",
        path: ["file_path"]
      });
    }

    if (hasLocal === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose one source type for each item: a local file path or a public url."
      });
    }

    if (typeof value.save_as === "string") {
      if (value.save_as.includes("/") || value.save_as.includes("\\") || value.save_as.includes("\0")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "save_as should be a filename like \"intro.txt\"."
        });
      }
    }
  });

const TranscribeAudioToolInputSchemaRaw = z
  .object({
    items: z
      .array(TranscribeAudioItemSchema)
      .optional()
      .default([])
      .describe(
        "Audio sources to transcribe. Each item provides exactly one of: file_path (local file) or url (public URL)."
      ),
    file_path: z
      .string()
      .min(1)
      .optional()
      .describe("A single local audio file path. Shortcut for items: [{ file_path }]."),
    url: z
      .string()
      .url()
      .optional()
      .describe("A single public audio URL. Shortcut for items: [{ url }]."),
    save_as: z
      .string()
      .min(1)
      .optional()
      .describe("Output filename under ./transcripts for the single input shortcut."),
    output_dir: z
      .string()
      .min(1)
      .optional()
      .describe("Optional output directory label for compatibility; transcripts are saved under ./transcripts."),
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

    const hasLegacyFile = typeof value.file_path === "string" && value.file_path.length > 0;
    const hasLegacyUrl = typeof value.url === "string" && value.url.length > 0;
    if ((hasLegacyFile ? 1 : 0) + (hasLegacyUrl ? 1 : 0) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose one source type for the single input shortcut: file_path or url."
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
