import {
  GroqAudioResponseFormat,
  OutputFormat,
  TranscribeAudioInput,
  TranscribeAudioRequest
} from "../schemas/transcribe.js";
import { toErrorMessage, HttpError } from "../services/errors.js";
import { FileInputError, readAudioFile } from "../services/files.js";
import { groqCreateTranscription } from "../services/groqAudio.js";
import { config } from "../services/config.js";
import { deriveTranscriptBaseName, reserveTranscriptPath } from "../services/transcripts.js";
import { mapWithConcurrency } from "../services/concurrency.js";
import fs from "node:fs/promises";

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractTranscript(
  responseFormat: GroqAudioResponseFormat,
  rawText: string,
  rawJson: unknown
): { transcript: string | null; parsedJson: unknown | null } {
  if (responseFormat === GroqAudioResponseFormat.TEXT) {
    return { transcript: rawText, parsedJson: null };
  }

  const parsedJson = rawJson ?? tryParseJson(rawText);
  if (parsedJson && typeof (parsedJson as any).text === "string") {
    return { transcript: (parsedJson as any).text as string, parsedJson };
  }
  return { transcript: null, parsedJson };
}

async function saveTranscriptArtifact(options: {
  source: { file_path?: string; url?: string };
  responseFormat: GroqAudioResponseFormat;
  rawText: string;
  rawJson: unknown | null;
  transcriptText: string;
  model: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  metadata?: unknown;
  saveAs?: string;
}): Promise<{ saved_path: string; bytes_written: number; format: "text" | "json"; mime_type: string }> {
  const extension = options.responseFormat === GroqAudioResponseFormat.TEXT ? "txt" : "json";
  const baseName = deriveTranscriptBaseName(options.source);
  const outputPath = await reserveTranscriptPath({ baseName, extension, saveAs: options.saveAs });

  const format = extension === "txt" ? "text" : "json";
  const mime_type = extension === "txt" ? "text/plain" : "application/json";

  const contents = (() => {
    if (extension === "txt") {
      return options.transcriptText + (options.transcriptText.endsWith("\n") ? "" : "\n");
    }

    const groqResponse = options.rawJson ?? tryParseJson(options.rawText);
    const payload = {
      saved_at: new Date().toISOString(),
      model: options.model,
      transcript: options.transcriptText,
      request: options.request,
      response: options.response,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
      groq_response: groqResponse,
      ...(typeof options.rawText === "string" ? { groq_raw_text: options.rawText } : {})
    };

    return JSON.stringify(payload, null, 2) + "\n";
  })();

  await fs.writeFile(outputPath, contents, { encoding: "utf8", flag: "wx" });
  const stat = await fs.stat(outputPath);
  return { saved_path: outputPath, bytes_written: stat.size, format, mime_type };
}

type ListResultSuccess = {
  index: number;
  id?: string;
  source: { file_path?: string; url?: string };
  ok: true;
  output: Record<string, unknown>;
};

type ListResultFailure = {
  index: number;
  id?: string;
  source: { file_path?: string; url?: string };
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
    body?: string | null;
    body_truncated?: boolean;
  };
};

const ERROR_BODY_LIMIT = 4_000;
const ERROR_MESSAGE_PREVIEW_LIMIT = 200;

function truncateBody(body: string | null | undefined): { body: string | null; truncated: boolean } {
  if (body == null) return { body: null, truncated: false };
  if (body.length <= ERROR_BODY_LIMIT) return { body, truncated: false };
  return { body: body.slice(0, ERROR_BODY_LIMIT) + "\n\n[truncated]", truncated: true };
}

function previewErrorMessage(message: string | undefined): string {
  const raw = (message ?? "").trim().replace(/\s+/g, " ");
  if (raw.length === 0) return "";
  if (raw.length <= ERROR_MESSAGE_PREVIEW_LIMIT) return raw;
  return raw.slice(0, ERROR_MESSAGE_PREVIEW_LIMIT) + "…";
}

