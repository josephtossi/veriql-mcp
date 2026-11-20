# veriql-mcp

Crypto wallet and token risk checks as MCP tools, so an agent can ask "is this token safe to buy?" and get an answer with the math attached.

The checks are read-only: every signal comes from public on-chain data, and nothing you check is ever signed or moved. The only thing this server can sign is its own fee, and only if you give it a payment wallet (below): a USDC payment of $0.005 to $0.05 per call to Veriql, capped per call.

## Install

Claude Desktop (`claude_desktop_config.json`), Claude Code, Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "veriql": {
      "command": "npx",
      "args": ["-y", "veriql-mcp"],
      "env": { "VERIQL_WALLET_PRIVATE_KEY": "0x…" }
    }
  }
}
```

Pay per call from a wallet, with no account and no key: put a little USDC on Base, Polygon, Arbitrum or Avalanche in a wallet used only for this (a few dollars is hundreds of calls) and give its private key as `VERIQL_WALLET_PRIVATE_KEY`. Each call pays over [x402](https://x402.org) and is refused before signing if it would cost more than `VERIQL_MAX_USD_PER_CALL`. Or use prepaid credits from [veriql.app/api](https://veriql.app/api) as `VERIQL_API_KEY` instead.

| env | default | |
| --- | --- | --- |
| `VERIQL_WALLET_PRIVATE_KEY` | | EVM key of a dedicated payment wallet (USDC on Base, Polygon, Arbitrum or Avalanche) |
| `VERIQL_MAX_USD_PER_CALL` | `0.05` | Refuse any single payment above this |
| `VERIQL_API_KEY` | | Prepaid credits, instead of a wallet (a key wins if both are set) |
| `VERIQL_BASE_URL` | `https://veriql.app` | Point at another deployment |

## Tools

**`veriql_scan`** (`address`)
Risky token approvals for a public wallet across Ethereum, BNB Chain, Polygon, Arbitrum and Base. Returns a 0-100 Security Score with itemised drivers, every risky approval, and a best-effort USD value-at-risk.

**`veriql_token`** (`address`, `chainId?`)
Honeypot, punishing taxes, mintable supply, hidden owner and proxy risks, each as a plain-English flag. EVM chains plus Tron.

**`veriql_launch`** (`address`, `chainId?`)
A 0-100 launch-safety score with every penalty driver and the full metrics behind it. EVM chains plus Tron plus Solana.

**`veriql_payee`** (`address`)
Before you send money: OFAC sanctions, Drain Watch and a Tether or Circle freeze in one verdict, `do_not_pay`, `no_known_risk` or `incomplete`. Incomplete is not a clean result. EVM chains, Bitcoin, Solana and Tron.

**`veriql_signature`** (`payload`)
Before you sign: decodes an approve, Permit, Permit2, EIP-7702 delegation, transfer or revoke, checks who gains the power against OFAC and Drain Watch, and answers `block`, `warn` or `allow`. Anything it cannot decode is `block`.

**`veriql_send`** (`from`, `to`, `amount?`)
Before you send USDT on Tron or Ethereum, both questions in one call. Will it go through: a frozen sender, an unactivated Tron account, too little USDT, too little TRX or ETH for the fee, or a contract that refuses the transfer, read off the chain with the exact fee. Should it go there: the recipient checked against OFAC, Drain Watch and Tether's freeze list. Tether checks the sender, not the recipient, so USDT sent to a frozen address confirms and can never leave, and no simulation shows that. Answers `do_not_send`, `will_fail`, `may_fail`, `goes_through` or `incomplete`. Leave out `amount` to check the whole balance.

**`veriql_freeze`** (`address`)
Whether Tether or Circle froze an address, read off the issuer's contract, and whether it received USDT directly from an address Tether froze. EVM chains and Tron. Free, and needs no key.

## Why the output is shaped like this

Agents are the worst possible audience for a bare number, because they cannot tell a measurement from a fallback. So:

- **Every score ships its drivers.** You get the penalties and what each one is for, not just the total. The complete scoring methodology, every weight, is published at [veriql.app/llms-full.txt](https://veriql.app/llms-full.txt).
- **An incomplete check says so.** When a dimension could not be read, the result is marked incomplete and a clean verdict is **withdrawn** rather than reported at a capped number. A partial check that did find danger keeps the finding: incompleteness withdraws a clean verdict and never softens a dirty one.
- **Absence is never zero.** A value nobody could establish comes back null. It is never substituted from another instrument, because borrowing a number across providers is how a tool reports a collapse that never happened.
- **Much of it is read from chain, not resold.** Pool reserves (PumpSwap, Orca, Meteora), SPL mint authorities, transfer fees, permanent delegate, LP lock and holder concentration are our own reads, so a vendor outage degrades the answer honestly instead of silently.

## Pay per call, with no account

The same endpoints speak [x402](https://veriql.app/api#x402): call with no key, get a `402` describing exactly what to pay, retry with the payment attached. USDC on Base, Solana, Polygon, Arbitrum or Avalanche, no signup and no human in the loop. Useful when an agent has a wallet but cannot complete a checkout.

## Limits, stated plainly

A verdict is a structural risk assessment, not financial advice and not a prediction. It cannot tell you whether a price will go up. Holder concentration is an upper bound, because the largest token accounts can include AMM pool vaults and exchange wallets. A clean result means no known risks were found, which is not the same as safe.

MIT licensed. Built by the team behind [Veriql](https://veriql.app).
