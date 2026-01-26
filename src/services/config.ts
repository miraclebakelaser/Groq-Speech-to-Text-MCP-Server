function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const config = {
  apiKeyEnv: "GROQ_API_KEY",
  baseUrl: process.env.GROQ_OPENAI_BASE_URL ?? "https://api.groq.com/openai/v1",

  requestTimeoutMs: envInt("GROQ_STT_REQUEST_TIMEOUT_MS", 300_000),
  maxRetries: envInt("GROQ_STT_MAX_RETRIES", 2),
  retryBaseMs: envInt("GROQ_STT_RETRY_BASE_MS", 250)
};