function summarizeText(
  summary: { total: number; ok: number; failed: number },
  results: Array<ListResultSuccess | ListResultFailure>
): string {
  const lines: string[] = [
    "Transcription complete.",
    `Total: ${summary.total} | OK: ${summary.ok} | Failed: ${summary.failed}`
  ];

  for (const r of results) {
    const target = r.source.file_path ? `file_path=${r.source.file_path}` : `url=${r.source.url}`;
    const id = r.id ? ` id=${r.id}` : "";
    if (r.ok) {
      lines.push(`- [${r.index}] OK${id} ${target}`);
    } else {
      const extra = r.error.status ? ` status=${r.error.status}` : "";
      const msg = previewErrorMessage(r.error.message);
      lines.push(`- [${r.index}] FAILED${id} ${target} (${r.error.code}${extra})${msg ? ` — ${msg}` : ""}`);
    }
  }

  lines.push("Full transcripts are available in structuredContent.results[*].output.transcript.");
  return lines.join("\n");
}

function summarizeMarkdown(
  summary: { total: number; ok: number; failed: number },
  results: Array<ListResultSuccess | ListResultFailure>
): string {
  const lines: string[] = [
    "# Transcription",
    "",
    `- Total: **${summary.total}**`,
    `- OK: **${summary.ok}**`,
    `- Failed: **${summary.failed}**`,
    "",
    "## Results",
    ""
  ];

  for (const r of results) {
    const target = r.source.file_path ? `\`file_path\`: \`${r.source.file_path}\`` : `\`url\`: \`${r.source.url}\``;
    const id = r.id ? ` (\`id\`: \`${r.id}\`)` : "";
    if (r.ok) {
      lines.push(`- [${r.index}] OK${id} — ${target}`);
    } else {
      const extra = r.error.status ? ` (status ${r.error.status})` : "";
      const msg = previewErrorMessage(r.error.message);
      lines.push(`- [${r.index}] FAILED${id} — ${target} — \`${r.error.code}\`${extra}${msg ? ` — ${msg}` : ""}`);
    }
  }

  lines.push("", "Full transcripts are available in `structuredContent.results[*].output.transcript`.");
  return lines.join("\n");
}

function summarizeJson(
  summary: { total: number; ok: number; failed: number },
  results: Array<ListResultSuccess | ListResultFailure>
): string {
  const payload = {
    summary,
    results: results.map((r) => {
      if (r.ok) {
        const transcript =
          typeof (r.output as any)?.transcript === "string" ? ((r.output as any).transcript as string) : "";
        return {
          index: r.index,
          ...(r.id ? { id: r.id } : {}),
          source: r.source,
          ok: true,
          transcript_preview: transcript.slice(0, 200)
        };
      }

      return {
        index: r.index,
        ...(r.id ? { id: r.id } : {}),
        source: r.source,
        ok: false,
        error: r.error
      };
    })
  };
  return JSON.stringify(payload, null, 2);
}

