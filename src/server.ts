#!/usr/bin/env node
// Veriql Risk API — MCP server. Exposes the read-only risk engine as MCP tools
// so AI agents / Claude / Cursor can call it directly. A thin shell over
// src/mcp/core.ts (all logic + tests live there) and src/mcp/pay.ts.
// veriql_freeze is the exception: it reads a free route and needs nothing.
//
// Config (env, set in your MCP client), either of:
//   VERIQL_WALLET_PRIVATE_KEY  an EVM wallet holding a little USDC on Base,
//                              Polygon, Arbitrum or Avalanche; each call pays
//                              $0.005-$0.05 over x402. No account, no key.
//                              VERIQL_MAX_USD_PER_CALL caps it (default 0.05).
//   VERIQL_API_KEY             prepaid credits from https://veriql.app/api
// optional VERIQL_BASE_URL (default https://veriql.app). A key wins if both are set.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callFreeze, callVeriql, toToolResult, type ToolResult, type V1Endpoint } from "./core.js";
import { maxUsdPerCall, normalizeKey, payingFetch } from "./pay.js";

const baseUrl = process.env.VERIQL_BASE_URL || "https://veriql.app";
const apiKey = process.env.VERIQL_API_KEY || "";
const walletKey = normalizeKey(process.env.VERIQL_WALLET_PRIVATE_KEY);
const wallet = !apiKey && walletKey ? payingFetch(walletKey, maxUsdPerCall(process.env.VERIQL_MAX_USD_PER_CALL)) : null;
const mode = apiKey ? "key" : wallet ? "x402" : "none";

const needPayment = (): ToolResult => ({
  content: [{
    type: "text",
    text: process.env.VERIQL_WALLET_PRIVATE_KEY && !walletKey
      ? "VERIQL_WALLET_PRIVATE_KEY is not a 32-byte hex EVM private key."
      : "Set VERIQL_WALLET_PRIVATE_KEY (an EVM wallet with a little USDC on Base, Polygon, Arbitrum or Avalanche; each call pays $0.005-$0.05 over x402, no account) or VERIQL_API_KEY (prepaid credits, https://veriql.app/api).",
  }],
  isError: true,
});

/** One paid tool call, by whichever payment the operator configured. */
async function run(endpoint: V1Endpoint, params: Record<string, string | undefined>, body?: unknown): Promise<ToolResult> {
  if (mode === "none") return needPayment();
  const userAgent = `veriql-mcp/${MCP_VERSION}${mode === "x402" ? " (x402)" : ""}`;
  try {
    return toToolResult(await callVeriql(endpoint, params, { baseUrl, apiKey: apiKey || undefined, userAgent, fetchImpl: wallet?.fetch }, body));
  } catch (e) {
    // The x402 client throws on a refused or over-cap payment; say which.
    return { content: [{ type: "text", text: `Payment failed: ${(e as Error)?.message ?? e}` }], isError: true };
  }
}

// Named for the package a user actually installs, and versioned from its
// package.json rather than a literal. Three names for one thing (the config key
// "veriql", the package "veriql-mcp", the identity "veriql-risk") meant an agent
// listing its servers showed an identity nobody had heard of, and a hardcoded
// version was a second place to forget on release.
export const MCP_NAME = "veriql-mcp";
export const MCP_VERSION = "1.4.0";

const server = new McpServer({ name: MCP_NAME, version: MCP_VERSION });

server.registerTool(
  "veriql_scan",
  {
    title: "Veriql wallet scan",
    description:
      "Scan a public wallet address for risky token approvals across 5 EVM chains (Ethereum, BNB Chain, Polygon, Arbitrum, Base). Returns a 0-100 Security Score with itemised drivers, every risky approval, and a best-effort USD value-at-risk.",
    inputSchema: { address: z.string().describe("Public EVM address, 0x…") },
  },
  async ({ address }) => run("scan", { address }),
);

server.registerTool(
  "veriql_token",
  {
    title: "Veriql token check",
    description:
      "Check a token contract for honeypot, punishing taxes, mintable supply, hidden owner and proxy risks, each surfaced as a plain-English flag. EVM chains + Tron.",
    inputSchema: {
      address: z.string().describe("Token contract address"),
      chainId: z.string().optional().describe("Chain id or key (e.g. 1, base, tron); defaults to Ethereum"),
    },
  },
  async ({ address, chainId }) =>
    run("token", { address, chainId }),
);

server.registerTool(
  "veriql_launch",
  {
    title: "Veriql launch-safety score",
    description:
      "A transparent 0-100 launch-safety score for a token/mint with itemised penalty drivers and full metrics. EVM chains + Tron + Solana.",
    inputSchema: {
      address: z.string().describe("Token contract / mint address"),
      chainId: z.string().optional().describe("Chain id or key (e.g. 1, base, solana); defaults to Ethereum"),
    },
  },
  async ({ address, chainId }) =>
    run("launch", { address, chainId }),
);

server.registerTool(
  "veriql_payee",
  {
    title: "Veriql payee check",
    description:
      "Before sending money to an address: is it OFAC-sanctioned, on Drain Watch, or frozen by Tether or Circle (funds sent there can never leave). Answers do_not_pay, no_known_risk or incomplete, and incomplete is not a clean result. EVM, Bitcoin, Solana, Tron.",
    inputSchema: { address: z.string().describe("The address you are about to pay") },
  },
  async ({ address }) => run("payee", { address }),
);

