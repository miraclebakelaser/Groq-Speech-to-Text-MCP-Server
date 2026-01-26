# Groq Speech To Text MCP Server

MCP (Model Context Protocol) server for Groq Speech To Text (defaults to `whisper-large-v3-turbo`).

Each transcription writes a copy of the output to `./transcripts` (either `.txt` or `.json` depending on `response_format`).

## Prerequisites

- Node.js 20+
- A Groq API key

## Quick start

```bash
npm install
export GROQ_API_KEY="your_groq_api_key"
npm run build
npm start
```

For local dev with an env file:

```bash
cp .env.local.example .env.local
# edit .env.local
npm run dev
```

## Add to an MCP client (stdio)

```json
{
  "mcpServers": {
    "groq-speech-to-text": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/groq-speech-to-text-mcp-server/dist/index.js"],
      "env": {
        "GROQ_API_KEY": "your_groq_api_key"
      }
    }
  }
}
```

## Tools

### `groq_transcribe_audio`

Transcribe one or more audio files or URLs. Each transcription writes a copy of the output to `./transcripts`.

Example (single URL):

```json
{
  "items": [{ "url": "https://example.com/audio.wav" }],
  "response_format": "text"
}
```

Common inputs:
- `items`: Array of inputs. Each item must provide exactly one of `file_path` or `url`.
- `items[*].save_as`: Save under `./transcripts` with an explicit filename (filename only; no path separators).
- `response_format`: `text` | `json` | `verbose_json` (timestamps require `verbose_json`).
- `timestamp_granularities`: `["word"]`, `["segment"]`, or both (only with `verbose_json`).
- `include_metadata`: Includes timestamps/metadata in structured output (can be large for long audio).
- `output_format`: How the tool formats its *text* response: `text` | `markdown` | `json`.
- `concurrency`: Maximum number of concurrent transcriptions (1-10).

Example (many inputs):

```json
{
  "items": [
    { "id": "intro", "url": "https://example.com/intro.wav", "save_as": "intro.txt" },
    { "id": "outro", "file_path": "/absolute/path/to/outro.m4a" }
  ],
  "concurrency": 4
}
```

## Notes

- Groq Speech-to-Text docs: https://console.groq.com/docs/speech-to-text
- This server uses Groq’s OpenAI-compatible endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`.
- `file_path` is read from the machine running the MCP server. For remote/private files, prefer `url` (e.g., pre-signed URLs).
- Direct file uploads are limited to 25MB. For larger media (e.g., `.mkv` videos), extract/compress audio or use `url`.

## Configuration (env)

- `GROQ_API_KEY` (required)
- `GROQ_OPENAI_BASE_URL` (optional): Override the base URL (default `https://api.groq.com/openai/v1`)
- `GROQ_STT_REQUEST_TIMEOUT_MS` (optional): Request timeout in ms (default `300000`)
- `GROQ_STT_MAX_RETRIES` (optional): Retry count for 429/5xx (default `2`)
- `GROQ_STT_RETRY_BASE_MS` (optional): Base backoff in ms (default `250`)

## Development

```bash
npm test
```
