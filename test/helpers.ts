import type { Http } from "../src/thunderstore";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

export type Call = { url: string; method: string; headers: Headers; body: string };

/** Fake fetch that serves responses by "METHOD url" or plain url, and records calls. */
export function fakeHttp(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const call = { url: req.url, method: req.method, headers: req.headers, body: await req.text() };
    calls.push(call);
    const route = routes[`${call.method} ${call.url}`] ?? routes[call.url];
    if (!route) throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    return route(call);
  }) as Http;
  return { http, calls };
}