server.registerTool(
  "veriql_send",
  {
    title: "Veriql USDT pre-send check",
    description:
      "Before sending USDT on Tron or Ethereum: will this transfer go through (frozen sender, unactivated account, too little USDT, too little TRX or ETH for the fee, a contract that refuses it, read off the chain with the exact fee), and should it go there at all (recipient OFAC-sanctioned, on Drain Watch, or frozen by Tether, where USDT arrives and can never leave). Answers do_not_send, will_fail, may_fail, goes_through or incomplete, and incomplete is not a clean result.",
    inputSchema: {
      from: z.string().describe("The sending address (Tron T... or Ethereum 0x...)"),
      to: z.string().describe("The recipient, on the same chain"),
      amount: z.string().optional().describe("USDT to send, like 250 or 12.5; leave out to check the whole balance"),
    },
  },
  async ({ from, to, amount }) =>
    run("send", { from, to, amount }),
);

server.registerTool(
  "veriql_signature",
  {
    title: "Veriql signature check",
    description:
      "Before signing: decodes an approve, Permit, Permit2, EIP-7702 delegation, transfer or revoke, checks who gains the power against OFAC and Drain Watch, and answers block, warn or allow. Anything it cannot decode is block.",
    inputSchema: { payload: z.string().describe("Calldata, EIP-712 typed data as JSON, or a JSON-RPC request") },
  },
  async ({ payload }) =>
    run("signature", {}, { payload }),
);

server.registerTool(
  "veriql_preflight",
  {
    title: "Veriql preflight (one call before send, swap or sign)",
    description:
      "Every check one transaction needs, in one call, on whatever you pass: the recipient screen (OFAC, Drain Watch, Tether and Circle freezes) on `to`, the USDT transfer simulation when `from` and `to` are both on Tron or both on Ethereum, the launch score on `tokenAddress`, and the signature decode on `calldata` or `typedData`. Answers ALLOW, WARN or BLOCK. BLOCK only on a fact that loses money; a low score alone is WARN.",
    inputSchema: {
      chainId: z.string().optional().describe("Chain id or key (1, ethereum, base, tron, solana); read off the addresses when omitted"),
      from: z.string().optional().describe("Sending address, for the USDT transfer simulation"),
      to: z.string().optional().describe("Recipient address"),
      amount: z.string().optional().describe("USDT amount, like 250; leave out to check the whole balance"),
      tokenAddress: z.string().optional().describe("Token to score before buying or swapping"),
      calldata: z.string().optional().describe("Calldata or a JSON-RPC request to decode"),
      typedData: z.string().optional().describe("EIP-712 typed data, as JSON"),
    },
  },
  async (args) =>
    run("preflight", {}, args),
);

server.registerTool(
  "veriql_batch_screen",
  {
    title: "Veriql batch address screen",
    description:
      "Screen up to 50 addresses in one call against OFAC SDN sanctions, Drain Watch and Tether and Circle freezes (EVM and Tron). For payout runs, token holder lists and sniper wallets. Each address gets do_not_pay, no_known_risk or incomplete; incomplete is not a clean result.",
    inputSchema: { addresses: z.array(z.string()).describe("1 to 50 EVM, Tron, Solana or Bitcoin addresses") },
  },
  async ({ addresses }) =>
    run("batch-screen", {}, { addresses }),
);

server.registerTool(
  "veriql_x402_seller_check",
  {
    title: "Veriql x402 seller check",
    description:
      "Before paying an x402 endpoint: reads its 402 (version, networks, testnet or not, the real price when the asset is USDC) and screens every wallet it asks to be paid at against OFAC, Drain Watch and Tether and Circle freezes. Answers GO, CAUTION or STOP. GO does not mean the seller delivers.",
    inputSchema: {
      url: z.string().optional().describe("The x402 endpoint to probe (https)"),
      payTo: z.string().optional().describe("A seller wallet to screen, with or without a url"),
    },
  },
  async ({ url, payTo }) =>
    run("x402-seller-check", {}, { url, payTo }),
);

server.registerTool(
  "veriql_deployer",
  {
    title: "Veriql token creator history",
    description:
      "Who created this Solana pump.fun token (read from its bonding curve on chain) and what happened to that creator's other tokens Veriql scored: each one's verdict and any measured liquidity withdrawal or sell-off. History starts 2026-09-30; no record is unknown, never clean.",
    inputSchema: {
      address: z.string().describe("A pump.fun token mint or a creator wallet"),
      limit: z.string().optional().describe("Tokens to list, 1 to 100, default 25"),
    },
  },
  async ({ address, limit }) =>
    run("deployer", { address, limit }),
);

server.registerTool(
  "veriql_freeze",
  {
    title: "Veriql freeze check",
    description:
      "Has Tether or Circle frozen this address, read straight off the issuer's contract, and did it receive USDT directly from an address Tether froze (exposure, not guilt). EVM and Tron. Free, no key needed.",
    inputSchema: { address: z.string().describe("EVM or Tron address") },
  },
  async ({ address }) => toToolResult(await callFreeze(address, { baseUrl, userAgent: `veriql-mcp/${MCP_VERSION}` })),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel — log to stderr only.
  const how = mode === "key" ? "API key" : mode === "x402" ? `x402 from ${wallet!.address}` : "NONE: set VERIQL_WALLET_PRIVATE_KEY or VERIQL_API_KEY";
  console.error(`${MCP_NAME} ready (base ${baseUrl}, paying by ${how})`);
}

main().catch((e) => {
  console.error("veriql mcp fatal:", e);
  process.exit(1);
});
