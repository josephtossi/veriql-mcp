// Pure client core for the Veriql MCP server — kept free of the MCP SDK and the
// network (fetch injected) so it is fully unit-testable. The stdio server
// (server.ts) is a thin shell that wires these into MCP tools.

export type V1Endpoint = "scan" | "token" | "launch" | "payee" | "signature" | "send" | "deployer" | "preflight" | "batch-screen" | "x402-seller-check";

export interface ClientOpts {
  baseUrl: string;
  /** Prepaid credits. Absent in x402 mode, where fetchImpl pays each 402. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** `veriql-mcp/<version>`, so the dashboard can tell MCP traffic apart. */
  userAgent?: string;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  body: any;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [k: string]: unknown; // matches the MCP SDK's CallToolResult index signature
}

/** Compose {base}/api/v1/{endpoint}?params, trimming a trailing slash and dropping empty params. */
export function buildUrl(baseUrl: string, endpoint: V1Endpoint, params: Record<string, string | undefined>): string {
  const u = new URL(`${baseUrl.replace(/\/+$/, "")}/api/v1/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
}

/** Call the Veriql Risk API with the configured key, or through a paying fetch. Never throws on HTTP status — returns {ok,status,body}. */
export async function callVeriql(
  endpoint: V1Endpoint,
  params: Record<string, string | undefined>,
  o: ClientOpts,
  body?: unknown,
): Promise<ApiResult> {
  const doFetch = o.fetchImpl ?? fetch;
  const headers: Record<string, string> = o.apiKey ? { "x-api-key": o.apiKey } : {};
  if (o.userAgent) headers["user-agent"] = o.userAgent;
  const init: RequestInit = body === undefined
    ? { headers }
    : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await doFetch(buildUrl(o.baseUrl, endpoint, params), init);
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Freeze state plus the one-hop read. There is no metered twin: `/api/v1/payee`
 * carries the same read inside a paid verdict, and this one is free, so the key
 * stays out of a request that does not need it.
 */
export async function callFreeze(address: string, o: Omit<ClientOpts, "apiKey">): Promise<ApiResult> {
  const doFetch = o.fetchImpl ?? fetch;
  const url = `${o.baseUrl.replace(/\/+$/, "")}/api/freeze?address=${encodeURIComponent(address)}`;
  const res = await doFetch(url, { headers: o.userAgent ? { "user-agent": o.userAgent } : {} });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

/** Map an API result to an MCP tool result (pretty JSON on success; error flag + message otherwise). */
export function toToolResult(r: ApiResult): ToolResult {
  if (r.ok) return { content: [{ type: "text", text: JSON.stringify(r.body, null, 2) }] };
  const free = typeof r.body?.error === "string" ? r.body.error : ""; // a free route's error is a plain string
  const msg = r.body?.error?.message || free || `Request failed (HTTP ${r.status}).`;
  return { content: [{ type: "text", text: `Error ${r.status}: ${msg}` }], isError: true };
}
