import { HttpError } from "./errors.js";
import { GroqAudioResponseFormat, TimestampGranularity } from "../schemas/transcribe.js";
import { config } from "./config.js";

type TranscriptionRequest =
  | {
      file: { filename: string; bytes: Buffer };
      url?: undefined;
    }
  | {
      url: string;
      file?: undefined;
    };

export type GroqTranscriptionParams = TranscriptionRequest & {
  model: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  response_format?: GroqAudioResponseFormat;
  timestamp_granularities?: TimestampGranularity[];
};

export async function groqCreateTranscription(
  apiKey: string,
  params: GroqTranscriptionParams
): Promise<{ rawText: string; rawJson: unknown; contentType: string | null }> {
  const endpoint = `${config.baseUrl}/audio/transcriptions`;

  const makeForm = (): FormData => {
    const form = new FormData();
    if (params.file) {
      const arrayBuffer = new ArrayBuffer(params.file.bytes.byteLength);
      new Uint8Array(arrayBuffer).set(params.file.bytes);
      const blob = new Blob([arrayBuffer]);
      form.append("file", blob, params.file.filename);
    } else if (params.url) {
      form.append("url", params.url);
    } else {
      throw new Error("Invalid transcription request: missing file or url.");
    }

    form.append("model", params.model);
    if (params.language) form.append("language", params.language);
    if (params.prompt) form.append("prompt", params.prompt);
    if (typeof params.temperature === "number")
      form.append("temperature", String(params.temperature));
    if (params.response_format) form.append("response_format", params.response_format);

    if (params.timestamp_granularities && params.timestamp_granularities.length > 0) {
      for (const granularity of params.timestamp_granularities) {
        form.append("timestamp_granularities[]", granularity);
      }
    }
    return form;
  };

  const response = await fetchWithRetry(endpoint, apiKey, makeForm);

  const contentType = response.headers.get("content-type");
  const bodyText = await response.text();

  if (!response.ok) {
    const message = `Groq API error (${response.status}).`;
    throw new HttpError(response.status, message, bodyText);
  }

  let rawJson: unknown = null;
  if (contentType?.includes("application/json")) {
    try {
      rawJson = JSON.parse(bodyText) as unknown;
    } catch {
      rawJson = null;
    }
  }

  return { rawText: bodyText, rawJson, contentType };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(baseMs: number): number {
  const jitter = Math.random() * 0.25 + 0.875; // 0.875–1.125
  return Math.max(0, Math.round(baseMs * jitter));
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    try {
      await response.arrayBuffer();
    } catch {
      // Ignore failures while discarding.
    }
  }
}

async function fetchWithRetry(
  url: string,
  apiKey: string,
  makeBody: () => FormData
): Promise<Response> {
  const maxAttempts = Math.max(1, config.maxRetries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: makeBody(),
        signal: controller.signal
      });

      if (response.ok) return response;

      const retryable =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;

      if (!retryable || attempt === maxAttempts) return response;

      await discardResponseBody(response);
      const backoff = config.retryBaseMs * Math.pow(2, attempt - 1);
      await sleep(jitterMs(backoff));
      continue;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const backoff = config.retryBaseMs * Math.pow(2, attempt - 1);
      await sleep(jitterMs(backoff));
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unreachable: fetchWithRetry exhausted attempts.");
}
