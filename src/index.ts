#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";
import { z } from "zod";
import { TranscribeAudioInputSchema } from "./schemas/transcribe.js";
import { transcribeAudioTool } from "./tools/transcribe.js";
import {
  TranscribeAudioListOutputSchema
} from "./schemas/toolOutputs.js";

const SERVER_INSTRUCTIONS = `Speech to text transcription server.

Tool:
- groq_transcribe_audio: transcribe one or more sources.

Inputs:
- items: array of sources. Each item supports: id?, file_path?, url?, save_as?.
- Each item provides exactly one of: file_path (local file) OR url (public URL).

Examples:
{"items":[{"file_path":"/absolute/path/to/audio.mp3"}]}
{"items":[{"id":"a","file_path":"/abs/a.mp3"},{"id":"b","url":"https://example.com/b.wav","save_as":"b.txt"}],"concurrency":4}

Options:
- concurrency (1-10), model, language, prompt, temperature, response_format, timestamp_granularities, include_metadata, output_format

Notes:
- Audio/video accepted; max file size: 25MB.
- Transcripts are saved under ./transcripts (use save_as to control filenames).
- Timestamps require response_format=\"verbose_json\" with timestamp_granularities.`;

const DEFAULT_VERSION = "0.0.0";

function readPackageVersion(): string {
  try {
    const packageJsonUrl = new URL("../package.json", import.meta.url);
    const raw = fs.readFileSync(packageJsonUrl, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  } catch {
    // Ignore and fall back to DEFAULT_VERSION.
  }
  return DEFAULT_VERSION;
}

const server = new McpServer({
  name: "groq-speech-to-text-mcp-server",
  title: "Groq Speech To Text MCP Server",
  description: "Transcribe audio via Groq Speech To Text and optionally save transcripts to disk.",
  version: readPackageVersion()
}, { instructions: SERVER_INSTRUCTIONS });

server.registerPrompt(
  "groq_stt_batch_template",
  {
    title: "Groq Speech To Text — Template",
    description:
      "Produces a ready-to-run JSON payload for groq_transcribe_audio from a list of local file paths (note: 25MB direct upload cap).",
    argsSchema: {
      file_paths: z
        .array(z.string().min(1))
        .min(1)
        .describe("Absolute local file paths to transcribe (each must be <= 25MB)."),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Optional concurrency limit for the batch call (1-10).")
    }
  },
  async ({ file_paths, concurrency }) => {
    const payload = {
      items: file_paths.map((file_path, i) => ({ id: `item_${i}`, file_path })),
      ...(typeof concurrency === "number" ? { concurrency } : {})
    };

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Call `groq_transcribe_audio` with this JSON. Audio/video accepted; max file size: 25MB.\n\n" +
              "```json\n" +
              JSON.stringify(payload, null, 2) +
              "\n```"
          }
        }
      ]
    };
  }
);

server.registerTool(
  "groq_transcribe_audio",
  {
    title: "Groq Speech-to-Text",
    description:
      "Transcribe one or more audio sources.\n\n" +
      "Call shape:\n" +
      `{"items":[{"file_path":"/absolute/path/to/audio.mp3","save_as":"audio.txt"}],"concurrency":4}\n\n` +
      "Inputs:\n" +
      "- items: array of sources. Each item provides one source field and optional save_as/id.\n" +
      "- source fields: file_path | url\n" +
      "- save_as: output filename under ./transcripts\n",
    inputSchema: TranscribeAudioInputSchema,
    outputSchema: TranscribeAudioListOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params) => {
    const result = await transcribeAudioTool(params);
    return {
      ...(result.isError ? { isError: true } : {}),
      content: [{ type: "text", text: result.contentText }],
      structuredContent: result.structured
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
