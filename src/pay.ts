// x402 pay mode for the MCP server: the agent's own wallet pays each call in
// USDC, so no key, no account and no checkout are needed.
//
// Until 1.4.0 the package could only send an API key, so an agent with a
// wallet and no key got "Set VERIQL_API_KEY" and nothing else (measured
// 2026-11-20: zero MCP traffic ever reached the paid API). This wires the
// official x402 client (@x402/fetch + @x402/evm, the same ones every
// payability test passed with) around fetch.
//
// Guard rails, because this signs with a real key unattended:
//   - EVM only (Base, Polygon, Arbitrum, Avalanche USDC): one key, no Solana
//     keypair format to get wrong.
//   - A per-call cap, VERIQL_MAX_USD_PER_CALL, default $0.05 (the dearest
//     Veriql call). The client refuses anything above it before signing.
//   - It is only ever used for requests to the configured Veriql base URL.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export const DEFAULT_MAX_USD_PER_CALL = 0.05;

/** A 0x-prefixed 32-byte hex key, or null. Never echoes the key. */
export function normalizeKey(raw: string | undefined): `0x${string}` | null {
  const k = String(raw ?? "").trim();
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? (`0x${hex}` as `0x${string}`) : null;
}

export function maxUsdPerCall(raw: string | undefined): number {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_USD_PER_CALL;
}

/** A fetch that answers a 402 by paying it from `key`, capped per call. */
export function payingFetch(key: `0x${string}`, maxUsd: number, baseFetch: typeof fetch = fetch): { fetch: typeof fetch; address: string } {
  const account = privateKeyToAccount(key);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  client.setSpendControls({ maxAmountPerPayment: `$${maxUsd}` });
  return { fetch: wrapFetchWithPayment(baseFetch, client) as typeof fetch, address: account.address };
}
