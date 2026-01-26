export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly bodyText?: string;

  constructor(status: number, message: string, bodyText?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

