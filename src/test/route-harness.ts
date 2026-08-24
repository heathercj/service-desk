/**
 * Helpers for exercising Next.js App Router handlers as plain functions.
 *
 * A route handler is just `(req, ctx) => Promise<Response>`, so it can be
 * called directly -- no HTTP server, no Next runtime. That keeps route
 * tests in the fast unit suite while still covering what the routes
 * actually own: auth gating, input validation, error->status mapping, and
 * the shape of the JSON they return. Business rules stay tested at the
 * service layer.
 */
import { NextRequest } from "next/server";

export const TEST_ORIGIN = "http://localhost:3000";

/** Builds a POST/PATCH/PUT request with a JSON body. */
export function jsonRequest(
  path: string,
  body: unknown,
  init: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(new URL(path, TEST_ORIGIN), {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  });
}

/** Builds a GET request, optionally with query parameters. */
export function getRequest(
  path: string,
  query: Record<string, string | number | undefined> = {},
): NextRequest {
  const url = new URL(path, TEST_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return new NextRequest(url, { method: "GET" });
}

/**
 * App Router passes dynamic segments as a promise in Next 15; this builds
 * the `{ params }` second argument handlers destructure.
 */
export function routeContext<T extends Record<string, string>>(
  params: T,
): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

export interface RouteResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** Awaits a handler's Response and unwraps status + parsed JSON body. */
export async function readResponse<T = unknown>(
  response: Response | Promise<Response>,
): Promise<RouteResult<T>> {
  const res = await response;
  const text = await res.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    // Surface the raw payload rather than a JSON parse error -- an HTML
    // error page here usually means the handler threw before responding.
    body = text;
  }
  return { status: res.status, body: body as T, headers: res.headers };
}