async function transcribeOne(apiKey: string, params: TranscribeAudioRequest): Promise<{
  contentText: string;
  structured: Record<string, unknown>;
  isError?: boolean;
}> {
  try {
    const model = params.model ?? "whisper-large-v3-turbo";

    const request =
      params.file_path != null
        ? { file: await readAudioFile(params.file_path) }
        : { url: params.url as string };

    const { rawText, rawJson, contentType } = await groqCreateTranscription(apiKey, {
      ...request,
      model,
      language: params.language,
      prompt: params.prompt,
      temperature: params.temperature,
      response_format: params.response_format,
      timestamp_granularities: params.timestamp_granularities
    });

    const { transcript, parsedJson } = extractTranscript(params.response_format, rawText, rawJson);
    const transcriptText = transcript ?? rawText;

    const requestStructured: Record<string, unknown> = {
      ...(params.file_path ? { file_path: params.file_path } : {}),
      ...(params.url ? { url: params.url } : {}),
      ...(params.language ? { language: params.language } : {}),
      ...(params.prompt ? { prompt: params.prompt } : {}),
      temperature: params.temperature,
      response_format: params.response_format,
      timestamp_granularities: params.timestamp_granularities
    };

    const responseStructured: Record<string, unknown> = {
      content_type: contentType
    };

    const baseStructured: Record<string, unknown> = {
      model,
      transcript: transcriptText,
      truncated: false,
      request: {
        ...requestStructured
      },
      response: {
        ...responseStructured
      }
    };

    if (params.include_metadata && parsedJson && typeof parsedJson === "object" && parsedJson !== null) {
      const segmentsRaw = Array.isArray((parsedJson as any).segments) ? ((parsedJson as any).segments as any[]) : [];
      const wordsRaw = Array.isArray((parsedJson as any).words) ? ((parsedJson as any).words as any[]) : [];

      const segments = segmentsRaw
        .map((s) => ({
          id: typeof s?.id === "number" ? (s.id as number) : undefined,
          start: Number(s?.start),
          end: Number(s?.end),
          text: typeof s?.text === "string" ? (s.text as string) : ""
        }))
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text.length > 0);

      const words = wordsRaw
        .map((w) => ({
          word: typeof w?.word === "string" ? (w.word as string) : "",
          start: Number(w?.start),
          end: Number(w?.end)
        }))
        .filter((w) => w.word.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end));

      baseStructured.metadata = {
        language: typeof (parsedJson as any).language === "string" ? ((parsedJson as any).language as string) : undefined,
        duration: typeof (parsedJson as any).duration === "number" ? ((parsedJson as any).duration as number) : undefined,
        segments_count: segments.length,
        words_count: words.length,
        segments: segments,
        words: words
      };
    }

    let saveResult:
      | { ok: true; saved_path: string; bytes_written: number; format: "text" | "json"; mime_type: string }
      | { ok: false; error: string; format: "text" | "json"; mime_type: string };
    try {
      const artifact = await saveTranscriptArtifact({
        source: {
          ...(params.file_path ? { file_path: params.file_path } : {}),
          ...(params.url ? { url: params.url } : {})
        },
        responseFormat: params.response_format,
        rawText,
        rawJson: rawJson ?? null,
        transcriptText,
        model,
        request: requestStructured,
        response: responseStructured,
        metadata: params.include_metadata ? (baseStructured as any).metadata : undefined,
        saveAs: params.save_as
      });
      saveResult = { ok: true, ...artifact };
    } catch (error) {
      saveResult = {
        ok: false,
        error: toErrorMessage(error),
        format: params.response_format === GroqAudioResponseFormat.TEXT ? "text" : "json",
        mime_type: params.response_format === GroqAudioResponseFormat.TEXT ? "text/plain" : "application/json"
      };
    }

    baseStructured.saved = saveResult.ok;
    baseStructured.saved_format = saveResult.format;
    baseStructured.saved_mime_type = saveResult.mime_type;
    if (saveResult.ok) {
      baseStructured.saved_path = saveResult.saved_path;
      baseStructured.bytes_written = saveResult.bytes_written;
    } else {
      baseStructured.save_error = saveResult.error;
    }

    let contentText = "";
    if (params.output_format === OutputFormat.JSON) {
      contentText = JSON.stringify(baseStructured, null, 2);
    } else if (params.output_format === OutputFormat.MARKDOWN) {
      contentText = `# Transcription\n\n${transcriptText}\n`;
      if (params.include_metadata && baseStructured.metadata) {
        contentText += `\n## Metadata\n\n\`\`\`json\n${JSON.stringify(
          baseStructured.metadata,
          null,
          2
        )}\n\`\`\`\n`;
      }
    } else {
      contentText = transcriptText;
    }

    return { contentText, structured: baseStructured };
  } catch (error) {
    if (error instanceof FileInputError) {
      return {
        isError: true,
        contentText: `Error: ${error.message}`,
        structured: { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
      };
    }

    if (error instanceof HttpError) {
      return {
        isError: true,
        contentText: `Error: Groq API request failed (status ${error.status}). ${error.bodyText ?? ""}`.trim(),
        structured: {
          error: "groq_api_error",
          status: error.status,
          body: error.bodyText ?? null
        }
      };
    }

    return {
      isError: true,
      contentText: `Error: ${toErrorMessage(error)}`,
      structured: { error: "unexpected_error", message: toErrorMessage(error) }
    };
  }
}

