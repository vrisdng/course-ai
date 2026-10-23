// Turns a supabase.functions.invoke() error into an Error carrying the edge
// function's own message. For a non-2xx reply, supabase-js only says "Edge
// Function returned a non-2xx status code"; the JSON body with the real reason
// is on error.context (the Response).

// The server's upload policy refused the file (HTTP 415). Retrying the same
// file cannot succeed.
export class UploadRejectedError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'UploadRejectedError';
    this.code = code;
  }
}

interface InvokeErrorLike {
  message?: unknown;
  context?: unknown;
}

interface ErrorBody {
  error?: unknown;
  code?: unknown;
}

async function readErrorBody(context: unknown): Promise<{ status: number; body: ErrorBody } | null> {
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json() as ErrorBody;
    return { status: context.status, body: body && typeof body === 'object' ? body : {} };
  } catch {
    return { status: context.status, body: {} };
  }
}

export async function functionInvokeError(error: unknown, fallback: string, prefix = ''): Promise<Error> {
  const invokeError = (error ?? {}) as InvokeErrorLike;
  const reply = await readErrorBody(invokeError.context);
  const serverMessage = typeof reply?.body.error === 'string' && reply.body.error ? reply.body.error : null;

  if (reply?.status === 415 && serverMessage) {
    return new UploadRejectedError(serverMessage, typeof reply.body.code === 'string' ? reply.body.code : undefined);
  }

  const clientMessage = typeof invokeError.message === 'string' && invokeError.message ? invokeError.message : null;
  return new Error(`${prefix}${serverMessage ?? clientMessage ?? fallback}`);
}
