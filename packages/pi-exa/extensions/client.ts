import { isRecord } from './util';

export const EXA_API_BASE_URL = 'https://api.exa.ai';

export type ExaEndpoint =
  | '/search'
  | '/contents'
  | '/answer'
  | '/agent/runs'
  | `/agent/runs/${string}`;

export type ExaQueryParams = Record<string, string | number | boolean | undefined>;

export type ExaMethod = 'GET' | 'POST' | 'DELETE';

export interface ExaRequestOptions {
  method?: ExaMethod;
  body?: unknown;
  query?: ExaQueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ExaApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ExaApiError';
  }
}

export async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const message = body.message ?? body.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function buildUrl(endpoint: ExaEndpoint, query?: ExaQueryParams): string {
  const url = new URL(`${EXA_API_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function exaRawRequest(
  apiKey: string,
  endpoint: ExaEndpoint,
  options: ExaRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'x-exa-integration': 'pi-exa',
    ...options.headers,
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(options.body);
  }

  return fetch(buildUrl(endpoint, options.query), {
    method: options.method ?? 'POST',
    headers: {
      ...headers,
    },
    body,
    signal: options.signal,
  });
}

export async function exaRequest<TResponse>(
  apiKey: string,
  endpoint: ExaEndpoint,
  options: ExaRequestOptions = {},
): Promise<TResponse> {
  const response = await exaRawRequest(apiKey, endpoint, options);

  const responseBody = await parseResponseBody(response);

  if (!response.ok) {
    throw new ExaApiError(
      `Exa API request failed: ${errorMessage(responseBody, `${response.status} ${response.statusText}`)}`,
      response.status,
      responseBody,
    );
  }

  return responseBody as TResponse;
}

export async function exaGet<TResponse>(
  apiKey: string,
  endpoint: ExaEndpoint,
  query?: ExaQueryParams,
  signal?: AbortSignal,
): Promise<TResponse> {
  return exaRequest<TResponse>(apiKey, endpoint, { method: 'GET', query, signal });
}

export async function exaPost<TResponse>(
  apiKey: string,
  endpoint: ExaEndpoint,
  body: unknown,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<TResponse> {
  return exaRequest<TResponse>(apiKey, endpoint, { method: 'POST', body, signal, headers });
}

export async function exaDelete<TResponse>(
  apiKey: string,
  endpoint: ExaEndpoint,
  signal?: AbortSignal,
): Promise<TResponse> {
  return exaRequest<TResponse>(apiKey, endpoint, { method: 'DELETE', signal });
}

export function formatToolError(error: unknown): string {
  if (error instanceof ExaApiError) {
    if (error.status === 401 || error.status === 403) {
      return `${error.message}\n\nSet EXA_API_KEY before starting pi or run /exa-auth set.`;
    }
    return error.message;
  }

  if (error instanceof Error) return error.message;
  return String(error);
}