function asListFailure(options: {
  index: number;
  id?: string;
  source: { file_path?: string; url?: string };
  result: { contentText: string; structured: Record<string, unknown>; isError?: boolean };
}): ListResultFailure {
  const code =
    typeof (options.result.structured as any)?.error === "string"
      ? ((options.result.structured as any).error as string)
      : "error";

  const status =
    typeof (options.result.structured as any)?.status === "number"
      ? ((options.result.structured as any).status as number)
      : undefined;

  const message =
    typeof (options.result.structured as any)?.message === "string"
      ? ((options.result.structured as any).message as string)
      : options.result.contentText;

  const rawBody =
    typeof (options.result.structured as any)?.body === "string" || (options.result.structured as any)?.body === null
      ? ((options.result.structured as any).body as string | null)
      : undefined;

  const bodyTrunc = truncateBody(rawBody);

  return {
    index: options.index,
    ...(options.id ? { id: options.id } : {}),
    source: options.source,
    ok: false,
    error: {
      code,
      message,
      ...(status ? { status } : {}),
      ...(rawBody !== undefined ? { body: bodyTrunc.body, body_truncated: bodyTrunc.truncated } : {})
    }
  };
}

export async function transcribeAudioTool(params: TranscribeAudioInput): Promise<{
  contentText: string;
  structured: Record<string, unknown>;
  isError?: boolean;
}> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return {
      isError: true,
      contentText: `Error: ${config.apiKeyEnv} is not set. Set it in your environment before starting the MCP server.`,
      structured: { error: "missing_api_key", message: `${config.apiKeyEnv} is not set.` }
    };
  }

  const legacyLocal =
    typeof (params as any).file_path === "string" && ((params as any).file_path as string).length > 0
      ? ((params as any).file_path as string)
      : undefined;
  const legacyUrl =
    typeof (params as any).url === "string" && ((params as any).url as string).length > 0
      ? ((params as any).url as string)
      : undefined;
  const legacySaveAs =
    typeof (params as any).save_as === "string" && ((params as any).save_as as string).length > 0
      ? ((params as any).save_as as string)
      : undefined;

  const legacyItem =
    legacyLocal || legacyUrl
      ? [
          {
            ...(legacyLocal ? { file_path: legacyLocal } : {}),
            ...(legacyUrl ? { url: legacyUrl } : {}),
            ...(legacySaveAs ? { save_as: legacySaveAs } : {})
          }
        ]
      : [];

  const effectiveItems = (Array.isArray(params.items) && params.items.length > 0 ? params.items : legacyItem).map(
    (item: any) => ({
      ...item,
      ...(typeof item.file_path !== "string" || item.file_path.length === 0
        ? {
            ...(typeof item.path === "string" && item.path.length > 0 ? { file_path: item.path } : {}),
            ...(typeof item.audio_path === "string" && item.audio_path.length > 0 ? { file_path: item.audio_path } : {})
          }
        : {})
    })
  );

  if (!Array.isArray(effectiveItems) || effectiveItems.length === 0) {
    const exampleSingle = { items: [{ file_path: "/absolute/path/to/audio.mp3" }] };
    const exampleMany = {
      items: [
        { id: "a", file_path: "/abs/a.mp3", save_as: "a.txt" },
        { id: "b", url: "https://example.com/b.wav" }
      ],
      concurrency: 4
    };

    return {
      isError: true,
      contentText:
        "Provide at least one audio source in `items`.\n\n" +
        "Example (one file):\n" +
        JSON.stringify(exampleSingle, null, 2) +
        "\n\nExample (many files):\n" +
        JSON.stringify(exampleMany, null, 2),
      structured: {
        error: "invalid_input",
        message: "items must include at least one source",
        usage: { example_single: exampleSingle, example_many: exampleMany }
      }
    };
  }

  const shared: Omit<TranscribeAudioRequest, "file_path" | "url" | "save_as"> = {
    model: params.model,
    language: params.language,
    prompt: params.prompt,
    temperature: params.temperature,
    response_format: params.response_format,
    timestamp_granularities: params.timestamp_granularities,
    include_metadata: params.include_metadata,
    output_format: effectiveItems.length === 1 ? params.output_format : OutputFormat.TEXT
  };

  const results = await mapWithConcurrency(effectiveItems, params.concurrency, async (item, index) => {
    const source = {
      ...(item.file_path ? { file_path: item.file_path } : {}),
      ...(item.url ? { url: item.url } : {})
    };

    const result = await transcribeOne(apiKey, {
      ...shared,
      ...(item.file_path ? { file_path: item.file_path } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.save_as ? { save_as: item.save_as } : {})
    });

    if (result.isError) {
      return asListFailure({
        index,
        id: item.id,
        source,
        result
      });
    }

    const success: ListResultSuccess = {
      index,
      ...(item.id ? { id: item.id } : {}),
      source,
      ok: true,
      output: result.structured
    };
    return success;
  });

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const summary = { total: results.length, ok, failed };

  const structured = {
    model: params.model,
    request: {
      model: params.model,
      ...(params.language ? { language: params.language } : {}),
      ...(params.prompt ? { prompt: params.prompt } : {}),
      temperature: params.temperature,
      response_format: params.response_format,
      timestamp_granularities: params.timestamp_granularities,
      include_metadata: params.include_metadata,
      output_format: params.output_format,
      concurrency: params.concurrency,
      items: effectiveItems.map((i: any) => ({
        ...(i.id ? { id: i.id } : {}),
        ...(i.file_path ? { file_path: i.file_path } : {}),
        ...(i.url ? { url: i.url } : {}),
        ...(i.save_as ? { save_as: i.save_as } : {})
      }))
    },
    summary,
    results,
    truncated: false
  } satisfies Record<string, unknown>;

  if (effectiveItems.length === 1) {
    const first = results[0];
    if (!first) {
      return {
        isError: true,
        contentText: "Error: no items to transcribe (items must be non-empty).",
        structured: { error: "invalid_input", message: "items must be non-empty" }
      };
    }

    if (!first.ok) {
      const msg = first.error.message || `Transcription failed (${first.error.code}).`;
      return {
        isError: true,
        contentText: `Error: ${msg}`,
        structured
      };
    }

    const onlyOutput = first.output;
    const transcriptText = typeof (onlyOutput as any)?.transcript === "string" ? ((onlyOutput as any).transcript as string) : "";

    let contentText = "";
    if (params.output_format === OutputFormat.JSON) {
      contentText = JSON.stringify(onlyOutput, null, 2);
    } else if (params.output_format === OutputFormat.MARKDOWN) {
      contentText = `# Transcription\n\n${transcriptText}\n`;
      if (params.include_metadata && (onlyOutput as any)?.metadata) {
        contentText += `\n## Metadata\n\n\`\`\`json\n${JSON.stringify((onlyOutput as any).metadata, null, 2)}\n\`\`\`\n`;
      }
    } else {
      contentText = transcriptText;
    }

    return { contentText, structured };
  }

  let contentText = "";
  if (params.output_format === OutputFormat.JSON) {
    contentText = summarizeJson(summary, results);
  } else if (params.output_format === OutputFormat.MARKDOWN) {
    contentText = summarizeMarkdown(summary, results);
  } else {
    contentText = summarizeText(summary, results);
  }

  return { contentText, structured };
}
