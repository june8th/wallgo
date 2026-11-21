import type { IncomingMessage, ServerResponse } from 'node:http';
import { NO_STORE_HEADER } from './router.js';

export const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB

export class PayloadTooLargeError extends Error {
  readonly status = 413 as const;

  constructor(maxBytes: number) {
    super(`Request body exceeded maximum allowed size of ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Returns true strictly for `/api`, `/api/...`, or `/api?...` URLs.
 * Never intercepts `/api-docs` or other non-API SPA routes.
 */
export function isApiRequestUrl(url: string | undefined): boolean {
  if (typeof url !== 'string') {
    return false;
  }
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

function readRawBody(req: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    };

    const onData = (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      totalBytes += buf.byteLength;
      if (totalBytes > maxBodyBytes) {
        settled = true;
        cleanup();
        req.resume();
        reject(new PayloadTooLargeError(maxBodyBytes));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(chunks.length > 0 ? Buffer.concat(chunks, totalBytes) : Buffer.alloc(0));
    };

    const onError = (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(err);
    };

    const onAborted = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error('Client aborted request'));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

export async function nodeRequestToWebRequest(
  req: IncomingMessage,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const forwardedProtoRaw = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? forwardedProtoRaw[0]
    : forwardedProtoRaw;
  const firstProto = forwardedProto?.split(',')[0]?.trim().toLowerCase();
  const proto = firstProto === 'https' ? 'https' : 'http';
  const host = req.headers.host || '127.0.0.1';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);

  const headers = new Headers();
  const rawHeaders = req.headers;
  const keys = Object.keys(rawHeaders);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key.startsWith(':')) {
      continue;
    }
    const value = rawHeaders[key];
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (let j = 0; j < value.length; j++) {
        headers.append(key, value[j]);
      }
    } else {
      headers.set(key, value);
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const rawBody = await readRawBody(req, maxBodyBytes);
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (rawBody.byteLength > 0) {
    body = new Uint8Array(new ArrayBuffer(rawBody.byteLength));
    body.set(rawBody);
  }

  return new Request(url, {
    method,
    headers,
    body,
  });
}

export async function writeWebResponseToNode(
  response: Response,
  res: ServerResponse,
  method: string,
): Promise<void> {
  res.statusCode = response.status;

  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies);
  }

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      return;
    }
    res.setHeader(key, value);
  });

  if (method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 304) {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export type WebRequestHandler = (request: Request) => Promise<Response> | Response;

export interface NodeApiMiddlewareOptions {
  maxBodyBytes?: number;
}

export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

export function createNodeApiMiddleware(
  handler: WebRequestHandler,
  options: NodeApiMiddlewareOptions = {},
): ConnectMiddleware {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return (req, res, next) => {
    if (!isApiRequestUrl(req.url)) {
      next();
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    void (async () => {
      try {
        const webReq = await nodeRequestToWebRequest(req, maxBodyBytes);
        const webRes = await handler(webReq);
        if (!res.writableEnded) {
          await writeWebResponseToNode(webRes, res, method);
        }
      } catch (err) {
        if (res.writableEnded) {
          return;
        }
        if (err instanceof PayloadTooLargeError) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', NO_STORE_HEADER);
          res.end(
            JSON.stringify({
              error: { code: 'INVALID_REQUEST', message: err.message },
            }),
          );
          return;
        }
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', NO_STORE_HEADER);
        res.end(
          JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
          }),
        );
      }
    })();
  };
}
