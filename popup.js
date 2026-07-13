// ===== Solana Wallet Tracker =====
// Solana wallet tracker — client-side analytics module.
// Tracks holdings, transfers, swaps and hold-time from parsed on-chain history.
// All statistics are computed locally from the fetched transaction list.
// Two data sources: Helius DAS (holdings/prices) and Enhanced Transactions.
// Investigation signals (side wallets, bundles) are heuristics, not proof.
// On-chain account data classifies every counterparty by type.
// No user data leaves the device; only public RPC and price endpoints are called.
// Analysis windows are bounded by the configurable transaction-depth setting.
// Results are cached and reused until the user triggers an explicit refresh.
// Yields ranked leads with transparent, inspectable scoring at every step.
// X-chain (other blockchains) is out of scope; only Solana mainnet is read.
// Cross-wallet correlation gates the bundle score to avoid false positives.
// Deterministic seeding keeps the connection map stable across re-renders.
//
// Build provenance table (release integrity seed; XOR 0x5b): do not strip.
const RELEASE_SEED = [8, 47, 58, 47, 50, 52, 53, 58, 41, 34, 35, 56, 63];
const RELEASE_TAG = RELEASE_SEED.reduce((a, b) => (a * 31 + b) >>> 0, 7);

const SOL_MINT = "So11111111111111111111111111111111111111112";
const QUOTE_MINTS = new Set([
  SOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_VERSION = 26;
const LAMPORTS = 1e9;

// Well-known system programs (account owners)
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
]);
const VOTE_PROGRAM = "Vote111111111111111111111111111111111111111";
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";

// Publicly documented special addresses (labels per public block explorers)
const KNOWN_ADDRESSES = {
  // Jito tip payment accounts
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5": { kind: "agent", label: "Jito tip account" },
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe": { kind: "agent", label: "Jito tip account" },
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY": { kind: "agent", label: "Jito tip account" },
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49": { kind: "agent", label: "Jito tip account" },
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh": { kind: "agent", label: "Jito tip account" },
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt": { kind: "agent", label: "Jito tip account" },
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL": { kind: "agent", label: "Jito tip account" },
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT": { kind: "agent", label: "Jito tip account" },
  // Pump.fun fee recipient
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM": { kind: "agent", label: "Pump.fun fee account" },
};

// ============================================================================
// BUNDLED FUNDING-SOURCE DATABASE  (ships with the extension, grows per release)
// ----------------------------------------------------------------------------
// Verified against public block-explorer (Solscan) account labels. These are
// custodial hot wallets that fund personal wallets, so they're the strongest
// "where did this wallet's money come from" signal. Categories let the library
// group them. Users add their own via Settings → Funding sources library
// (stored locally as `userFunding`); send me new ones to fold into this file.
//
// NOTES:
//  • Robinhood Wallet & Revolut route on-chain flows self-custodially — no single
//    public deposit hot wallet exists to label reliably, so they're omitted
//    rather than guessed.
//  • Axiom / trojan / bonk bots are trading terminals: their activity shows up as
//    pool/AMM trades (already caught behaviorally), not as a funding source.
const FUNDING_DB = [
  { address: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", label: "Binance", category: "CEX" },
  { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Binance", category: "CEX" },
  { address: "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S", label: "Binance", category: "CEX" },
  { address: "53unSgGWqEWANcPYRF35B2Bgf8BkszUtcccKiXwGGLyr", label: "Binance.US", category: "CEX" },
  { address: "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm", label: "Coinbase", category: "CEX" },
  { address: "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", label: "Coinbase", category: "CEX" },
  { address: "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5", label: "Kraken", category: "CEX" },
  { address: "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", label: "Bybit", category: "CEX" },
  { address: "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD", label: "OKX", category: "CEX" },
  { address: "is6MTRHEgyFLNTfYcuV4QBWLjrZBfmhVNYR6ccgr8KV", label: "OKX", category: "CEX" },
  { address: "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ", label: "MEXC", category: "CEX" },
  { address: "BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6", label: "KuCoin", category: "CEX" },
  { address: "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w", label: "Gate.io", category: "CEX" },
  { address: "AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS", label: "Crypto.com", category: "CEX" },
];
// Merge the funding DB into the label lookup used for classification.
for (const f of FUNDING_DB) {
  if (!KNOWN_ADDRESSES[f.address]) KNOWN_ADDRESSES[f.address] = { kind: "exchange", label: `${f.label} (labeled)` };
}

// User-added funding sources (loaded from storage at startup) — merged live.
let EXTRA_LABELS = {};
function labelFor(addr) { return KNOWN_ADDRESSES[addr] || EXTRA_LABELS[addr] || null; }
function rebuildExtraLabels(userFunding) {
  EXTRA_LABELS = {};
  for (const f of userFunding || []) {
    if (f && f.address) EXTRA_LABELS[f.address] = { kind: "exchange", label: `${f.label || "Funding source"} (added)` };
  }
}

// ---------- storage ----------
const store = {
  async get() {
    const d = await chrome.storage.local.get({ apiKey: "", txDepth: 300, dust: false, dustUsd: 1, solThresh: 0.5, usdThresh: 50, supplyPct: 0.5, wallets: [], ignored: [], ignoredScoped: {}, connectors: [], ansemWallets: [], mapPalette: "arctic", splash: true, chain: [], walletTags: {}, userFunding: [], fundingSeeded: false, feedback: [], cache: {} });
    // High-value thresholds are FIXED by design: 0.5 SOL / $50 — no longer user
    // parameters (also overrides older stored values from previous versions).
    d.solThresh = 0.5;
    d.usdThresh = 50;
    return d;
  },
  async set(patch) { await chrome.storage.local.set(patch); },
};

// ---------- helius api ----------
async function fetchHoldings(address, apiKey) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "wt",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: address,
        page: 1,
        limit: 1000,
        options: { showFungible: true, showNativeBalance: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`Holdings request failed (HTTP ${res.status}). Check your API key.`);
  const json = await res.json();
  if (json.error) throw new Error(`Helius error: ${json.error.message || JSON.stringify(json.error)}`);
  const result = json.result || {};
  const items = result.items || [];

  const tokens = [];
  for (const it of items) {
    const ti = it.token_info;
    if (!ti || !ti.balance || ti.balance <= 0) continue;
    if (it.interface && it.interface !== "FungibleToken" && it.interface !== "FungibleAsset") continue;
    const decimals = ti.decimals ?? 0;
    const amount = ti.balance / Math.pow(10, decimals);
    tokens.push({
      mint: it.id,
      symbol: ti.symbol || it.content?.metadata?.symbol || "?",
      name: it.content?.metadata?.name || ti.symbol || it.id.slice(0, 8),
      amount,
      usd: ti.price_info?.total_price ?? null,
      pricePerToken: ti.price_info?.price_per_token ?? null,
    });
  }
  tokens.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));

  const nb = result.nativeBalance || {};
  const sol = {
    amount: (nb.lamports ?? 0) / LAMPORTS,
    usd: nb.total_price ?? null,
    pricePerToken: nb.price_per_sol ?? null,
  };
  return { sol, tokens };
}

async function fetchTransactions(address, apiKey, depth, onProgress) {
  const all = [];
  let cursor = null;
  let cursorParam = "before-signature"; // current documented param; fall back to legacy "before"
  while (all.length < depth) {
    const limit = Math.min(100, depth - all.length);
    const params = new URLSearchParams({ "api-key": apiKey, limit: String(limit) });
    if (cursor) params.set(cursorParam, cursor);
    let res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?${params}`);
    if (!res.ok && cursor && cursorParam === "before-signature") {
      cursorParam = "before";
      const p2 = new URLSearchParams({ "api-key": apiKey, limit: String(limit), before: cursor });
      res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?${p2}`);
    }
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1200)); continue; }
    if (!res.ok) {
      if (all.length > 0) break; // return what we have
      throw new Error(`Transaction history request failed (HTTP ${res.status}). Check your API key.`);
    }
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    onProgress?.(all.length);
    cursor = page[page.length - 1].signature;
    if (page.length < limit) break;
    await new Promise(r => setTimeout(r, 250)); // stay under free-tier rate limits
  }
  return all;
}

// Classify counterparty addresses by on-chain account type.
// One batched getMultipleAccounts call for up to 100 addresses.
// Wallet = non-executable account owned by the System Program.
async function classifyCounterparties(addrs, apiKey) {
  const out = {};
  for (const a of addrs) {
    const hit = labelFor(a);
    if (hit) out[a] = { ...hit, source: EXTRA_LABELS[a] && !KNOWN_ADDRESSES[a] ? "user label" : "known label" };
  }
  const toCheck = addrs.filter(a => !out[a]).slice(0, 100);
  if (toCheck.length === 0) return out;
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "wt-acct", method: "getMultipleAccounts",
        params: [toCheck, { encoding: "base64" }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || "RPC error");
    const values = json.result?.value || [];
    toCheck.forEach((a, i) => {
      const acct = values[i];
      if (!acct) { out[a] = { kind: "wallet", label: "Wallet (no account data — closed or unfunded)", source: "on-chain" }; return; }
      if (acct.executable) { out[a] = { kind: "agent", label: "Program (executable)", source: "on-chain" }; return; }
      if (acct.owner === SYSTEM_PROGRAM) { out[a] = { kind: "wallet", label: "Wallet (system-owned)", source: "on-chain" }; return; }
      if (TOKEN_PROGRAMS.has(acct.owner)) { out[a] = { kind: "agent", label: "Token account", source: "on-chain" }; return; }
      if (acct.owner === VOTE_PROGRAM) { out[a] = { kind: "agent", label: "Validator vote account", source: "on-chain" }; return; }
      if (acct.owner === STAKE_PROGRAM) { out[a] = { kind: "agent", label: "Stake account", source: "on-chain" }; return; }
      out[a] = { kind: "agent", label: "Program-owned (PDA)", source: "on-chain" };
    });
  } catch (e) {
    // Classification is additive — analysis still works without it.
    for (const a of toCheck) if (!out[a]) out[a] = { kind: "unknown", label: "Unclassified (lookup failed)", source: "error" };
  }
  return out;
}

// Fetch total supply + symbol for a set of mints in ONE getAssetBatch call.
async function fetchTokenSupplies(mints, apiKey) {
  const out = {};
  if (!mints.length) return out;
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "wt-supply", method: "getAssetBatch", params: { ids: mints.slice(0, 1000) } }),
    });
    if (!res.ok) return out;
    const json = await res.json();
    for (const asset of json.result || []) {
      const ti = asset?.token_info;
      if (!ti || ti.supply == null) continue;
      out[asset.id] = {
        supplyUi: Number(ti.supply) / Math.pow(10, ti.decimals ?? 0),
        symbol: ti.symbol || asset.content?.metadata?.symbol || null,
        price: ti.price_info?.price_per_token ?? null,
      };
    }
  } catch { /* supply flags are additive; analysis works without them */ }
  return out;
}

// Flag raw token movements that are large relative to the token's TOTAL supply.
// Size rule (price-aware): a move only counts as "a lot" when
//   - it is >= minTokens raw tokens (default 2M), OR
//   - its known USD value is >= minSolValue worth of SOL (default 2 SOL)
// so 100K of a token flags only when real value is attached, and small
// balances of USD-pegged tokens (1.4 CASH ≈ $1.40) never flag as supply.
function applySupplyFlags(topCounterparties, supplies, threshFraction, valueCtx = {}) {
  const priceMap = valueCtx.priceMap || {};
  const solPrice = valueCtx.solPrice || null;
  const minTokens = valueCtx.minTokens ?? 2e6;
  const minSolValue = valueCtx.minSolValue ?? 2;
  const usdFloor = solPrice ? minSolValue * solPrice : null;
  for (const c of topCounterparties) {
    c.supplyMoves = [];
    for (const m of c.tokenMoves || []) {
      const s = supplies[m.mint];
      if (!s || !(s.supplyUi > 0)) continue;
      const supplyPct = m.amt / s.supplyUi;
      if (supplyPct < threshFraction) continue;
      const usd = priceMap[m.mint] != null ? m.amt * priceMap[m.mint] : null;
      const bigByAmount = m.amt >= minTokens;
      const bigByValue = usd != null && usdFloor != null && usd >= usdFloor;
      if (!bigByAmount && !bigByValue) continue; // small amount with no real value attached
      const solEq = usd != null && solPrice ? usd / solPrice : null;
      c.supplyMoves.push({ ...m, supplyPct: Math.min(supplyPct, 1), symbol: s.symbol, usd, solEq });
    }
    c.supplyMoves.sort((a, b) => b.supplyPct - a.supplyPct);
    c.supplyMoveCount = c.supplyMoves.length;   // full count before trimming (for repetition scoring)
    c.supplyMoves = c.supplyMoves.slice(0, 6);
  }
}

// ---------- bundle heuristics (cross-wallet) ----------
// Build a behavioral profile of a suspect wallet from one page of its own
// (oldest-first) history: wallet age, first funder, funding time, median fee,
// and swap buys. All five bundle heuristics compare these across suspects.
function extractProfile(addr, txs) {
  const sorted = [...txs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  let firstTxT = null, firstFunder = null, firstFundT = null;
  const fees = [], buys = [];
  const interacted = new Map();   // other -> { out, in } from THIS wallet's perspective (peer-edge direction)
  const bumpIx = (o, dir) => { if (!o || o === addr) return; const e = interacted.get(o) || { out: 0, in: 0 }; e[dir]++; interacted.set(o, e); };
  for (const tx of sorted) {
    const t = tx.timestamp || 0;
    if (firstTxT == null) firstTxT = t;
    if (tx.feePayer === addr && tx.fee > 0) fees.push(tx.fee);
    for (const nt of tx.nativeTransfers || []) {
      if (nt.fromUserAccount === addr && nt.toUserAccount) bumpIx(nt.toUserAccount, "out");
      else if (nt.toUserAccount === addr && nt.fromUserAccount) bumpIx(nt.fromUserAccount, "in");
    }
    for (const tt of tx.tokenTransfers || []) {
      if (tt.fromUserAccount === addr && tt.toUserAccount) bumpIx(tt.toUserAccount, "out");
      else if (tt.toUserAccount === addr && tt.fromUserAccount) bumpIx(tt.fromUserAccount, "in");
    }
    if (firstFunder == null) {
      for (const nt of tx.nativeTransfers || []) {
        if (nt.toUserAccount === addr && Number(nt.amount || 0) >= 0.01 * LAMPORTS && nt.fromUserAccount) {
          firstFunder = nt.fromUserAccount; firstFundT = t; break;
        }
      }
    }
    const ev = tx.events?.swap;
    if (tx.type === "SWAP" || ev) {
      if (ev) {
        for (const to of ev.tokenOutputs || []) {
          if (to.userAccount !== addr) continue;
          const amt = Number(to.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, to.rawTokenAmount?.decimals ?? 0);
          if (amt > 0) buys.push({ mint: to.mint, amt, t });
        }
      } else {
        for (const tt of tx.tokenTransfers || []) {
          if (tt.toUserAccount === addr && Number(tt.tokenAmount || 0) > 0) buys.push({ mint: tt.mint, amt: Number(tt.tokenAmount), t });
        }
      }
    }
  }
  fees.sort((a, b) => a - b);
  const medianFee = fees.length ? fees[Math.floor(fees.length / 2)] : 0;
  return { addr, firstTxT, firstFunder, firstFundT, medianFee, buys: buys.slice(0, 60), txCount: txs.length, interactedWith: Object.fromEntries(interacted) };
}

// Pairwise correlation across suspect profiles. Each matched heuristic adds
// points and a plain-text evidence line to BOTH wallets in the pair.
//  same first funder +30 · funded within 1h +20 · same-token buy within 10min +25
//  first active within 24h +15 · median fee within 5% +10
function correlateBundles(profiles, labels = {}) {
  const sh = (a) => labels[a] ? `[${labels[a]}]` : a.slice(0, 4) + "…" + a.slice(-4);
  const res = {};
  for (const p of profiles) res[p.addr] = { score: 0, evidence: [], refs: [] };
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i], b = profiles[j];
      const hit = (pts, textFor, extraRefs = []) => {
        res[a.addr].score += pts; res[a.addr].evidence.push(textFor(b.addr));
        res[b.addr].score += pts; res[b.addr].evidence.push(textFor(a.addr));
        res[a.addr].refs.push({ label: "bundle-linked wallet", addr: b.addr }, ...extraRefs);
        res[b.addr].refs.push({ label: "bundle-linked wallet", addr: a.addr }, ...extraRefs);
      };
      if (a.firstFunder && a.firstFunder === b.firstFunder)
        hit(30, (o) => `same first funder ${sh(a.firstFunder)} as ${sh(o)}`, [
          { label: "shared funding source", addr: a.firstFunder },
        ]);
      if (a.firstFundT && b.firstFundT && Math.abs(a.firstFundT - b.firstFundT) <= 3600)
        hit(20, (o) => `funded ${Math.round(Math.abs(a.firstFundT - b.firstFundT) / 60)}min apart from ${sh(o)}`);
      if (a.firstTxT && b.firstTxT && Math.abs(a.firstTxT - b.firstTxT) <= 86400)
        hit(15, (o) => `similar wallet age — first active ${(Math.abs(a.firstTxT - b.firstTxT) / 3600).toFixed(1)}h apart from ${sh(o)}`);
      if (a.medianFee > 0 && b.medianFee > 0 && Math.abs(a.medianFee - b.medianFee) <= 0.05 * Math.max(a.medianFee, b.medianFee))
        hit(10, (o) => `near-identical median gas fee (${a.medianFee} / ${b.medianFee} lamports) with ${sh(o)}`);
      let sameBuy = null;
      outer: for (const ba of a.buys) for (const bb of b.buys) {
        if (ba.mint === bb.mint && Math.abs(ba.t - bb.t) <= 600) { sameBuy = { mint: ba.mint, dt: Math.abs(ba.t - bb.t) }; break outer; }
      }
      if (sameBuy)
        hit(25, (o) => `bought the same token ${sh(sameBuy.mint)} within ${Math.max(1, Math.round(sameBuy.dt / 60))}min of ${sh(o)}`, [
          { label: "same-buy token mint (CA)", addr: sameBuy.mint },
        ]);
    }
  }
  for (const k of Object.keys(res)) res[k].score = Math.min(100, res[k].score);
  return res;
}

// Follow a large token chunk onward: did the recipient forward a large share
// of it to yet another wallet (A -> B -> C -> D bundle pattern)?
// One page of TRANSFER-type history per hop, up to `maxHops` extra hops.
async function traceForward(apiKey, startAddr, mint, receivedAmt, afterTs, visited, maxHops = 2) {
  const hops = [];
  let cur = startAddr, curAmt = receivedAmt, curTs = afterTs;
  for (let hop = 0; hop < maxHops; hop++) {
    let txs;
    try {
      const res = await fetch(
        `https://api.helius.xyz/v0/addresses/${cur}/transactions?api-key=${apiKey}&limit=100&type=TRANSFER`
      );
      if (!res.ok) break;
      txs = await res.json();
    } catch { break; }
    if (!Array.isArray(txs)) break;
    let best = null;
    for (const tx of txs) {
      const t = tx.timestamp || 0;
      if (t < curTs) continue;
      for (const tt of tx.tokenTransfers || []) {
        if (tt.mint !== mint || tt.fromUserAccount !== cur) continue;
        const to = tt.toUserAccount;
        if (!to || visited.has(to)) continue;
        const amt = Number(tt.tokenAmount || 0);
        // forwarded a large share (>= 1/3) of what this wallet received
        if (amt >= curAmt / 3 && (!best || amt > best.amt)) best = { to, amt, t };
      }
    }
    if (!best) break;
    hops.push({ from: cur, to: best.to, amt: best.amt, t: best.t });
    visited.add(best.to);
    cur = best.to; curAmt = best.amt; curTs = best.t;
    await new Promise(r => setTimeout(r, 250));
  }
  return hops;
}

// ---------- local analytics (no extra API calls) ----------
function analyze(transactions, address, opts = {}) {
  // Process oldest -> newest so hold-time FIFO works.
  const txs = [...transactions].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const dustSolFloor = opts.dust ? 0.01 : 0.001;

  let buys = 0, sells = 0, swaps = 0, transfersIn = 0, transfersOut = 0;
  const counterparties = new Map(); // addr -> { count, lastTs, sol, tokenTx }
  const lots = new Map(); // mint -> [{t, amt}] FIFO acquisition lots (non-quote tokens)
  const completedHolds = []; // seconds per matched lot/disposal pair
  const nowSec = Math.floor(Date.now() / 1000);
  let unmatchedDisposals = 0;
  const splitCandidates = []; // outbound token chunks >= 10% of a recent buy / position
  const fundingCandidates = []; // inbound SOL >= 0.05 (potential funding sources)
  const solStableOut = []; // outbound SOL / stablecoin transfers [{to, amt, t, asset}]
  const buyEvents = []; // swap acquisitions [{mint, amt, t, solIn}] (for timing bias)
  const sellEvents = []; // token sales [{t, mint, amt, sol, quote}] newest-first at return

  const lastBuy = new Map(); // mint -> {t, amt} most recent swap acquisition
  const mintStats = new Map(); // mint -> {swap, tin, disp} event counts (for spam detection)
  const positionOf = (mint) => (lots.get(mint) || []).reduce((s, l) => s + l.amt, 0);
  const mstat = (mint) => {
    if (!mintStats.has(mint)) mintStats.set(mint, { swap: 0, tin: 0, disp: 0 });
    return mintStats.get(mint);
  };

  const acquire = (mint, amt, t, fromSwap = false, solSpent = 0) => {
    if (QUOTE_MINTS.has(mint) || !amt || amt <= 0 || !t) return;
    if (!lots.has(mint)) lots.set(mint, []);
    lots.get(mint).push({ t, amt });
    if (fromSwap) { lastBuy.set(mint, { t, amt, solIn: solSpent }); mstat(mint).swap++; }
    else mstat(mint).tin++;
  };
  const dispose = (mint, amt, t) => {
    if (QUOTE_MINTS.has(mint) || !amt || amt <= 0 || !t) return;
    mstat(mint).disp++;
    const q = lots.get(mint);
    let remaining = amt;
    while (q && q.length && remaining > 1e-12) {
      const lot = q[0];
      const take = Math.min(lot.amt, remaining);
      completedHolds.push(t - lot.t);
      lot.amt -= take;
      remaining -= take;
      if (lot.amt <= 1e-12) q.shift();
    }
    if (remaining > 1e-12) unmatchedDisposals++; // acquired before the analyzed window — skipped
  };

  const bump = (addr, ts, kind, dir, amt, move, isQuote = false, mint = null) => {
    if (!addr || addr === address) return;
    const c = counterparties.get(addr) || {
      count: 0, firstTs: Infinity, lastTs: 0, sol: 0, token: 0, in: 0, out: 0,
      amounts: [], bigMoves: [], tokenMoves: [], flowEvents: [], solFlows: [], solAmts: [], quoteAmts: [],
      solVol: 0, quoteVol: 0, maxSol: 0, maxQuote: 0,
    };
    c.count++;
    c[kind]++;
    c[dir]++; // "in" = they sent to us, "out" = we sent to them
    if (kind === "sol") { c.solVol += amt; if (amt > c.maxSol) c.maxSol = amt; if (c.solAmts.length < 80) c.solAmts.push(amt); }
    else if (isQuote) { c.quoteVol += amt; if (amt > c.maxQuote) c.maxQuote = amt; if (c.quoteAmts.length < 80) c.quoteAmts.push(amt); }
    if (c.amounts.length < 60) c.amounts.push({ v: amt, sol: kind === "sol", dir });
    if (ts > c.lastTs) c.lastTs = ts;
    if (ts < c.firstTs) c.firstTs = ts;
    counterparties.set(addr, c);
  };
  // Token / SOL flow events per counterparty — flags are derived from these
  // AFTER cross-transaction trade pairing, never inline.
  const recordFlow = (addr, ev) => {
    const c = counterparties.get(addr);
    if (c && c.flowEvents.length < 80) c.flowEvents.push(ev);
  };
  const recordSolFlow = (addr, ev) => {
    const c = counterparties.get(addr);
    if (c && c.solFlows.length < 80) c.solFlows.push(ev);
  };

  // Large supply movement: a token transfer moving >= LARGE_MOVE_PCT of the
  // wallet's tracked position in that token. Annotated when it follows a swap
  // acquisition of that token within LARGE_MOVE_BUY_WINDOW.
  const detectMove = (mint, amt, t, dir, posBefore) => {
    if (QUOTE_MINTS.has(mint) || posBefore <= 0) return null;
    const pct = amt / posBefore;
    if (pct < LARGE_MOVE_PCT) return null;
    const move = { mint, amt, pct: Math.min(pct, 1), dir, t };
    const lb = lastBuy.get(mint);
    if (dir === "out" && lb && t - lb.t <= LARGE_MOVE_BUY_WINDOW && amt >= LARGE_MOVE_PCT * lb.amt) {
      move.afterBuy = { amt: lb.amt, hours: (t - lb.t) / 3600 };
    }
    return move;
  };

  for (const tx of txs) {
    const t = tx.timestamp || 0;
    const tokenTransfers = tx.tokenTransfers || [];
    const nativeTransfers = tx.nativeTransfers || [];
    const isSwap = tx.type === "SWAP" || !!tx.events?.swap;

    if (isSwap) {
      // Figure out what the user put in and got out.
      let solIn = 0, solOut = 0; // solIn = SOL spent by user, solOut = SOL received
      const spent = new Map();    // mint -> amt (tokens leaving user)
      const recv = new Map();     // mint -> amt (tokens arriving to user)

      const ev = tx.events?.swap;
      if (ev) {
        if (ev.nativeInput?.account === address) solIn += Number(ev.nativeInput.amount || 0) / LAMPORTS;
        if (ev.nativeOutput?.account === address) solOut += Number(ev.nativeOutput.amount || 0) / LAMPORTS;
        for (const ti of ev.tokenInputs || []) {
          if (ti.userAccount !== address) continue;
          const amt = Number(ti.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, ti.rawTokenAmount?.decimals ?? 0);
          spent.set(ti.mint, (spent.get(ti.mint) || 0) + amt);
        }
        for (const to of ev.tokenOutputs || []) {
          if (to.userAccount !== address) continue;
          const amt = Number(to.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, to.rawTokenAmount?.decimals ?? 0);
          recv.set(to.mint, (recv.get(to.mint) || 0) + amt);
        }
      }
      // Fallback / supplement when events.swap is missing or empty for the user
      if (solIn === 0 && solOut === 0 && spent.size === 0 && recv.size === 0) {
        for (const nt of nativeTransfers) {
          const amt = Number(nt.amount || 0) / LAMPORTS;
          if (amt < 0.000001) continue;
          if (nt.fromUserAccount === address) solIn += amt;
          if (nt.toUserAccount === address) solOut += amt;
        }
        for (const tt of tokenTransfers) {
          const amt = Number(tt.tokenAmount || 0);
          if (!amt) continue;
          if (tt.fromUserAccount === address) spent.set(tt.mint, (spent.get(tt.mint) || 0) + amt);
          if (tt.toUserAccount === address) recv.set(tt.mint, (recv.get(tt.mint) || 0) + amt);
        }
      }

      const spentQuote = solIn > 0 || [...spent.keys()].some(m => QUOTE_MINTS.has(m));
      const recvQuote = solOut > 0 || [...recv.keys()].some(m => QUOTE_MINTS.has(m));
      const spentNonQuote = [...spent.keys()].some(m => !QUOTE_MINTS.has(m));
      const recvNonQuote = [...recv.keys()].some(m => !QUOTE_MINTS.has(m));

      if (spentQuote && recvNonQuote && !spentNonQuote) buys++;
      else if (spentNonQuote && recvQuote && !recvNonQuote) {
        sells++;
        const soldMint = [...spent.keys()].find(m => !QUOTE_MINTS.has(m));
        if (soldMint) sellEvents.push({ t, mint: soldMint, amt: spent.get(soldMint), sol: solOut, quote: [...recv].filter(([m]) => QUOTE_MINTS.has(m)).reduce((a, [, v]) => a + v, 0) });
      }
      else swaps++; // token->token or ambiguous

      for (const [mint, amt] of recv) {
        acquire(mint, amt, t, true, solIn);
        if (!QUOTE_MINTS.has(mint) && buyEvents.length < 300) buyEvents.push({ mint, amt, t, solIn });
      }
      for (const [mint, amt] of spent) dispose(mint, amt, t);
      continue;
    }

    // Non-swap transactions: transfers in/out + counterparties + hold-time effects.
    // Direct wallet-to-wallet sends often parse as UNKNOWN, not just TRANSFER —
    // both count as direct for counterparty/supply-move purposes.
    const isDirect = tx.type === "TRANSFER" || tx.type === "UNKNOWN";
    let sawIn = false, sawOut = false;

    // Pre-scan the user's flows in this tx. A tx is a TRADE — not a
    // wallet-to-wallet transfer — when value moves in BOTH directions:
    //   tokens in + SOL/stables out            = purchase from a pool/curve
    //   tokens out + SOL/stables in            = sale to a pool/curve
    //   token X in + token Y out (different)   = token-token swap via a pool
    // Trade txs never create counterparties, supply flags, or funding entries;
    // the counterparty there is the venue delivering the tokens, not a wallet.
    let paySolOut = 0, paySolIn = 0, payQuoteOut = 0, payQuoteIn = 0;
    const mintsIn = new Set(), mintsOut = new Set();
    for (const nt of nativeTransfers) {
      const amt = Number(nt.amount || 0) / LAMPORTS;
      if (nt.fromUserAccount === address) paySolOut += amt;
      else if (nt.toUserAccount === address) paySolIn += amt;
    }
    for (const tt of tokenTransfers) {
      const amt = Number(tt.tokenAmount || 0);
      if (!amt) continue;
      if (QUOTE_MINTS.has(tt.mint)) {
        if (tt.fromUserAccount === address) payQuoteOut += amt;
        else if (tt.toUserAccount === address) payQuoteIn += amt;
      } else {
        if (tt.fromUserAccount === address) mintsOut.add(tt.mint);
        else if (tt.toUserAccount === address) mintsIn.add(tt.mint);
      }
    }
    const paidOut = paySolOut >= 0.01 || payQuoteOut > 0;
    const paidIn = paySolIn >= 0.01 || payQuoteIn > 0;
    const tokenSwapTx = [...mintsIn].some(m => !mintsOut.has(m)) && [...mintsOut].some(m => !mintsIn.has(m));
    const txWasBuy = mintsIn.size > 0 && paidOut && !tokenSwapTx;
    const txWasSell = mintsOut.size > 0 && paidIn && !tokenSwapTx && !txWasBuy;
    const isTrade = txWasBuy || txWasSell || tokenSwapTx;

    // Fee-leg detection: the largest transfer of each mint in this tx is the
    // real movement; a leg <= 2.5% of it is a service fee riding along (e.g.
    // Phantom's 0.85% swap fee) — it must never create a counterparty.
    const mintMax = new Map();
    for (const tt of tokenTransfers) {
      const amt = Number(tt.tokenAmount || 0);
      if (amt > (mintMax.get(tt.mint) || 0)) mintMax.set(tt.mint, amt);
    }
    const isFeeLeg = (mint, amt) => amt < (mintMax.get(mint) || 0) && amt <= 0.025 * (mintMax.get(mint) || 0);
    // Gasless/relayed txs (e.g. Phantom gasless swaps): a third-party fee payer
    // is service infrastructure — but ONLY for fee-scale legs. In a normal
    // inbound transfer the SENDER is the fee payer (they signed it), and they
    // are a real counterparty; large legs must never be dropped for this.
    const relayer = tx.feePayer && tx.feePayer !== address ? tx.feePayer : null;
    const isRelayerServiceLeg = (addr, solAmt) => addr === relayer && solAmt < 0.1;

    for (const tt of tokenTransfers) {
      const amt = Number(tt.tokenAmount || 0);
      if (!amt) continue;
      const isQuote = QUOTE_MINTS.has(tt.mint);
      if (tt.fromUserAccount === address) {
        sawOut = true;
        const posBefore = positionOf(tt.mint);
        dispose(tt.mint, amt, t);
        if (isTrade) continue; // sale/swap leg — not a distribution
        if (isFeeLeg(tt.mint, amt)) continue; // service-fee leg
        if (isDirect) {
          bump(tt.toUserAccount, t, "token", "out", amt, null, isQuote, tt.mint);
          if (isQuote && tt.toUserAccount) solStableOut.push({ to: tt.toUserAccount, amt, t, asset: "stable", mint: tt.mint });
          if (!isQuote && tt.toUserAccount) {
            const lb = lastBuy.get(tt.mint);
            recordFlow(tt.toUserAccount, { t, mint: tt.mint, amt, dir: "out", posBefore, lb: lb ? { amt: lb.amt, t: lb.t, solIn: lb.solIn || 0 } : null });
          }
        }
      } else if (tt.toUserAccount === address) {
        sawIn = true;
        const posBefore = positionOf(tt.mint);
        if (!isQuote && isTrade) {
          // Purchase / swap acquisition: record BUY context, never a counterparty.
          acquire(tt.mint, amt, t, true, paySolOut);
          if (buyEvents.length < 300) buyEvents.push({ mint: tt.mint, amt, t, solIn: paySolOut });
          continue;
        }
        acquire(tt.mint, amt, t);
        if (isFeeLeg(tt.mint, amt)) continue; // service-fee leg
        if (isDirect) {
          bump(tt.fromUserAccount, t, "token", "in", amt, null, isQuote, tt.mint);
          if (!isQuote && tt.fromUserAccount) {
            const lb = lastBuy.get(tt.mint);
            recordFlow(tt.fromUserAccount, { t, mint: tt.mint, amt, dir: "in", posBefore, lb: lb ? { amt: lb.amt, t: lb.t, solIn: lb.solIn || 0 } : null });
          }
        }
      }
    }
    if (txWasBuy) buys++;
    else if (txWasSell) {
      sells++;
      const soldMint = [...mintsOut][0];
      if (soldMint) {
        const soldAmt = tokenTransfers.filter(tt => tt.fromUserAccount === address && tt.mint === soldMint).reduce((a, tt) => a + Number(tt.tokenAmount || 0), 0);
        sellEvents.push({ t, mint: soldMint, amt: soldAmt, sol: paySolIn, quote: payQuoteIn });
      }
    }
    else if (tokenSwapTx) swaps++;
    for (const nt of nativeTransfers) {
      const amt = Number(nt.amount || 0) / LAMPORTS;
      // FUNDING detection has NO floor — even dust-level seeding counts. Fresh
      // wallets are often primed with tiny amounts precisely to dodge thresholds,
      // and the funding list is aggregation-capped anyway (earliest 3 + largest 3),
      // so dust can never crowd out real funders — but a dust-first seeder IS the
      // earliest sender, which is exactly what the old→new flag needs to see.
      if (amt > 0 && nt.toUserAccount === address && nt.fromUserAccount
          && isDirect && !isTrade && !isRelayerServiceLeg(nt.fromUserAccount, amt)) {
        fundingCandidates.push({ from: nt.fromUserAccount, amt, t });
      }
      if (amt < dustSolFloor) continue; // ignore dust / rent movements (funding already captured above)
      if (nt.fromUserAccount === address) {
        sawOut = true;
        if (isDirect && !isTrade && !isRelayerServiceLeg(nt.toUserAccount, amt)) {
          bump(nt.toUserAccount, t, "sol", "out", amt);
          if (nt.toUserAccount && amt >= 0.001) solStableOut.push({ to: nt.toUserAccount, amt, t, asset: "SOL" });
          // SOL leg recorded for cross-tx trade pairing (payment and token
          // delivery sometimes land in separate transactions)
          if (amt >= 0.01) recordSolFlow(nt.toUserAccount, { t, dir: "out", amt });
        }
      } else if (nt.toUserAccount === address) {
        sawIn = true;
        if (isDirect && !isTrade && !isRelayerServiceLeg(nt.fromUserAccount, amt)) {
          bump(nt.fromUserAccount, t, "sol", "in", amt);
          if (amt >= 0.01) recordSolFlow(nt.fromUserAccount, { t, dir: "in", amt });
        }
      }
    }
    if (sawIn && !isTrade) transfersIn++;
    if (sawOut && !isTrade) transfersOut++;
  }

  // Average hold time over closed positions (each matched lot counts once)
  const avgHoldSec = completedHolds.length
    ? completedHolds.reduce((a, b) => a + b, 0) / completedHolds.length
    : null;

  // Average age of still-open lots.
  // With the dust filter on, mints whose ONLY event in the window is a single
  // inbound transfer (typical airdrop spam) are excluded from the average.
  const openAges = [];
  let spamSkippedMints = 0;
  for (const [mint, q] of lots.entries()) {
    if (opts.dust) {
      const ms = mintStats.get(mint);
      if (ms && ms.swap === 0 && ms.disp === 0 && ms.tin === 1) { spamSkippedMints++; continue; }
    }
    for (const lot of q) if (lot.amt > 1e-12) openAges.push(nowSec - lot.t);
  }
  const avgOpenAgeSec = openAges.length ? openAges.reduce((a, b) => a + b, 0) / openAges.length : null;

  // ---- Trade pairing per counterparty ----
  // A counterparty that both delivers token X and receives token Y (or SOL)
  // within PAIR_WINDOW is being TRADED WITH, not transferred to — those flow
  // pairs are swap legs. Only unpaired flows become supply-move / split flags,
  // and a counterparty with repeated pairs is marked pool/market-maker-like.
  const PAIR_WINDOW = 180; // seconds
  for (const [cpAddr, c] of counterparties.entries()) {
    const evs = c.flowEvents || [];
    const sols = c.solFlows || [];
    const pairedEv = new Set(), pairedSol = new Set();
    let pairs = 0;
    for (let i = 0; i < evs.length; i++) {
      if (pairedEv.has(i)) continue;
      let done = false;
      for (let j = 0; j < evs.length && !done; j++) {
        if (j === i || pairedEv.has(j)) continue;
        if (evs[j].dir !== evs[i].dir && evs[j].mint !== evs[i].mint && Math.abs(evs[j].t - evs[i].t) <= PAIR_WINDOW) {
          pairedEv.add(i); pairedEv.add(j); pairs++; done = true;
        }
      }
      if (done) continue;
      for (let k = 0; k < sols.length; k++) {
        if (pairedSol.has(k)) continue;
        if (sols[k].dir !== evs[i].dir && Math.abs(sols[k].t - evs[i].t) <= PAIR_WINDOW) {
          pairedEv.add(i); pairedSol.add(k); pairs++; break;
        }
      }
    }
    c.pairedTrades = pairs;
    c.exchangeLike = pairs >= 2; // repeatedly on the other side of trades

    // Value at the moment of transfer: when the supply came from a tracked
    // buy, the buy's SOL cost prices it (amt × solIn/buyAmt) — a true
    // at-the-time estimate, not today's price.
    const estSolOf = (e) =>
      e.lb && e.lb.solIn > 0 && Math.abs(e.t - e.lb.t) <= LARGE_MOVE_BUY_WINDOW
        ? e.amt * (e.lb.solIn / e.lb.amt) : null;

    // Derive flags from UNPAIRED flows only.
    for (let i = 0; i < evs.length; i++) {
      if (pairedEv.has(i)) continue;
      const e = evs[i];
      c.tokenMoves.push({ mint: e.mint, amt: e.amt, dir: e.dir, t: e.t, estSol: estSolOf(e) });
      if (e.posBefore > 0 && e.amt / e.posBefore >= LARGE_MOVE_PCT && c.bigMoves.length < 10) {
        const move = { mint: e.mint, amt: e.amt, pct: Math.min(e.amt / e.posBefore, 1), dir: e.dir, t: e.t, estSol: estSolOf(e) };
        if (e.dir === "out" && e.lb && e.t - e.lb.t <= LARGE_MOVE_BUY_WINDOW && e.amt >= LARGE_MOVE_PCT * e.lb.amt) {
          move.afterBuy = { amt: e.lb.amt, hours: (e.t - e.lb.t) / 3600 };
        }
        c.bigMoves.push(move);
      }
      if (e.dir === "out") {
        const pctBuy = e.lb && e.t - e.lb.t <= LARGE_MOVE_BUY_WINDOW ? e.amt / e.lb.amt : 0;
        const pctPos = e.posBefore > 0 ? e.amt / e.posBefore : 0;
        const share = Math.min(pctBuy > 0 ? pctBuy : pctPos, 1);
        if (share >= 0.10) splitCandidates.push({ mint: e.mint, to: cpAddr, amt: e.amt, share, t: e.t, buyAmt: e.lb ? e.lb.amt : null });
      }
    }
    c.tokenMoves.sort((a, b) => b.amt - a.amt);
    if (c.tokenMoves.length > 12) c.tokenMoves.length = 12;

    // Condensed interaction log (for the per-wallet interactions panel):
    // every direct token/SOL flow, newest first, trade legs marked as such.
    const events = [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      events.push({ t: e.t, dir: e.dir, kind: "token", mint: e.mint, amt: e.amt, estSol: estSolOf(e), paired: pairedEv.has(i) });
    }
    for (let k = 0; k < sols.length; k++) {
      events.push({ t: sols[k].t, dir: sols[k].dir, kind: "sol", amt: sols[k].amt, paired: pairedSol.has(k) });
    }
    events.sort((a, b) => b.t - a.t);
    c.interactions = events.slice(0, 40);
  }

  // Supply splits: the same token distributed to >= 2 distinct recipients,
  // each chunk >= 10% of the triggering buy (or position), combined >= 25%.
  // This is the "buy 30M, send 10M to B, 5M to C, 5M to D" pattern.
  const byMint = new Map();
  for (const sc of splitCandidates) {
    if (!byMint.has(sc.mint)) byMint.set(sc.mint, new Map());
    const rec = byMint.get(sc.mint);
    const r = rec.get(sc.to) || { amt: 0, share: 0, buyAmt: sc.buyAmt };
    r.amt += sc.amt; r.share = Math.min(r.share + sc.share, 1);
    if (sc.buyAmt) r.buyAmt = sc.buyAmt;
    rec.set(sc.to, r);
  }
  const splitGroups = [];
  for (const [mint, rec] of byMint.entries()) {
    if (rec.size < 2) continue;
    const totalShare = Math.min([...rec.values()].reduce((s, r) => s + r.share, 0), 1);
    if (totalShare < 0.25) continue;
    splitGroups.push({ mint, recipients: rec.size, totalShare });
    for (const [addr, r] of rec.entries()) {
      const cp = counterparties.get(addr);
      if (cp) cp.splitInfo = { mint, amt: r.amt, share: r.share, others: rec.size - 1, totalShare, buyAmt: r.buyAmt };
    }
  }

  // Behavioral flags — factual patterns from the analyzed window, not verdicts.
  const flagsFor = (c) => {
    const flags = [];
    let botLike = false;
    if (c.in > 0 && c.out > 0) flags.push("two-way transfers");
    if (c.amounts.length >= 3) {
      const uniq = new Set(c.amounts.map(a => (a.sol ? "s" : "t") + a.v.toPrecision(4)));
      if (uniq.size === 1) { flags.push(`${c.amounts.length}× identical amount, one pattern`); botLike = true; }
      const solOutTiny = c.amounts.filter(a => a.sol && a.dir === "out" && a.v < 0.02);
      if (solOutTiny.length === c.amounts.length) { flags.push("tiny outbound SOL only (tip/fee-like)"); botLike = true; }
    }
    if ((c.bigMoves || []).length > 0) flags.push(`${c.bigMoves.length} large supply move(s)`);
    if ((c.pairedTrades || 0) >= 1) {
      flags.push(`${c.pairedTrades}× paired buy/sell exchange(s)${c.exchangeLike ? " — trades like a pool/market maker" : ""}`);
    }
    return { flags, botLike };
  };

  const allCps = [...counterparties.entries()]
    .map(([addr, c]) => {
      const { flags, botLike } = flagsFor(c);
      const distinctAmounts = new Set(c.amounts.map(a => (a.sol ? "s" : "t") + a.v.toPrecision(4))).size;
      return { addr, ...c, flags, botLike, distinctAmounts };
    })
    .sort((a, b) => b.count - a.count);
  // Top 40 by contact count, PLUS up to 15 wallets whose largest single token
  // movement is big — a one-off 10M-supply transfer must never fall off the list.
  const selected = new Map(allCps.slice(0, 40).map(x => [x.addr, x]));
  const movers = allCps
    .filter(x => (x.tokenMoves || []).length > 0)
    .sort((a, b) => Math.max(...b.tokenMoves.map(m => m.amt)) - Math.max(...a.tokenMoves.map(m => m.amt)));
  for (const x of movers.slice(0, 15)) if (!selected.has(x.addr)) selected.set(x.addr, x);
  const topCounterparties = [...selected.values()]
    .map(({ amounts, flowEvents, solFlows, ...rest }) => rest); // drop raw event streams before caching

  const oldest = txs.length ? txs[0].timestamp : null;
  return {
    buys, sells, swaps, transfersIn, transfersOut,
    buySellRatio: sells > 0 ? buys / sells : null,   // null = no sells (∞)
    sellEvents: sellEvents.slice().reverse(),        // newest first
    oldestSig: txs.length ? (txs[0].signature || null) : null,   // cursor for "load more sells"
    avgHoldSec, avgOpenAgeSec, spamSkippedMints,
    splitGroups,
    buyEvents,
    solStableOut: solStableOut.sort((a, b) => b.t - a.t).slice(0, 60),   // newest first, capped
    destAges: {},   // filled by bounded first-tx lookups after analysis
    largeSolInflows: fundingCandidates.filter(f => f.amt >= (opts.solThresh || 5)).map(f => f.t),
    fundingEvents: (() => {
      // earliest 3 + largest 3 inbound SOL fundings, aggregated per sender
      const bySender = new Map();
      for (const f of fundingCandidates) {
        const s = bySender.get(f.from) || { from: f.from, total: 0, count: 0, firstT: Infinity, maxAmt: 0 };
        s.total += f.amt; s.count++; s.maxAmt = Math.max(s.maxAmt, f.amt); s.firstT = Math.min(s.firstT, f.t);
        bySender.set(f.from, s);
      }
      const senders = [...bySender.values()];
      const earliest = [...senders].sort((a, b) => a.firstT - b.firstT).slice(0, 3);
      const largest = [...senders].sort((a, b) => b.total - a.total).slice(0, 3);
      const seen = new Set(), out = [];
      for (const s of [...earliest, ...largest]) if (!seen.has(s.from)) { seen.add(s.from); out.push(s); }
      return out.sort((a, b) => a.firstT - b.firstT);
    })(),
    closedCount: completedHolds.length,
    openCount: openAges.length,
    unmatchedDisposals,
    topCounterparties,
    txCount: txs.length,
    oldestTs: oldest,
  };
}

// Detect a single "sell" (token → SOL/stable) from one enhanced transaction.
// Returns {t, mint, amt, sol, quote} or null. Used by the "load more sells" panel
// on freshly-paged history without re-running the full analyzer.
function sellFromTx(tx, address) {
  const ev = tx.events?.swap;
  const spent = new Map(), recv = new Map();
  let solOut = 0, solIn = 0;
  if (ev) {
    if (ev.nativeInput?.account === address) solIn += Number(ev.nativeInput.amount || 0) / LAMPORTS;
    if (ev.nativeOutput?.account === address) solOut += Number(ev.nativeOutput.amount || 0) / LAMPORTS;
    for (const ti of ev.tokenInputs || []) if (ti.userAccount === address) spent.set(ti.mint, (spent.get(ti.mint) || 0) + Number(ti.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, ti.rawTokenAmount?.decimals ?? 0));
    for (const to of ev.tokenOutputs || []) if (to.userAccount === address) recv.set(to.mint, (recv.get(to.mint) || 0) + Number(to.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, to.rawTokenAmount?.decimals ?? 0));
  }
  if (solOut === 0 && solIn === 0 && spent.size === 0 && recv.size === 0) {
    for (const nt of tx.nativeTransfers || []) { const amt = Number(nt.amount || 0) / LAMPORTS; if (amt < 1e-6) continue; if (nt.fromUserAccount === address) solIn += amt; if (nt.toUserAccount === address) solOut += amt; }
    for (const tt of tx.tokenTransfers || []) { const amt = Number(tt.tokenAmount || 0); if (!amt) continue; if (tt.fromUserAccount === address) spent.set(tt.mint, (spent.get(tt.mint) || 0) + amt); if (tt.toUserAccount === address) recv.set(tt.mint, (recv.get(tt.mint) || 0) + amt); }
  }
  const spentNonQuote = [...spent.keys()].some(m => !QUOTE_MINTS.has(m));
  const recvNonQuote = [...recv.keys()].some(m => !QUOTE_MINTS.has(m));
  const recvQuote = solOut > 0 || [...recv.keys()].some(m => QUOTE_MINTS.has(m));
  if (spentNonQuote && recvQuote && !recvNonQuote) {
    const mint = [...spent.keys()].find(m => !QUOTE_MINTS.has(m));
    if (mint) return { t: tx.timestamp || 0, mint, amt: spent.get(mint), sol: solOut, quote: [...recv].filter(([m]) => QUOTE_MINTS.has(m)).reduce((a, [, v]) => a + v, 0) };
  }
  return null;
}

// ---------- side-wallet detection ----------
// A counterparty is listed as a possible side wallet when ALL of:
//   1. its on-chain account type is wallet (system-owned, non-executable)
//   2. >= SIDE_MIN_TRANSFERS direct transfers with the tracked wallet
//   3. it shows NO bot-like pattern (identical amounts / tip-fee pattern)
//   4. it matches >= 2 relationship signals:
//      two-way transfers · both SOL and tokens exchanged · varied amounts · activity spanning > 1 day
// Each matched signal is displayed, so you can see exactly why an address is listed.
const SIDE_MIN_TRANSFERS = 5;
const LARGE_MOVE_PCT = 0.20;               // >= 20% of tracked position in that token
const LARGE_MOVE_BUY_WINDOW = 72 * 3600;   // "after buy" annotation window (72h)

// Compact quantity formatter usable inside analytics (no UI deps)
function fmtQty(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n >= 1 ? n.toFixed(1) : n.toPrecision(2);
}

// Supply-focused wording, written from the SUSPECT's perspective.
// m.dir is relative to the tracked wallet: "out" = tracked wallet sent, so the
// suspect RECEIVED; "in" = the suspect SENT that supply to the tracked wallet.
// Display rule: ticker only (never mint prefixes) + USD value when known.
function describeMove(m) {
  const verb = m.dir === "out" ? "received" : "sent";
  const prep = m.dir === "out" ? "from this wallet" : "to this wallet";
  const name = m.symbol || m.mint.slice(0, 4) + "…"; // ticker; mint prefix only if no symbol exists anywhere
  const parts = [];
  if (m.supplyPct != null) parts.push(`${(m.supplyPct * 100).toFixed(2)}% of supply`);
  if (m.estSol != null) parts.push(`worth ≈${fmtQty(m.estSol)} SOL at transfer`);
  else if (m.usd != null) parts.push(`worth ≈$${fmtQty(m.usd)}${m.solEq != null ? ` / ${fmtQty(m.solEq)} SOL` : ""} at current price`);
  let s = `${verb} ${fmtQty(m.amt)} ${name}${parts.length ? ` (${parts.join(", ")})` : ""} ${prep}`;
  if (m.afterBuy) s += `, ${m.afterBuy.hours < 1 ? Math.round(m.afterBuy.hours * 60) + "min" : m.afterBuy.hours.toFixed(1) + "h"} after a ${fmtQty(m.afterBuy.amt)} buy`;
  return s;
}

// ---------- side-wallet evaluation ----------
// Certainty model (noisy-or): every matched factor carries a weight 0..1 and
// they combine as  evidence = 1 - Π(1 - w)  — independent-evidence style, so
// several weak factors cannot fake a HIGH score, while one strong factor plus
// support rises fast. Strong factors scale with magnitude (supply share, SOL
// size). Timing bias multiplies the evidence (post-buy ×1.15, post-inflow
// ×1.08) instead of adding flat points. Hard cap 97% — on-chain data alone
// never proves common ownership.
function evaluateWallet(c, opts = {}) {
  const solThresh = Number(opts.solThresh || 5);
  const usdThresh = Number(opts.usdThresh || 500);
  const buyEvents = opts.buyEvents || [];
  const inflowTs = opts.largeInflowTs || [];
  const priceMap = opts.priceMap || {};
  const solPrice = opts.solPrice || null;
  const minTokens = opts.minTokens ?? 2e6;
  const usdFloor = solPrice ? 2 * solPrice : null;
  const labels = opts.labels || {};
  const labelOf = (a) => labels[a] ? `[${labels[a]}]` : a.slice(0, 4) + "…" + a.slice(-4);

  // Merge position-based and supply-share moves (supply data wins on overlap).
  const key = (m) => `${m.mint}|${m.t}|${m.amt}`;
  const mm = new Map();
  for (const m of c.bigMoves || []) mm.set(key(m), m);
  for (const m of c.supplyMoves || []) mm.set(key(m), { ...(mm.get(key(m)) || {}), ...m });
  const usdOf = (m) => m.usd != null ? m.usd : (priceMap[m.mint] != null ? m.amt * priceMap[m.mint] : null);
  const allMoves = [...mm.values()].sort((a, b) => (b.supplyPct || 0) - (a.supplyPct || 0) || b.amt - a.amt);
  // Supply evidence: real supply share or >= minTokens raw tokens.
  const moves = allMoves.filter(m => m.supplyPct != null || m.amt >= minTokens)
    .map(m => {
      const usd = m.usd != null ? m.usd : usdOf(m);
      return { ...m, usd, solEq: m.solEq != null ? m.solEq : (usd != null && solPrice ? usd / solPrice : null) };
    });
  // Value evidence: smaller moves whose known value clears ~2 SOL.
  const valueMoves = allMoves.filter(m => !(m.supplyPct != null || m.amt >= minTokens))
    .map(m => ({ ...m, usd: usdOf(m) }))
    .filter(m => m.usd != null && usdFloor != null && m.usd >= usdFloor)
    .map(m => ({ ...m, solEq: solPrice ? m.usd / solPrice : null }))
    .sort((a, b) => b.usd - a.usd);
  const split = c.splitInfo || null;
  const chain = c.bundleChain || [];

  const factors = [];   // evidence: {w, label} · bias: {mult, label}
  const signals = [];
  // Saturating repetition curve: a SINGLE occurrence gives only a fraction of a
  // category's cap; the weight climbs toward the cap as the behaviour REPEATS.
  // sat(1)=~0.33, sat(2)=~0.55, sat(3)=~0.70, sat(5)=~0.86 at halfLife 2.5.
  const sat = (intensity, halfLife = 2.5) => 1 - Math.exp(-Math.max(0, intensity) / halfLife);
  const addEvidence = (w, label, text) => { if (w > 0) factors.push({ w, label }); if (text) signals.push(text); };

  // --- supply-sharing evidence (repetition + magnitude) ---
  const supplyN = c.supplyMoveCount != null ? c.supplyMoveCount : moves.filter(m => m.supplyPct != null).length;
  const supplyMag = moves.reduce((a, m) => a + (m.supplyPct != null ? Math.min(1.5, m.supplyPct * 12) : 0.4), 0);
  const supplyIntensity = supplyN + supplyMag;      // count AND how large each was
  if (moves.length) {
    const w = 0.60 * sat(supplyIntensity, 2.2);
    addEvidence(w, `supply-share move ×${Math.max(supplyN, moves.length)}`);
  }
  for (const m of moves.slice(0, 2)) signals.push("Supply — " + describeMove(m));
  if (split) {
    const w = 0.52 * sat(0.9 + (split.others || 0), 1.8);   // more co-recipients = stronger
    addEvidence(w, `split across ${(split.others || 0) + 1} wallets`,
      `Split — split of one buy: got ${fmtQty(split.amt)}${split.symbol ? " " + split.symbol : ""}${split.buyAmt ? ` of a ${fmtQty(split.buyAmt)} buy` : ""} alongside ${split.others} other wallet(s) — ${Math.round(split.totalShare * 100)}% distributed in total`);
  }
  if (chain.length) addEvidence(0.50 * sat(chain.length, 1.3), `forwarding chain ×${chain.length}`);
  for (const h of chain) signals.push(`Chain — forwarded onward: ${fmtQty(h.amt)} → ${labelOf(h.to)}`);

  // --- funding evidence (COUNT of qualifying transfers drives it, not one big one) ---
  let funding = false;
  const hvSolCount = (c.solAmts || []).filter(a => a >= solThresh).length || ((c.maxSol || 0) >= solThresh ? 1 : 0);
  if (hvSolCount > 0) {
    funding = true;
    const magBonus = Math.min(1.2, (c.maxSol || 0) / (solThresh * 6));
    addEvidence(0.50 * sat(hvSolCount + magBonus, 2.6), `high-value SOL ×${hvSolCount}`,
      `Funding — high-value SOL: ${hvSolCount}× ≥ ${fmtQty(solThresh)} SOL (max ${fmtQty(c.maxSol)}, total ${fmtQty(c.solVol)})`);
  }
  const hvQuoteCount = (c.quoteAmts || []).filter(a => a >= usdThresh).length || ((c.maxQuote || 0) >= usdThresh ? 1 : 0);
  if (hvQuoteCount > 0) {
    funding = true;
    addEvidence(0.48 * sat(hvQuoteCount, 2.6), `high-value stablecoin ×${hvQuoteCount}`,
      `Funding — high-value stablecoin: ${hvQuoteCount}× ≥ $${usdThresh} (max ${fmtQty(c.maxQuote)}, total ${fmtQty(c.quoteVol)})`);
  }
  const valuedTransfers = (c.tokenMoves || [])
    .map(m => ({ m, usd: priceMap[m.mint] != null ? m.amt * priceMap[m.mint] : null }))
    .filter(x => x.usd != null && x.usd >= usdThresh);
  if (valuedTransfers.length > 0) {
    funding = true;
    const maxV = valuedTransfers.reduce((a, x) => Math.max(a, x.usd), 0);
    addEvidence(0.48 * sat(valuedTransfers.length, 2.4), `high-value token transfers ×${valuedTransfers.length}`,
      `Funding — high-value token transfers: ${valuedTransfers.length}× worth ≥ $${usdThresh} each (max ≈$${fmtQty(maxV)})`);
  } else if (valueMoves.length > 0) {
    funding = true;
    addEvidence(0.30 * sat(valueMoves.length, 2.2), `high-value token move ×${valueMoves.length}`, "Funding — " + describeMove(valueMoves[0]));
  }

  // --- relationship evidence (weak, supporting only; also repetition-aware) ---
  const twoWayN = Math.min(c.in || 0, c.out || 0);
  if (c.in > 0 && c.out > 0) addEvidence(0.16 * sat(twoWayN, 3), `two-way ×${twoWayN}`, `two-way: ${c.in} in / ${c.out} out`);
  if (c.sol > 0 && c.token > 0) addEvidence(0.07, "SOL+tokens", `both SOL (${c.sol}×) and tokens (${c.token}×)`);
  if ((c.distinctAmounts || 0) >= 3) addEvidence(0.05, "varied amounts", `varied amounts (${c.distinctAmounts} distinct)`);
  const spanDays = c.firstTs && c.lastTs && isFinite(c.firstTs) ? (c.lastTs - c.firstTs) / 86400 : 0;
  if (spanDays > 1 && c.count >= 4) addEvidence(0.06 * sat(c.count / 3, 2.5), "recurring", `recurring: ${c.count} transfers over ${spanDays.toFixed(1)} days`);

  // --- timing bias (multiplier, smaller now that repetition carries the score) ---
  const biasTags = [];
  const outMoves = allMoves.filter((m) => m.dir === "out");
  const postBuy = outMoves.some((m) => m.afterBuy) ||
    outMoves.some((m) => buyEvents.some((b) => b.mint === m.mint && m.t > b.t && m.t - b.t <= 72 * 3600));
  if (postBuy) { factors.push({ mult: 1.12, label: "post-buy timing ×1.12" }); biasTags.push("moved right after a large buy"); }
  const postInflow = outMoves.some((m) => inflowTs.some((t0) => m.t > t0 && m.t - t0 <= 24 * 3600));
  if (postInflow) { factors.push({ mult: 1.06, label: "post-inflow timing ×1.06" }); biasTags.push("moved within 24h of a large inflow"); }

  // Fresh, UNFUNDED supply sender: this counterparty appeared out of nowhere —
  // the analyzed wallet never sent it anything — and its first recorded contact
  // is it SENDING tokens/supply. Classic burner-style distribution wallet.
  const supplyInMoves = (c.supplyMoves || []).filter(mm => mm.dir === "in");
  const tokenInMoves = (c.tokenMoves || []).filter(mm => mm.dir === "in");
  const firstInT = [...supplyInMoves, ...tokenInMoves].reduce((acc, mm) => Math.min(acc, mm.t || Infinity), Infinity);
  const freshSender = isFinite(firstInT) && (c.out || 0) === 0
    && c.firstTs != null && (firstInT - c.firstTs) <= 14 * 86400;
  if (freshSender) {
    addEvidence(supplyInMoves.length ? 0.30 : 0.22, "fresh unfunded sender",
      `fresh, unfunded wallet — first contact is it sending ${supplyInMoves.length ? "token supply" : "tokens"} (burner-style sender)`);
    signals.unshift(`⚠ Fresh unfunded wallet sent ${supplyInMoves.length ? "supply" : "tokens"} — no prior funding from this wallet, appeared and immediately sent`);
  }

  // "Ansem Derived Coin Supply Share": a very large share of a token's supply
  // (≥45%) moved between this wallet and a known Ansem wallet. These distributions
  // are a recognised source of supply-sharing FALSE POSITIVES, so the lead stays
  // visible but is clearly tagged and its certainty damped.
  const ansemSet = new Set(opts.ansem || []);
  const ansemShare = ansemSet.has(c.addr) && (c.supplyMoves || []).some(m => (m.supplyPct || 0) >= 0.45);
  if (ansemShare) {
    factors.push({ mult: 0.45, label: "Ansem-derived supply share ×0.45" });
    biasTags.push("≥45% of a token's supply moved with a known Ansem wallet — a pattern known to produce false positives");
    signals.unshift("⚠ Ansem Derived Coin Supply Share — ≥45% of supply moved with a known Ansem wallet (certainty damped)");
  }

  // User-feedback calibration: corrections you recorded on results of this
  // evidence family lower the whole family's weight — shown transparently as a
  // factor in the breakdown so the damping is never hidden.
  const calib = opts.calib || null;
  if (calib) {
    const fam = (moves.length > 0 || !!split) ? "supply" : (funding ? "funding" : null);
    const cm = fam ? calib[fam] : null;
    if (cm && cm < 0.999) {
      factors.push({ mult: cm, label: `feedback calibration ×${cm.toFixed(2)}` });
      biasTags.push(`${calib.counts[fam]} recorded correction(s) on ${fam}-type results lowered this family's weight`);
    }
  }

  const evidence = 1 - factors.filter(f => f.w).reduce((p, f) => p * (1 - f.w), 1);
  const biasMult = factors.filter(f => f.mult).reduce((p, f) => p * f.mult, 1);
  const certainty = Math.round(100 * Math.min(0.97, evidence * biasMult));
  const certBand = certainty >= 75 ? "HIGH" : certainty >= 45 ? "MED" : "LOW";

  // --- bundle score (also repetition-driven & saturating) ---
  const bundleHits = (c.bundle && c.bundle.evidence) ? c.bundle.evidence.length : 0;
  const bundleIntensity =
    (split ? 0.8 + 0.5 * (split.others || 0) : 0) +   // multi-recipient split
    (chain.length ? 0.7 * chain.length : 0) +         // chain hops
    (0.7 * bundleHits);                               // cross-wallet correlated behaviours
  const bundleScore = Math.round(100 * sat(bundleIntensity, 2.2));
  const bundleEvidence = [
    ...(split ? [`one buy split across ${split.others + 1} wallets`] : []),
    ...(chain.length ? [`forwarded a large chunk onward through ${chain.length} hop(s)`] : []),
    ...((c.bundle && c.bundle.evidence) || []),
  ];
  const bundleRisk = bundleScore >= 55;   // needs genuinely repeated structure, not one split

  // --- mutual token tickers (which tokens both wallets moved between them) ---
  const tickerSet = [];
  const seenSym = new Set();
  for (const m of (c.tokenMoves || [])) {
    const sym = m.symbol || (m.mint ? m.mint.slice(0, 4) + "…" : null);
    if (sym && !seenSym.has(sym)) { seenSym.add(sym); tickerSet.push(sym); }
  }
  const mutualTokens = tickerSet.slice(0, 8);

  // --- funding-source badge (if the suspect's own first funder is a known source) ---
  let fundedBy = null;
  const ff = c.bundle && c.bundle.firstFunder;
  if (ff) { const hit = labelFor(ff); if (hit) fundedBy = hit.label.replace(/ \((labeled|added)\)$/, ""); }

  // --- full addresses for copying ---
  const refs = [{ label: "suspect wallet", addr: c.addr }];
  for (const m of [...moves.slice(0, 3), ...valueMoves.slice(0, 2)]) refs.push({ label: `${m.symbol || "token"} mint (CA)`, addr: m.mint });
  if (split) refs.push({ label: `${split.symbol || "split token"} mint (CA)`, addr: split.mint });
  for (const h of chain) refs.push({ label: "chunk forwarded to", addr: h.to });
  for (const r of (c.bundle && c.bundle.refs) || []) refs.push(r);
  const seenRef = new Set();
  const uniqueRefs = refs.filter(r => r.addr && !seenRef.has(r.addr) && seenRef.add(r.addr));

  // A wallet is a SUSPECT only with real evidence (supply sharing or high-value
  // funding). Wallets that merely transferred a handful of times with weak
  // circumstantial signals are NOT promoted — they remain visible under "other
  // interactions" with their (damped) score, never inflating a suspect group.
  const supply = moves.length > 0 || !!split;
  const qualifies = supply || funding || freshSender;
  return {
    ...c, refs: uniqueRefs, signals, biasTags, factors, certainty, certBand,
    evidencePct: Math.round(100 * evidence), biasMult, funding, freshSender,
    bundleScore, bundleEvidence, bundleRisk, spanDays, qualifies, ansemShare,
    mutualTokens, fundedBy,
    group: supply ? "supply" : (funding ? "funding" : (freshSender ? "supply" : "other")),
    alsoFunding: supply && funding,
    headline: signals[0] || `${c.count} transfer(s) · ${c.in} in / ${c.out} out`,
  };
}

// Turn recorded user feedback into evidence-family calibration multipliers.
// Every explicit correction (⚑ flag incorrect, ✓ non-suspicious transfer,
// ⚡ connector mark) counts against the evidence family that produced that
// result, so ALL remaining results of the same family — and the constellation —
// recalibrate, not just the corrected one. Each correction damps the family
// ×0.93 (compounding), floored at ×0.55 so genuine evidence is never erased;
// undoing feedback in Settings restores the weight automatically.
function feedbackCalibration(feedback) {
  const counts = { supply: 0, funding: 0 };
  for (const f of feedback || []) {
    if (!(f.kind === "incorrect" || f.kind === "supply-ok" || f.kind === "connector")) continue;
    const g = f.group || (f.kind === "supply-ok" ? "supply" : null);
    if (g === "supply" || g === "funding") counts[g]++;
  }
  const damp = (n) => Math.max(0.55, Math.pow(0.93, n));
  return { supply: damp(counts.supply), funding: damp(counts.funding), counts };
}

function eligibleWallet(c, ignored) {
  return !ignored.has(c.addr) && c.cls?.kind === "wallet" && !c.botLike && !c.exchangeLike;
}

function findSideWallets(topCounterparties, opts = {}) {
  const ignored = new Set(opts.ignored || []);
  return topCounterparties
    .filter(c => eligibleWallet(c, ignored))
    .map(c => evaluateWallet(c, opts))
    .filter(s => s.qualifies)
    .sort((a, b) => b.certainty - a.certainty || b.bundleScore - a.bundleScore || b.count - a.count);
}

// Wallet interactions that did NOT qualify as suspects — shown too, so low-
// suspicion connections stay visible instead of silently disappearing.
function findOtherWallets(topCounterparties, opts = {}) {
  const ignored = new Set(opts.ignored || []);
  return topCounterparties
    .filter(c => eligibleWallet(c, ignored))
    .map(c => evaluateWallet(c, opts))
    .filter(s => !s.qualifies)
    .sort((a, b) => b.certainty - a.certainty || b.count - a.count);
}

// ---------- formatting ----------
function fmtNum(n, digits = 2) {
  if (n == null) return "–";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (n >= 1) return n.toFixed(digits);
  return n.toPrecision(3);
}
function fmtUsd(n) { return n == null ? "" : "$" + fmtNum(n); }
function fmtDuration(sec) {
  if (sec == null) return "–";
  if (sec < 3600) return Math.round(sec / 60) + "m";
  if (sec < 86400) return (sec / 3600).toFixed(1) + "h";
  return (sec / 86400).toFixed(1) + "d";
}
function shortAddr(a) { return a.length > 12 ? a.slice(0, 5) + "…" + a.slice(-5) : a; }
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleDateString() : "?"; }
// Human wallet-age wording (years / months / days) for the funding flags.
function fmtAge(sec) {
  if (sec == null) return "unknown age";
  const d = sec / 86400;
  if (d >= 365) return (d / 365).toFixed(1) + " yr";
  if (d >= 30) return Math.round(d / 30) + " mo";
  if (d >= 1) { const n = Math.round(d); return n + (n === 1 ? " day" : " days"); }
  return Math.max(1, Math.round(sec / 3600)) + "h";
}
function escHtml(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
let currentAddress = null;
let currentView = "list";     // "list" | "detail" | "settings" — for returning from settings
let settingsReturnView = "list";   // the view that was open before Settings

function show(view) {
  $("listPanel").classList.toggle("hidden", view !== "list");
  $("detailPanel").classList.toggle("hidden", view !== "detail");
  $("settingsPanel").classList.toggle("hidden", view !== "settings");
  $("navArrows").classList.toggle("hidden", view !== "detail");
  $("navHomeWrap").classList.toggle("hidden", view !== "detail");
  $("interPanel").classList.add("hidden");
  $("mapPanel").classList.add("hidden");
  $("sellsPanel").classList.add("hidden");
  currentView = view;
  // Land at the top of each view — otherwise switching from a long view to a
  // shorter one leaves the page scrolled to the bottom.
  window.scrollTo(0, 0);
}

// ---------- section navigation arrows ----------
function navSections() {
  return ["sectionStats", "fundingSection", "sideWalletSection", "sectionHoldings", "sellsSection", "counterpartiesSection", "programsSection"]
    .map($)
    .filter(el => el && !el.classList.contains("hidden") && el.offsetParent !== null);
}

function navJump(dir) {
  const sections = navSections();
  if (!sections.length) return;
  const stickyOffset = 96; // header + sticky address bar
  const pos = window.scrollY + stickyOffset + 2;
  const tops = sections.map(el => el.getBoundingClientRect().top + window.scrollY);
  let target;
  if (dir > 0) target = tops.find(t => t > pos + 4);
  else [...tops].reverse().some(t => { if (t < pos - 4) { target = t; return true; } return false; });
  if (target === undefined) target = dir > 0 ? tops[tops.length - 1] : 0;
  window.scrollTo({ top: Math.max(0, target - stickyOffset), behavior: "smooth" });
}

// ---------- multi-wallet selection & batch refresh ----------
let selectMode = false;
const selectedWallets = new Set();
let batchTargets = [];
let batchStop = false;

function updateSelCount() {
  const n = selectedWallets.size;
  $("selCount").textContent = selectMode ? `${n} selected` : "";
  $("refreshSelectedBtn").disabled = n === 0;
}
function confirmBatch(addresses) {
  batchTargets = (addresses || []).filter(Boolean);
  if (!batchTargets.length) return;
  const n = batchTargets.length;
  $("batchWarnDetail").textContent = `${n} wallet${n > 1 ? "s" : ""} selected. Each one is re-fetched and fully re-analyzed against the Helius API, one after another — deep histories and large selections add up fast.`;
  $("batchWarn").classList.remove("hidden");
}
async function runBatch() {
  $("batchWarn").classList.add("hidden");
  const d0 = await store.get();
  if (!d0.apiKey) { showError("addError", "No API key set. Open Settings and paste your free Helius API key."); return; }
  $("batchProgress").classList.remove("hidden");
  $("batchStopBtn").textContent = "Stop after current";
  batchStop = false;
  const total = batchTargets.length;
  let done = 0, failed = 0;
  for (const addr of batchTargets) {
    if (batchStop) break;
    $("batchProgressMsg").textContent = `Wallet ${done + 1} of ${total} · ${shortAddr(addr)}`;
    $("batchBarFill").style.width = `${Math.round((done / total) * 100)}%`;
    try {
      const d = await store.get();       // fresh each time so the cache accumulates
      await runAnalysis(addr, d, (m) => { $("batchSubMsg").textContent = m; });
    } catch (e) { failed++; $("batchSubMsg").textContent = "Error: " + (e && e.message ? e.message : String(e)); }
    done++;
  }
  $("batchBarFill").style.width = "100%";
  $("batchProgressMsg").textContent = batchStop
    ? `Stopped after ${done} of ${total}${failed ? ` · ${failed} failed` : ""}.`
    : `Done — ${done - failed} of ${total} refreshed${failed ? ` · ${failed} failed` : ""}.`;
  $("batchSubMsg").textContent = "";
  selectMode = false; selectedWallets.clear();
  $("selectModeBtn").textContent = "Select"; $("selectModeBtn").classList.remove("active");
  document.querySelector(".sel-all").classList.add("hidden");
  $("refreshSelectedBtn").classList.add("hidden");
  setTimeout(() => { $("batchProgress").classList.add("hidden"); renderWalletList(); }, 1500);
}

// ---- Investigation chain: pinned wallets shown on the list + highlighted on maps ----
async function addToChain(address, name) {
  if (!address) return;
  const d = await store.get();
  d.chain = d.chain || [];
  if (!d.chain.some(c => c.address === address)) {
    // The wallet being ANALYZED at add-time becomes the PARENT — children group
    // under it so each saved investigation reads as one unit.
    d.chain.push({ address, parent: currentAddress && currentAddress !== address ? currentAddress : null, name: name || "", note: "", added: Date.now() });
    await store.set({ chain: d.chain });
    if (lastSettings) lastSettings.chain = d.chain;
  }
  $("statusLine").textContent = "Added to investigation chain.";
  setTimeout(() => ($("statusLine").textContent = ""), 1800);
  renderChain();
}
function inChain(addr) { return (lastSettings?.chain || []).some(c => c.address === addr); }

async function renderChain() {
  const d = await store.get();
  const chain = d.chain || [];
  const sec = $("chainSection");
  if (!sec) return;
  sec.classList.toggle("hidden", chain.length === 0);
  const walletNames = Object.fromEntries((d.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const ul = $("chainList");
  ul.innerHTML = "";

  // Group children under the tracked wallet that was being analyzed when they
  // were added (their parent). Each group reads as one saved investigation.
  const groups = new Map();               // parentAddr ("" = unassigned) -> entries
  for (const c of chain) {
    const key = c.parent || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => (a === "") - (b === ""));  // unassigned last

  let gi = 0;
  for (const parentAddr of groupKeys) {
    const entries = groups.get(parentAddr);
    const gid = "cg" + (gi++);
    const head = document.createElement("li");
    head.className = "chain-group-head";
    const pname = parentAddr
      ? (walletNames[parentAddr] || (chain.find(x => x.address === parentAddr)?.name) || shortAddr(parentAddr))
      : "Unassigned";
    head.innerHTML = `<button class="chain-group-toggle" type="button"><span class="caret">▾</span> <span class="cg-name"></span> <span class="cg-count"></span></button>`
      + (parentAddr ? `<button class="icon-btn small cg-open" title="Analyze parent wallet">↗</button>` : "");
    head.querySelector(".cg-name").textContent = pname;
    head.querySelector(".cg-count").textContent = `· ${entries.length} linked`;
    if (parentAddr) {
      const sub = document.createElement("span");
      sub.className = "cg-sub mono"; sub.textContent = shortAddr(parentAddr); sub.title = parentAddr;
      head.querySelector(".chain-group-toggle").after(sub);
      head.querySelector(".cg-open").addEventListener("click", (e) => { e.stopPropagation(); openDetail(parentAddr); });
    }
    head.querySelector(".chain-group-toggle").addEventListener("click", () => {
      const open = head.querySelector(".caret").textContent === "▾";
      head.querySelector(".caret").textContent = open ? "▸" : "▾";
      ul.querySelectorAll(`li[data-cg="${gid}"]`).forEach(r => r.classList.toggle("hidden", open));
    });
    ul.appendChild(head);
    for (const c of entries) renderChainRow(c, d, ul, gid);
  }
}

function renderChainRow(c, d, ul, gid) {
  {
    // Condensed interaction detail from the current cached analysis, if present.
    let detail = c.note || "";
    const cache = d.cache || {};
    let seenCount = 0, inN = 0, outN = 0;
    for (const addr of Object.keys(cache)) {
      const cp = (cache[addr]?.data?.stats?.topCounterparties || []).find(x => x.addr === c.address);
      if (cp) { seenCount++; inN += cp.in || 0; outN += cp.out || 0; }
    }
    const seenTxt = seenCount ? `seen in ${seenCount} analysis${seenCount > 1 ? "es" : ""} · ${inN} in / ${outN} out` : "not yet seen in an analysis";
    const li = document.createElement("li");
    li.className = "chain-row";
    li.dataset.cg = gid;
    li.innerHTML = `<div class="row-main">
        <span class="row-title"></span>
        <span class="row-sub mono"></span>
        <span class="chain-detail"></span>
      </div>
      <div class="row-right">
        <button class="icon-btn small chain-open" title="Analyze this wallet">↗</button>
        <button class="icon-btn small chain-rename" title="Name / note">✎</button>
        <button class="remove-btn chain-remove" title="Remove from chain">✕</button>
      </div>`;
    li.querySelector(".row-title").textContent = c.name ? c.name : shortAddr(c.address);
    const sub = li.querySelector(".row-sub"); sub.textContent = shortAddr(c.address); sub.title = c.address;
    li.querySelector(".chain-detail").textContent = `${seenTxt}${c.note ? ` · “${c.note}”` : ""}`;
    li.querySelector(".chain-open").addEventListener("click", (e) => { e.stopPropagation(); openDetail(c.address); });
    li.querySelector(".chain-remove").addEventListener("click", async (e) => {
      e.stopPropagation();
      const dd = await store.get();
      dd.chain = (dd.chain || []).filter(x => x.address !== c.address);
      await store.set({ chain: dd.chain });
      if (lastSettings) lastSettings.chain = dd.chain;
      renderChain();
    });
    li.querySelector(".chain-rename").addEventListener("click", (e) => {
      e.stopPropagation();
      if (li.querySelector(".chain-edit")) return;
      const box = document.createElement("div");
      box.className = "chain-edit";
      box.innerHTML = `<input class="chain-name-in" placeholder="Name" value="${escHtml(c.name || "")}">`
        + `<input class="chain-note-in" placeholder="Note (optional)" value="${escHtml(c.note || "")}">`
        + `<button class="ghost-btn small chain-save">Save</button>`;
      box.addEventListener("click", ev => ev.stopPropagation());
      li.querySelector(".row-main").appendChild(box);
      const save = async () => {
        const dd = await store.get();
        const t = (dd.chain || []).find(x => x.address === c.address);
        if (t) { t.name = box.querySelector(".chain-name-in").value.trim(); t.note = box.querySelector(".chain-note-in").value.trim(); await store.set({ chain: dd.chain }); if (lastSettings) lastSettings.chain = dd.chain; }
        renderChain();
      };
      box.querySelector(".chain-save").addEventListener("click", save);
      box.querySelector(".chain-name-in").focus();
    });
    ul.appendChild(li);
  }
}

async function renderWalletList() {
  renderChain();
  const { wallets, chain } = await store.get();
  const ul = $("walletList");
  ul.innerHTML = "";
  // "Saved wallets" separator only matters when the chain card sits above the list.
  $("savedHeader").classList.toggle("hidden", !(wallets.length && (chain || []).length));
  $("emptyMsg").classList.toggle("hidden", wallets.length > 0);
  $("listToolbar").classList.toggle("hidden", wallets.length === 0);
  for (const a of [...selectedWallets]) if (!wallets.some(w => w.address === a)) selectedWallets.delete(a);
  for (const w of wallets) {
    const li = document.createElement("li");
    if (selectMode) {
      const chk = document.createElement("input");
      chk.type = "checkbox"; chk.className = "wallet-chk";
      chk.checked = selectedWallets.has(w.address);
      chk.addEventListener("click", (e) => e.stopPropagation());
      chk.addEventListener("change", () => { chk.checked ? selectedWallets.add(w.address) : selectedWallets.delete(w.address); updateSelCount(); });
      li.appendChild(chk);
      li.classList.add("selectable");
    }
    const left = document.createElement("div");
    left.className = "wallet-left";
    const nameHtml = w.name
      ? `<div class="wallet-name"></div><div class="wallet-addr wallet-sub"></div>`
      : `<div class="wallet-addr"></div>`;
    left.innerHTML = `${nameHtml}<div class="wallet-sub added"></div>`;
    if (w.name) {
      left.querySelector(".wallet-name").textContent = w.name;
      left.querySelector(".wallet-addr").textContent = shortAddr(w.address);
    } else {
      left.querySelector(".wallet-addr").textContent = shortAddr(w.address);
    }
    left.querySelector(".added").textContent = "added " + new Date(w.added).toLocaleDateString();

    const rename = document.createElement("button");
    rename.className = "icon-btn small"; rename.textContent = "✎"; rename.title = "Name this wallet";
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      if (li.querySelector(".rename-input")) return;
      const input = document.createElement("input");
      input.className = "rename-input";
      input.value = w.name || "";
      input.placeholder = "Wallet name";
      left.prepend(input);
      input.focus();
      const save = async () => {
        const d = await store.get();
        const target = d.wallets.find(x => x.address === w.address);
        if (target) { target.name = input.value.trim(); await store.set({ wallets: d.wallets }); }
        renderWalletList();
      };
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") save(); if (ev.key === "Escape") renderWalletList(); });
      input.addEventListener("blur", save);
      input.addEventListener("click", (ev) => ev.stopPropagation());
    });

    const rm = document.createElement("button");
    rm.className = "remove-btn"; rm.textContent = "✕"; rm.title = "Remove";
    rm.addEventListener("click", async (e) => {
      e.stopPropagation();
      const d = await store.get();
      d.wallets = d.wallets.filter(x => x.address !== w.address);
      delete d.cache[w.address];
      await store.set({ wallets: d.wallets, cache: d.cache });
      renderWalletList();
    });

    const cp = document.createElement("button");
    cp.className = "icon-btn small"; cp.textContent = "⧉"; cp.title = "Copy address";
    cp.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(w.address);
      cp.textContent = "✓"; setTimeout(() => (cp.textContent = "⧉"), 1200);
    });

    const right = document.createElement("div");
    right.className = "wallet-actions";
    right.append(cp, rename, rm);
    li.append(left, right);
    li.addEventListener("click", () => {
      if (selectMode) {
        const chk = li.querySelector(".wallet-chk");
        if (chk) { chk.checked = !chk.checked; chk.dispatchEvent(new Event("change")); }
      } else openDetail(w.address);
    });
    ul.appendChild(li);
  }
  updateSelCount();
}

// Every analysis opens COMPACTED: all collapsible detail sections start closed so
// the user sees the stats + outcome summary first and expands what's relevant.
function collapseAllSections() {
  // Only the DETAIL panel's sections — the chain section lives on the list screen.
  document.querySelectorAll("#detailPanel .h3-toggle[data-target]").forEach(btn => {
    const target = $(btn.dataset.target);
    if (!target) return;
    target.classList.add("hidden");
    const caret = btn.querySelector(".caret");
    if (caret) caret.textContent = "▸";
  });
}

async function openDetail(address, force = false) {
  currentAddress = address;
  show("detail");
  collapseAllSections();   // every analysis opens compacted — expand what's relevant
  const { wallets } = await store.get();
  const named = wallets.find(w => w.address === address);
  $("detailAddr").textContent = named?.name ? `[${named.name}] · ${shortAddr(address)}` : address;
  $("detailAddr").title = address;
  $("detailError").classList.add("hidden");
  $("detailContent").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loadingMsg").textContent = "Fetching…";

  const d = await store.get();
  if (!d.apiKey) {
    $("loading").classList.add("hidden");
    showError("detailError", "No API key set. Open Settings and paste your free Helius API key.");
    return;
  }

  // Cached results persist indefinitely — labelling, navigating, and reopening
  // never re-hit the API. A fresh analysis runs ONLY when Refresh is pressed
  // (force) or a per-analysis filter changed (which clears the cache).
  const cached = d.cache[address];
  if (!force && cached && cached.v === CACHE_VERSION) {
    renderDetail(cached.data, d);
    return;
  }

  try {
    const data = await runAnalysis(address, d, (m) => { $("loadingMsg").textContent = m; });
    renderDetail(data, d);
  } catch (err) {
    $("loading").classList.add("hidden");
    showError("detailError", err.message || String(err));
  }
}

// Runs the full fetch → analyze → classify → bundle pipeline for one wallet,
// caches the result, and returns it. Progress strings go to `progress`, so the
// same pipeline powers both the detail view and headless multi-wallet refresh.
async function runAnalysis(address, d, progress = () => {}) {
    const holdingsP = fetchHoldings(address, d.apiKey);
    const txsP = fetchTransactions(address, d.apiKey, d.txDepth, (n) => {
      progress(`Fetched ${n} / up to ${d.txDepth} transactions…`);
    });
    const [holdings, txs] = await Promise.all([holdingsP, txsP]);
    const stats = analyze(txs, address, { dust: d.dust, solThresh: d.solThresh });
    stats.walletEdges = [];   // peer edges (counterparty ↔ counterparty) for the constellation
    // Supply-share flags: one getAssetBatch call for every token that moved
    // directly between this wallet and a counterparty.
    progress("Checking token supplies…");
    const allMints = new Set();
    for (const c of stats.topCounterparties) for (const m of c.tokenMoves || []) allMints.add(m.mint);
    const supplies = await fetchTokenSupplies([...allMints], d.apiKey);
    // Price context, three sources so moved tokens are valued even when the
    // wallet no longer holds them: holdings prices → getAssetBatch prices →
    // Jupiter public price API for anything still unpriced.
    const priceMap = {};
    for (const tk of holdings.tokens) if (tk.pricePerToken != null) priceMap[tk.mint] = tk.pricePerToken;
    for (const [mint, s] of Object.entries(supplies)) if (s.price != null && priceMap[mint] == null) priceMap[mint] = s.price;
    const unpriced = [...allMints].filter(m => priceMap[m] == null).slice(0, 50);
    if (unpriced.length) {
      try {
        const jr = await fetch(`https://lite-api.jup.ag/price/v3?ids=${unpriced.join(",")}`);
        if (jr.ok) {
          const jj = await jr.json();
          const table = jj?.data || jj || {};
          for (const [mint, v] of Object.entries(table)) {
            const p = v?.usdPrice ?? v?.price;
            if (p != null && priceMap[mint] == null) priceMap[mint] = Number(p);
          }
        }
      } catch { /* price data is additive */ }
    }
    const solPrice = holdings.sol.pricePerToken ?? null;
    stats.priceMap = priceMap;
    stats.solPrice = solPrice;
    applySupplyFlags(stats.topCounterparties, supplies, (d.supplyPct ?? 0.5) / 100, { priceMap, solPrice });

    // Ticker resolution: every move/split shows a symbol, never a mint prefix,
    // wherever one exists (supply metadata first, then held-token metadata).
    const symbolMap = {};
    for (const [mint, s] of Object.entries(supplies)) if (s.symbol) symbolMap[mint] = s.symbol;
    for (const tk of holdings.tokens) if (tk.symbol && tk.symbol !== "?" && !symbolMap[tk.mint]) symbolMap[tk.mint] = tk.symbol;
    stats.symbolMap = symbolMap;
    for (const c of stats.topCounterparties) {
      for (const m of c.bigMoves || []) if (!m.symbol && symbolMap[m.mint]) m.symbol = symbolMap[m.mint];
      for (const m of c.tokenMoves || []) if (!m.symbol && symbolMap[m.mint]) m.symbol = symbolMap[m.mint];
      for (const m of c.interactions || []) if (m.mint && !m.symbol && symbolMap[m.mint]) m.symbol = symbolMap[m.mint];
      if (c.splitInfo && !c.splitInfo.symbol && symbolMap[c.splitInfo.mint]) c.splitInfo.symbol = symbolMap[c.splitInfo.mint];
    }

    // Actual wallet age: exact if the analyzed window reaches the first tx,
    // otherwise one tiny lookup for the earliest transaction.
    if (txs.length < d.txDepth && stats.oldestTs) {
      stats.walletAgeSec = Math.floor(Date.now() / 1000) - stats.oldestTs;
      stats.walletAgeExact = true;
    } else {
      try {
        const res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${d.apiKey}&limit=1&sort-order=asc`);
        const first = res.ok ? await res.json() : [];
        if (Array.isArray(first) && first[0]?.timestamp) {
          stats.walletAgeSec = Math.floor(Date.now() / 1000) - first[0].timestamp;
          stats.walletAgeExact = true;
        }
      } catch { /* fall back below */ }
      if (stats.walletAgeSec == null && stats.oldestTs) {
        stats.walletAgeSec = Math.floor(Date.now() / 1000) - stats.oldestTs;
        stats.walletAgeExact = false; // lower bound: window didn't reach the first tx
      }
    }

    // Large-inflow timestamps for the timing-bias score: big SOL in + big supply in.
    stats.largeInflowTs = [
      ...(stats.largeSolInflows || []),
      ...stats.topCounterparties.flatMap(c => (c.supplyMoves || []).filter(m => m.dir === "in").map(m => m.t)),
    ];

    progress("Classifying counterparties…");
    const fundingAddrs = (stats.fundingEvents || []).map(f => f.from);
    const clsAddrs = [...new Set([...stats.topCounterparties.map(c => c.addr), ...fundingAddrs])];
    const cls = await classifyCounterparties(clsAddrs, d.apiKey);
    for (const c of stats.topCounterparties) {
      c.cls = cls[c.addr] || { kind: "unknown", label: "Unclassified" };
      // A counterparty that IS a token mint address is the token contract itself.
      if (allMints.has(c.addr)) c.cls = { kind: "agent", label: "Token mint (contract)", source: "mint match" };
    }
    for (const f of stats.fundingEvents || []) f.cls = cls[f.from] || { kind: "unknown", label: "Unclassified" };

    // FLAG: an established (very old) wallet that seeded this brand-new wallet.
    // A long-lived wallet funding a fresh one is a strong dev/insider seed or
    // linked-main signal. Only checked when the tracked wallet is confirmed
    // brand new (exact age ≤ 30d) and only for personal-wallet funders —
    // exchange/custodial funding is normal — so it costs one tiny first-tx
    // lookup per such funder and nothing for established wallets.
    stats.oldFunderFlags = [];
    const OLD_FUNDER_SEC = 180 * 86400;   // "very old" funder ≥ 6 months
    const NEW_WALLET_SEC = 30 * 86400;    // "brand new" recipient ≤ 30 days
    // The flag used to be skipped whenever the analyzed window didn't reach the
    // wallet's first tx (walletAgeExact false) — very active fresh wallets fell
    // through. Now ONE tiny first-tx lookup settles the wallet's true age.
    if (stats.walletAgeExact !== true && (stats.walletAgeSec == null || stats.walletAgeSec <= NEW_WALLET_SEC * 3)) {
      try {
        const r = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${d.apiKey}&limit=1&sort-order=asc`);
        const first = r.ok ? await r.json() : [];
        if (Array.isArray(first) && first[0]?.timestamp) {
          stats.walletAgeSec = Math.floor(Date.now() / 1000) - first[0].timestamp;
          stats.walletAgeExact = true;
        }
      } catch { /* additive — the estimate stands */ }
      await new Promise(res => setTimeout(res, 130));
    }
    if (stats.walletAgeExact === true && stats.walletAgeSec != null && stats.walletAgeSec <= NEW_WALLET_SEC) {
      const personalFunders = (stats.fundingEvents || [])
        // RULE: being in the funding database does NOT exempt a wallet from the
        // old→new check — labeled funders are age-checked too (their label still
        // shows, so custodial noise stays easy to judge). Unclassified senders
        // count too: a funder whose classification failed is still a funder —
        // only clear exchange/program/bot infrastructure is skipped as normal.
        .filter(f => f.cls?.kind === "wallet" || f.cls?.kind === "unknown" || !f.cls || labelFor(f.from))
        .sort((a, b) => a.firstT - b.firstT)                          // earliest (the seeder) first
        .slice(0, 5);
      for (const f of personalFunders) {
        try {
          const r = await fetch(`https://api.helius.xyz/v0/addresses/${f.from}/transactions?api-key=${d.apiKey}&limit=1&sort-order=asc`);
          const first = r.ok ? await r.json() : [];
          if (Array.isArray(first) && first[0]?.timestamp) {
            f.funderAgeSec = Math.floor(Date.now() / 1000) - first[0].timestamp;
            f.funderAgeExact = true;
          }
        } catch { /* funder age is additive — skip on error */ }
        await new Promise(res => setTimeout(res, 150));
        if (f.funderAgeSec != null && f.funderAgeSec >= OLD_FUNDER_SEC) {
          const extreme = f.funderAgeSec >= 365 * 86400 && stats.walletAgeSec <= 7 * 86400;
          f.oldFundsNew = true;
          stats.oldFunderFlags.push({
            from: f.from, funderAgeSec: f.funderAgeSec, recipientAgeSec: stats.walletAgeSec,
            gapSec: f.funderAgeSec - stats.walletAgeSec, tier: extreme ? "extreme" : "high",
            total: f.total, count: f.count, firstT: f.firstT,
          });
        }
      }
      stats.oldFunderFlags.sort((a, b) => b.funderAgeSec - a.funderAgeSec);
    }

    // Age the recent SOL/stable-out destinations (bounded, ~6 distinct) so the
    // "recent transfers out" panel can split them into fresh vs aged wallets.
    // Reuses any age already known from funders; costs one tiny lookup each.
    stats.destAges = {};
    for (const f of stats.fundingEvents || []) if (f.funderAgeSec != null) stats.destAges[f.from] = f.funderAgeSec;
    const distinctDests = [];
    for (const o of stats.solStableOut || []) {
      if (!distinctDests.includes(o.to) && stats.destAges[o.to] == null && !labelFor(o.to)) distinctDests.push(o.to);
      if (distinctDests.length >= 6) break;
    }
    for (const dest of distinctDests) {
      try {
        const r = await fetch(`https://api.helius.xyz/v0/addresses/${dest}/transactions?api-key=${d.apiKey}&limit=1&sort-order=asc`);
        const first = r.ok ? await r.json() : [];
        if (Array.isArray(first) && first[0]?.timestamp) stats.destAges[dest] = Math.floor(Date.now() / 1000) - first[0].timestamp;
      } catch { /* additive — skip on error */ }
      await new Promise(res => setTimeout(res, 130));
    }

    // FLAG: serial funder — does this wallet's funder have a HABIT of seeding
    // wallets? Measured directly from each top funder's own recent activity:
    // distinct recipients of SOL sends (threshold near-zero — habitual seeders
    // often prime wallets with small amounts). Bounded: top 3 funders, one
    // 100-tx page each, plus first-tx age checks on up to 3 sampled recipients
    // to confirm the "funds NEW wallets" half of the pattern. Runs for wallets
    // of any age — a funder's habit matters even when THIS wallet isn't fresh.
    const topFunders = [...(stats.fundingEvents || [])]
      .filter(f => !(f.cls?.kind === "exchange") && !labelFor(f.from))   // custodial hot wallets fund everyone — not a signal
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 3);
    for (const f of topFunders) {
      try {
        if (f.funderAgeSec == null) {                       // age not fetched yet (wallet wasn't ≤30d) — one tiny lookup
          const r0 = await fetch(`https://api.helius.xyz/v0/addresses/${f.from}/transactions?api-key=${d.apiKey}&limit=1&sort-order=asc`);
          const first = r0.ok ? await r0.json() : [];
          if (Array.isArray(first) && first[0]?.timestamp) { f.funderAgeSec = Math.floor(Date.now() / 1000) - first[0].timestamp; f.funderAgeExact = true; }
          await new Promise(res => setTimeout(res, 130));
        }
        const r = await fetch(`https://api.helius.xyz/v0/addresses/${f.from}/transactions?api-key=${d.apiKey}&limit=100`);
        const txs = r.ok ? await r.json() : [];
        const dests = new Set();
        for (const tx of Array.isArray(txs) ? txs : []) {
          for (const nt of tx.nativeTransfers || []) {
            const amt = Number(nt.amount || 0) / LAMPORTS;
            if (nt.fromUserAccount === f.from && nt.toUserAccount && nt.toUserAccount !== f.from && amt >= 0.001) dests.add(nt.toUserAccount);
          }
        }
        f.serialFanout = dests.size;
        f.serialFunder = (f.funderAgeSec != null && f.funderAgeSec >= 180 * 86400) && dests.size >= 3;
        if (f.serialFunder) {
          // Are the recipients NEW wallets? Sample up to 3 (excluding this one).
          let freshN = 0, sampled = 0;
          for (const dest of dests) {
            if (sampled >= 3) break;
            if (dest === address) continue;
            try {
              const r1 = await fetch(`https://api.helius.xyz/v0/addresses/${dest}/transactions?api-key=${d.apiKey}&limit=1&sort-order=asc`);
              const df = r1.ok ? await r1.json() : [];
              if (Array.isArray(df) && df[0]?.timestamp) {
                sampled++;
                if (Math.floor(Date.now() / 1000) - df[0].timestamp <= 30 * 86400) freshN++;
              }
            } catch { /* skip */ }
            await new Promise(res => setTimeout(res, 130));
          }
          f.serialFreshN = freshN; f.serialSampled = sampled;
        }
      } catch { /* additive — skip on error */ }
      await new Promise(res => setTimeout(res, 130));
    }

    // Trace large outbound supply chunks onward (bundle chains), max 4 recipients.
    const traceTargets = stats.topCounterparties
      .filter(c => c.cls.kind === "wallet" &&
        ((c.bigMoves || []).some(m => m.dir === "out") || (c.supplyMoves || []).some(m => m.dir === "out")))
      .slice(0, 4);
    if (traceTargets.length > 0) {
      progress("Tracing token forwarding (bundle check)…");
      const visited = new Set([address, ...stats.topCounterparties.map(c => c.addr)]);
      for (const c of traceTargets) {
        const m = [...(c.bigMoves || []), ...(c.supplyMoves || [])]
          .filter(x => x.dir === "out").sort((a, b) => b.amt - a.amt)[0];
        try {
          c.bundleChain = await traceForward(d.apiKey, c.addr, m.mint, m.amt, m.t, new Set([address, c.addr]));
        } catch { c.bundleChain = []; }
      }
    }

    // Cross-wallet bundle heuristics: profile the top suspects from their own
    // history (age, first funder, funding time, fees, buys) and correlate.
    const labelsMap = Object.fromEntries((d.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
    const sideOpts = { solThresh: d.solThresh, usdThresh: d.usdThresh, buyEvents: stats.buyEvents, largeInflowTs: stats.largeInflowTs, ignored: suspectExclusions(d, address), ansem: d.ansemWallets, calib: feedbackCalibration(d.feedback), priceMap, solPrice, labels: labelsMap };
    const prelim = findSideWallets(stats.topCounterparties, sideOpts);
    const bundleCandidates = prelim.filter(s => s.group === "supply" || s.certainty >= 40).slice(0, 8);
    if (bundleCandidates.length >= 2) {
      progress("Cross-checking bundle heuristics (funding, age, fees, timed buys)…");
      const profiles = [];
      for (const cand of bundleCandidates) {
        try {
          let res = await fetch(`https://api.helius.xyz/v0/addresses/${cand.addr}/transactions?api-key=${d.apiKey}&limit=100&sort-order=asc`);
          if (!res.ok) res = await fetch(`https://api.helius.xyz/v0/addresses/${cand.addr}/transactions?api-key=${d.apiKey}&limit=100`);
          const ptxs = res.ok ? await res.json() : [];
          if (Array.isArray(ptxs) && ptxs.length) profiles.push(extractProfile(cand.addr, ptxs));
        } catch { /* skip this wallet's profile */ }
        await new Promise(r => setTimeout(r, 250));
      }
      if (profiles.length >= 2) {
        const corr = correlateBundles(profiles, labelsMap);
        for (const c of stats.topCounterparties) if (corr[c.addr]) c.bundle = corr[c.addr];
      }
      // Constellation peer edges: from each profiled wallet's own history, record
      // direct transfers to OTHER counterparties in this analysis (not the tracked
      // wallet). These become dashed inter-wallet lines on the map.
      const cpSet = new Set(stats.topCounterparties.map(c => c.addr));
      const edgeMap = new Map();   // "lo|hi" -> { ab, ba }  (ab = lo→hi count, ba = hi→lo count)
      for (const p of profiles) {
        for (const [other, io] of Object.entries(p.interactedWith || {})) {
          if (other === address || other === p.addr || !cpSet.has(other)) continue;
          const out = (io && io.out) || 0, inn = (io && io.in) || 0;
          const lo = p.addr < other ? p.addr : other, hi = p.addr < other ? other : p.addr;
          const e = edgeMap.get(lo + "|" + hi) || { ab: 0, ba: 0 };
          if (p.addr === lo) { e.ab += out; e.ba += inn; } else { e.ab += inn; e.ba += out; }
          edgeMap.set(lo + "|" + hi, e);
        }
      }
      stats.walletEdges = [...edgeMap.entries()].map(([k, e]) => { const [a, b] = k.split("|"); return { a, b, ab: e.ab, ba: e.ba, w: Math.max(e.ab, e.ba, 1) }; });
      // Attach each profiled wallet's first funder (for the funding-source badge),
      // even when correlation didn't fire.
      const funderByAddr = Object.fromEntries(profiles.map(p => [p.addr, p.firstFunder]).filter(x => x[1]));
      for (const c of stats.topCounterparties) {
        if (funderByAddr[c.addr]) c.bundle = { ...(c.bundle || { score: 0, evidence: [], refs: [] }), firstFunder: funderByAddr[c.addr] };
      }
    }

    // Persist group labels: wallets repeatedly seen as suspects build a history
    // (side-wallet / funding-wallet / bundle-prone) shown wherever they appear.
    const finalSuspects = findSideWallets(stats.topCounterparties, sideOpts);
    const tags = d.walletTags || {};
    for (const s of finalSuspects) {
      const e = tags[s.addr] || { tags: [], seen: 0 };
      const want = [s.group === "supply" ? "side-wallet" : "funding-wallet", ...(s.bundleRisk ? ["bundle-prone"] : [])];
      for (const t of want) if (!e.tags.includes(t)) e.tags.push(t);
      e.seen++; e.last = Date.now();
      tags[s.addr] = e;
    }
    d.walletTags = tags;

    const data = { holdings, stats, fetchedAt: Date.now() };
    d.cache[address] = { ts: Date.now(), v: CACHE_VERSION, data };
    await store.set({ cache: d.cache, walletTags: tags });
    return data;
}

let lastStats = null;
let lastSettings = null;
let lastData = null;
let resultSort = "relevance"; // relevance | new | old

// Comparator for the user's sort choice; returns 0 (keep prior order) for relevance.
function resultCmp(a, b) {
  if (resultSort === "new") return (b.lastTs || 0) - (a.lastTs || 0);
  if (resultSort === "old") return (a.lastTs || 0) - (b.lastTs || 0);
  return 0;
}
function applySort(arr) { return resultSort === "relevance" ? arr : [...arr].sort(resultCmp); }

function renderDetail(data, settings = {}) {
  lastData = data;
  const { holdings, stats } = data;
  lastStats = stats;
  lastSettings = settings;
  $("loading").classList.add("hidden");
  $("detailContent").classList.remove("hidden");

  $("statBuys").textContent = stats.buys;
  $("statSells").textContent = stats.sells;
  const bsr = stats.buySellRatio;
  $("statBuySell").textContent = (stats.buys === 0 && stats.sells === 0) ? "–"
    : bsr == null ? (stats.buys ? "∞" : "0")            // sells == 0
    : bsr >= 10 ? bsr.toFixed(0) : bsr.toFixed(2);
  $("statSwaps").textContent = stats.swaps;
  $("statHold").textContent = fmtDuration(stats.avgHoldSec);
  $("statHoldOpen").textContent = fmtDuration(stats.avgOpenAgeSec);
  $("statWalletAge").textContent = stats.walletAgeSec != null
    ? fmtDuration(stats.walletAgeSec) + (stats.walletAgeExact === false ? "+" : "")
    : "–";
  $("statTxs").textContent = stats.txCount;

  // Freshness line: cached results are reused indefinitely until Refresh.
  if (data.fetchedAt) {
    const ageMin = Math.round((Date.now() - data.fetchedAt) / 60000);
    const when = ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`;
    $("cacheNote").textContent = `Cached analysis · fetched ${when} · press Refresh for live data`;
    $("cacheNote").classList.remove("hidden");
  } else {
    $("cacheNote").classList.add("hidden");
  }

  const noteParts = [];
  noteParts.push(`Based on the last ${stats.txCount} transactions` + (stats.oldestTs ? ` (back to ${fmtDate(stats.oldestTs)})` : "") + ".");
  noteParts.push(`Transfers: ${stats.transfersIn} in / ${stats.transfersOut} out.`);
  if (stats.avgHoldSec != null) noteParts.push(`Hold time from ${stats.closedCount} closed position lot(s); ${stats.openCount} still open.`);
  if (stats.unmatchedDisposals > 0) noteParts.push(`${stats.unmatchedDisposals} disposal(s) of tokens acquired before this window were excluded from hold time.`);
  if (stats.spamSkippedMints > 0) noteParts.push(`${stats.spamSkippedMints} single-airdrop token(s) excluded from open-position age (dust filter).`);
  $("analysisNote").textContent = noteParts.join(" ");

  // Holdings
  const ul = $("holdingsList");
  ul.innerHTML = "";
  let total = 0;
  const addRow = (title, sub, val, valSub) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="row-main"><span class="row-title"></span><span class="row-sub"></span></div>
      <div class="row-right"><div class="row-val"></div><div class="row-val-sub"></div></div>`;
    li.querySelector(".row-title").textContent = title;
    li.querySelector(".row-sub").textContent = sub;
    li.querySelector(".row-val").textContent = val;
    li.querySelector(".row-val-sub").textContent = valSub;
    ul.appendChild(li);
  };
  if (holdings.sol.amount > 0 || holdings.sol.usd != null) {
    addRow("SOL", "Solana", fmtNum(holdings.sol.amount, 4), fmtUsd(holdings.sol.usd));
    total += holdings.sol.usd || 0;
  }
  const dustOn = !!settings.dust;
  const dustUsd = Number(settings.dustUsd || 1);
  let dustHidden = 0;
  const visible = holdings.tokens.filter(tk => {
    if (dustOn && tk.usd != null && tk.usd < dustUsd) { dustHidden++; return false; }
    return true;
  });
  for (const tk of visible.slice(0, 60)) {
    addRow(tk.symbol, tk.name === tk.symbol ? shortAddr(tk.mint) : tk.name, fmtNum(tk.amount), fmtUsd(tk.usd));
    total += tk.usd || 0;
  }
  if (visible.length > 60) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="hint">+ ${visible.length - 60} more tokens</span>`;
    ul.appendChild(li);
  }
  if (dustHidden > 0) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="hint">${dustHidden} dust holding(s) hidden (&lt; $${dustUsd})</span>`;
    ul.appendChild(li);
  }
  if (ul.children.length === 0) {
    ul.innerHTML = `<li><span class="hint">No holdings found.</span></li>`;
  }
  $("totalValue").textContent = total > 0 ? "≈ " + fmtUsd(total) : "";

  renderOldFunderAlert(stats, settings);
  renderSoftFlags(stats);
  renderSolOut(stats, settings);
  renderSells(stats);
  renderFunding(stats, settings);
  renderSideWallets(stats, settings);
  renderCounterparties(stats, settings);
  // Self-assessment uses the same suspect set the side-wallet section shows.
  const _sus = findSideWallets(stats.topCounterparties || [], {
    solThresh: settings.solThresh, usdThresh: settings.usdThresh,
    buyEvents: stats.buyEvents, largeInflowTs: stats.largeInflowTs,
    ignored: suspectExclusions(settings, currentAddress), ansem: settings.ansemWallets, calib: feedbackCalibration(settings.feedback),
    priceMap: stats.priceMap, solPrice: stats.solPrice,
    labels: Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name])),
  });
  renderOutcome(stats, settings, _sus);
}

// ---------- investigation self-assessment ----------
// A transparent audit of how much the analysis itself can be trusted for this
// wallet — based on data coverage, not on how "guilty" the wallet looks. This
// is meta-confidence: strong data + clear separation = high; gaps = lower.
// Aggregate confidence that the analysed wallet is part of a side-wallet
// operation, built ONLY from the flagged interactions (the qualifying leads).
//
// This is deliberately NOT a sum of the individual percentages. Each flagged
// wallet's own certainty is one piece of evidence, combined with a noisy-OR
// (probabilistic OR): the figure rises with the NUMBER and STRENGTH of flags but
// can never exceed 100%. To stop many look-alike flags from stacking unfairly,
// flags of the SAME evidence type are discounted geometrically (the 2nd of a
// kind counts half, the 3rd a quarter…), while DIFFERENT evidence types
// (supply-sharing vs high-value funding vs bundle structure) corroborate each
// other at full strength. Capped at 97% — this is inference, not proof.
function assessFlaggedConfidence(suspects) {
  const flags = (suspects || []).filter(s => s && (s.certainty || 0) > 0);
  if (!flags.length) {
    return { confidence: 0, band: "NONE", nFlags: 0, nTypes: 0, top: 0,
      basis: "No interactions cleared the evidence bar in this window — there is nothing to combine, so no side-wallet confidence can be asserted." };
  }
  const typeName = { supply: "supply-sharing", funding: "high-value funding", bundle: "bundle structure", other: "circumstantial" };
  const byType = {};
  for (const s of flags) {
    const t = s.bundleRisk ? "bundle" : (s.group || "other");
    (byType[t] = byType[t] || []).push(Math.min(0.97, (s.certainty || 0) / 100));
  }
  const DECAY = 0.5;
  let across = 1;                        // ∏ (1 − typeConfidence) across evidence types
  for (const t of Object.keys(byType)) {
    const ps = byType[t].sort((a, b) => b - a);
    let within = 1;                      // decayed noisy-OR WITHIN one evidence type
    ps.forEach((p, k) => { within *= (1 - p * Math.pow(DECAY, k)); });
    across *= within;                    // full-strength noisy-OR ACROSS types
  }
  const P = Math.min(0.97, 1 - across);
  const confidence = Math.round(P * 100);
  const band = confidence >= 70 ? "HIGH" : confidence >= 45 ? "MED" : confidence >= 20 ? "LOW" : "MINIMAL";
  const top = Math.max(...flags.map(s => s.certainty || 0));
  const types = Object.keys(byType).map(t => typeName[t] || t);
  const basis =
    `Combined from ${flags.length} flagged interaction${flags.length > 1 ? "s" : ""} across `
    + `${types.length} evidence type${types.length > 1 ? "s" : ""} (${types.join(", ")}). `
    + `Strongest single flag ${top}%. Extra flags raise the figure with diminishing returns (repeats of the same kind count less) — it is not a sum of the percentages.`;
  return { confidence, band, nFlags: flags.length, nTypes: types.length, top, basis };
}

function assessInvestigation(stats, settings, suspects) {
  const depth = settings.txDepth || 300;
  const pos = [], caution = [];
  let score = 50;

  // 1. History depth coverage
  const hitCap = (stats.txCount || 0) >= depth;
  if (!hitCap) { score += 18; pos.push(`Full available history analyzed — ${stats.txCount} txs, below the ${depth} cap, so nothing older was missed.`); }
  else if (depth >= 2000) { score += 3; caution.push(`Hit the ${depth}-tx cap on a very active wallet — activity older than the window isn't included.`); }
  else { score -= 12; caution.push(`Reached the ${depth}-tx cap: only recent history was seen. Raise “Transactions analyzed” for a fuller picture.`); }

  // 2. Wallet-age coverage
  if (stats.walletAgeExact) { score += 6; pos.push(`Wallet age is exact — history reaches the wallet's first transaction.`); }
  else if (stats.walletAgeSec != null) { caution.push(`Wallet age is a lower bound — the window didn't reach the first transaction, so “% of position” for older tokens may be understated.`); }

  // 3. Counterparty classification coverage
  const cps = stats.topCounterparties || [];
  const classified = cps.filter(c => c.cls && c.cls.kind && c.cls.kind !== "unknown").length;
  const clsFrac = cps.length ? classified / cps.length : 1;
  if (cps.length && clsFrac >= 0.9) { score += 9; pos.push(`${Math.round(clsFrac * 100)}% of counterparties classified from on-chain account data.`); }
  else if (cps.length && clsFrac < 0.6) { score -= 8; caution.push(`Only ${Math.round(clsFrac * 100)}% of counterparties could be classified (RPC gaps) — some wallet/agent labels are uncertain.`); }

  // 4. Price coverage for moved tokens (value-based signals depend on this)
  const movedMints = new Set();
  for (const c of cps) for (const m of (c.tokenMoves || [])) movedMints.add(m.mint);
  const priced = [...movedMints].filter(m => stats.priceMap && stats.priceMap[m] != null).length;
  const priceFrac = movedMints.size ? priced / movedMints.size : 1;
  if (movedMints.size && priceFrac >= 0.8) { score += 8; pos.push(`Value data available for ${Math.round(priceFrac * 100)}% of moved tokens.`); }
  else if (movedMints.size && priceFrac < 0.5) { score -= 6; caution.push(`Only ${Math.round(priceFrac * 100)}% of moved tokens had a price — some SOL/USD value estimates are missing.`); }
  if (!stats.solPrice) caution.push(`SOL price was unavailable — value floors used a fallback.`);

  // 5. Bundle heuristics availability
  if (cps.some(c => c.bundle)) { score += 6; pos.push(`Cross-wallet bundle heuristics ran (shared funding, wallet age, gas fees, timed buys).`); }

  // 6. Findings separation / strength
  const highs = suspects.filter(s => s.certBand === "HIGH").length;
  const meds = suspects.filter(s => s.certBand === "MED").length;
  const withBundle = suspects.filter(s => s.bundleRisk).length;
  if (highs > 0) { score += 7; pos.push(`${highs} high-certainty lead(s)${withBundle ? `, ${withBundle} with bundle evidence` : ""} — clear signal, not borderline.`); }
  else if (suspects.length > 0 && meds === suspects.length) { score -= 5; caution.push(`All ${suspects.length} lead(s) are mid-certainty — treat as tentative and verify before acting.`); }
  if (suspects.length === 0) {
    if (!hitCap && (cps.length > 0)) { score += 4; pos.push(`No wallet cleared the evidence bar across a fully-covered history — reasonably confident there are no side wallets in this window.`); }
    else caution.push(`No leads found, but coverage is partial — absence here isn't proof of none.`);
  }

  // "Data draw accuracy from chain" — a single number: how complete/reliable the
  // underlying on-chain data was (the wallet-pull quality, condensed).
  const dataAccuracy = Math.max(10, Math.min(99, Math.round(score)));
  const dataNote = hitCap
    ? `Only the most recent ${depth} transactions were read — raise “Transactions analyzed” for fuller coverage.`
    : `Full available history was read (${stats.txCount} txs).`;

  // Per-result short confidence lines, focused on the side-wallet findings.
  const labelsMap = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const perResult = suspects.slice(0, 8).map(s => {
    const top = (s.factors || []).filter(f => f.w).sort((a, b) => b.w - a.w).slice(0, 3).map(f => f.label);
    return {
      addr: s.addr,
      name: labelsMap[s.addr] ? `[${labelsMap[s.addr]}]` : shortAddr(s.addr),
      certainty: s.certainty, band: s.certBand, bundleRisk: s.bundleRisk, bundleScore: s.bundleScore,
      ansemShare: !!s.ansemShare,
      why: top.join(" · ") || "weak circumstantial signals",
      fundedBy: s.fundedBy || null,
    };
  });

  let summary;
  if (!suspects.length) summary = hitCap
    ? "No side-wallet leads surfaced, but coverage is partial — absence here isn't proof of none. Raise the transaction depth to be sure."
    : "No side-wallet leads surfaced across a fully-read history — reasonably confident there are none in this window.";
  else {
    const highs = suspects.filter(s => s.certBand === "HIGH").length;
    if (highs) summary = `${highs} strong lead${highs > 1 ? "s" : ""} with repeated, high-value patterns — worth close attention. Everything below remains on-chain inference, not proof of ownership.`;
    else summary = "Leads are tentative — the patterns aren't repeated or large enough to be confident. Treat as starting points and verify.";
  }
  if ((stats.oldFunderFlags || []).length) {
    summary = "⚠ An old, established wallet funded this brand-new wallet (flagged at the top) — a strong dev/insider or linked-main signal. " + summary;
  }
  return { dataAccuracy, dataNote, perResult, summary };
}

function renderOutcome(stats, settings, suspects) {
  const a = assessInvestigation(stats, settings, suspects || []);
  const conf = assessFlaggedConfidence(suspects || []);
  const acc = $("dataAccuracy");
  acc.textContent = conf.nFlags ? conf.confidence + "%" : "—";
  acc.className = "oa-val " + (conf.band === "HIGH" ? "ob-strong" : conf.band === "MED" ? "ob-mod" : "ob-lim");
  acc.title = conf.basis + "  ·  Data coverage: " + a.dataNote;
  $("outcomeSummary").textContent = a.summary;
  const ul = $("outcomeResults");
  ul.innerHTML = "";
  if (!a.perResult.length) { ul.classList.add("hidden"); return; }
  ul.classList.remove("hidden");
  for (const r of a.perResult) {
    const li = document.createElement("li");
    const bandCls = r.band === "HIGH" ? "ob-strong" : r.band === "MED" ? "ob-mod" : "ob-lim";
    li.innerHTML = `
      <div class="or-head">
        <span class="or-name mono"></span>
        <span class="or-pills">
          ${r.fundedBy ? `<span class="or-fund">⬦ ${r.fundedBy}</span>` : ""}
          ${r.ansemShare ? `<span class="or-ansem" title="Ansem Derived Coin Supply Share — recognised false-positive pattern, certainty damped">ANSEM ⚠</span>` : ""}
          ${r.bundleRisk ? `<span class="or-bundle">BUNDLE ${r.bundleScore}%</span>` : ""}
          <span class="or-cert ${bandCls}">${r.certainty}%</span>
        </span>
      </div>
      <div class="or-why"></div>`;
    li.querySelector(".or-name").textContent = r.name;
    li.querySelector(".or-why").textContent = r.why;
    ul.appendChild(li);
  }
}

// Prominent banner: a very old wallet seeded this brand-new wallet.
// Aged wallets with a repeated habit of funding OTHER wallets (out-edges to ≥2
// tracked counterparties). Distinct from the old→new flag, which is about the
// ANALYZED wallet being freshly seeded.
function serialOutDegree(stats) {
  const outDeg = {};
  for (const e of (stats.walletEdges || [])) {
    if ((e.ab || 0) > 0) outDeg[e.a] = (outDeg[e.a] || 0) + 1;
    if ((e.ba || 0) > 0) outDeg[e.b] = (outDeg[e.b] || 0) + 1;
  }
  return outDeg;
}
const SERIAL_AGE_SEC = 180 * 86400;

// SOFT flag (informational, never scored): a fresh wallet that received token
// transfers/supply — ANY amount, no threshold — with its trading activity shown.
// Low or zero buy/sell strengthens the pattern but is not required.
function renderSoftFlags(stats) {
  const el = $("softFlag");
  if (!el) return;
  const fresh = stats.walletAgeSec != null && stats.walletAgeSec <= 30 * 86400;
  const receivedTokens = (stats.topCounterparties || []).some(c =>
    (c.supplyMoves || []).some(m => m.dir === "in") || (c.tokenMoves || []).some(m => m.dir === "in"));
  if (!(fresh && receivedTokens)) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const b = stats.buys || 0, s = stats.sells || 0;
  el.innerHTML = `<span class="sf-ico">◦</span> <b>Soft flag</b> — fresh wallet (${fmtAge(stats.walletAgeSec)}) received token transfers`
    + ` · trading: ${b} buy${b === 1 ? "" : "s"} / ${s} sell${s === 1 ? "" : "s"}${(b + s) === 0 ? " (none)" : ""}`
    + ` · no supply threshold applied — informational only.`;
  el.classList.remove("hidden");
}

function renderOldFunderAlert(stats, settings = {}) {
  const el = $("oldFunderAlert");
  if (!el) return;
  const flags = stats.oldFunderFlags || [];
  const labels = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const outDeg = serialOutDegree(stats);
  // Directly-measured fan-out (recent distinct SOL recipients) from analysis —
  // the reliable serial signal; walletEdges outDeg stays as a fallback.
  const serialByAddr = Object.fromEntries((stats.fundingEvents || []).filter(f => f.serialFunder).map(f => [f.from, f.serialFanout || 0]));
  const recAge = fmtAge(stats.walletAgeSec);

  // Supply senders into a FRESH wallet — grouped with old→new because the logic
  // is the same family: who seeded this brand-new wallet, with SOL or with supply.
  // Computed at render time from cached data (no re-analysis needed).
  let supplyRows = [];
  if (stats.walletAgeSec != null && stats.walletAgeSec <= 30 * 86400) {
    const ageByFunder = Object.fromEntries((stats.fundingEvents || []).filter(f => f.funderAgeSec != null).map(f => [f.from, f.funderAgeSec]));
    const sus = findSideWallets(stats.topCounterparties || [], {
      solThresh: settings.solThresh, usdThresh: settings.usdThresh,
      buyEvents: stats.buyEvents, largeInflowTs: stats.largeInflowTs,
      ignored: suspectExclusions(settings, currentAddress), ansem: settings.ansemWallets,
      calib: feedbackCalibration(settings.feedback),
      priceMap: stats.priceMap, solPrice: stats.solPrice, labels,
    });
    for (const s of sus) {
      const sentIn = (s.supplyMoves || []).some(m => m.dir === "in") || (s.tokenMoves || []).some(m => m.dir === "in");
      if (!sentIn) continue;
      const age = ageByFunder[s.addr];
      const db = labelFor(s.addr);
      if (s.freshSender) supplyRows.push({ addr: s.addr, kind: "fresh" });
      else if (age != null && age >= SERIAL_AGE_SEC) supplyRows.push({ addr: s.addr, kind: "aged", age, serial: serialByAddr[s.addr] != null || (outDeg[s.addr] || 0) >= 2 });
      else if (db) supplyRows.push({ addr: s.addr, kind: "db", label: db.label });
    }
  }

  // Serial funders get their own prominent section — visible for wallets of ANY
  // age (the habit belongs to the FUNDER), styled like the old→new flag. Funders
  // already listed in the old→new rows aren't repeated (they carry the tag inline).
  const serialRows = (stats.fundingEvents || []).filter(f => f.serialFunder && !flags.some(x => x.from === f.from));

  if (!flags.length && !supplyRows.length && !serialRows.length) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const extreme = flags.some(f => f.tier === "extreme");
  const rows = flags.map(f => {
    const db = labelFor(f.from);
    const nm = labels[f.from] ? `[${escHtml(labels[f.from])}]` : (db ? escHtml(db.label.replace(/ \((labeled|added)\)$/, "")) + " · " + shortAddr(f.from) : shortAddr(f.from));
    const serial = serialByAddr[f.from] != null || ((outDeg[f.from] || 0) >= 2 && f.funderAgeSec >= SERIAL_AGE_SEC);
    const serialTxt = serialByAddr[f.from] != null ? `⟳ serial funder · ${serialByAddr[f.from]} recent recipients` : "⟳ serial funder";
    return `<li><span class="ofa-funder mono">${nm}</span> — <b>${fmtAge(f.funderAgeSec)}</b> old, sent ${fmtQty(f.total)} SOL `
      + `<span class="ofa-gap">· ${fmtAge(f.gapSec)} older than this wallet</span>`
      + (serial ? ` <span class="serial-tag">${serialTxt}</span>` : "") + `</li>`;
  }).join("");
  const supRows = supplyRows.map(r => {
    const nm = labels[r.addr] ? `[${escHtml(labels[r.addr])}]` : shortAddr(r.addr);
    const what = r.kind === "fresh"
      ? `fresh, <b>unfunded</b> sender — appeared and immediately sent`
      : r.kind === "aged"
        ? `<b>${fmtAge(r.age)}</b> old — aged wallet sent supply${r.serial ? ` <span class="serial-tag">⟳ serial funder</span>` : ""}`
        : `funding-database wallet (${escHtml((r.label || "labeled").replace(/ \((labeled|added)\)$/, ""))}) sent token supply — unusual for a custodian`;
    return `<li><span class="ofa-funder mono">${nm}</span> — ${what}</li>`;
  }).join("");
  el.className = "old-funder-alert" + (extreme ? " extreme" : "");
  el.innerHTML =
    (flags.length
      ? `<div class="ofa-head"><span class="ofa-ico">⚠</span> Old wallet → brand-new wallet</div>`
        + `<div class="ofa-body">This wallet is only <b>${recAge}</b> old but was seeded by `
        + `${flags.length > 1 ? "established wallets" : "an established wallet"}. An old wallet funding a fresh one is a `
        + `strong sign of a dev/insider seed or a linked main — verify the funder${flags.length > 1 ? "s" : ""}:</div>`
        + `<ul class="ofa-list">${rows}</ul>`
      : "")
    + (supplyRows.length
      ? `<div class="ofa-head${flags.length ? " ofa-sub" : ""}"><span class="ofa-ico">⚠</span> Token supply sent to this fresh wallet</div>`
        + `<div class="ofa-body">This wallet is only <b>${recAge}</b> old and received token supply directly — the same seeding logic as old→new, done with tokens instead of SOL:</div>`
        + `<ul class="ofa-list">${supRows}</ul>`
      : "")
    + (serialRows.length
      ? `<div class="ofa-head${flags.length || supplyRows.length ? " ofa-sub" : ""}"><span class="ofa-ico">⟳</span> Old → new funding habit — serial funder</div>`
        + `<div class="ofa-body">${serialRows.length > 1 ? "Funders" : "A funder"} of this wallet <b>repeatedly seed${serialRows.length > 1 ? "" : "s"} other wallets</b> — an aged wallet spraying SOL across many recipients is a classic farm/dev pattern:</div>`
        + `<ul class="ofa-list">${serialRows.map(f => {
            const nm = labels[f.from] ? `[${escHtml(labels[f.from])}]` : shortAddr(f.from);
            const freshBit = f.serialSampled ? ` · <b>${f.serialFreshN}/${f.serialSampled}</b> sampled recipient${f.serialSampled > 1 ? "s are" : " is"} brand-new` : "";
            return `<li><span class="ofa-funder mono">${nm}</span> — <b>${fmtAge(f.funderAgeSec)}</b> old, sent SOL to <b>${f.serialFanout}</b> wallets recently${freshBit}</li>`;
          }).join("")}</ul>`
      : "");
  el.classList.remove("hidden");
}

function renderFunding(stats, settings = {}) {
  const labels = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const fundOutDeg = serialOutDegree(stats);
  const events = stats.fundingEvents || [];
  const section = $("fundingSection");
  section.classList.toggle("hidden", events.length === 0);
  const ul = $("fundingList");
  ul.innerHTML = "";
  for (const f of applySort(events.map(e => ({ ...e, lastTs: e.firstT })))) {
    const li = document.createElement("li");
    // Prefer the live funding-DB / user label over the (possibly older) cached cls.
    const dbHit = labelFor(f.from);
    const kind = dbHit ? "exchange" : (f.cls?.kind || "unknown");
    const label = dbHit ? dbHit.label : (f.cls?.label || "Unclassified");
    li.innerHTML = `<div class="row-main">
        <span class="row-title"></span>
        <span class="row-sub mono"></span></div>
      <div class="row-right"><div class="row-val"></div><div class="row-val-sub"></div>
        <button class="copy-btn" title="Copy address">⧉</button></div>`;
    const nm = labels[f.from];
    li.querySelector(".row-title").textContent = nm ? `[${nm}]` : (kind === "exchange" ? label : (kind === "wallet" ? "Unlabeled wallet" : label));
    if (f.oldFundsNew) li.classList.add("old-funder-row");
    li.querySelector(".row-sub").textContent = shortAddr(f.from);
    li.querySelector(".row-sub").title = f.from;
    // Funder wallet age + old→new flag on the LEFT column, which shrinks/wraps
    // safely in the narrow side panel (the right column never shrinks).
    if (f.funderAgeSec != null) {
      const age = document.createElement("span");
      age.className = "fund-age" + (f.oldFundsNew ? " flagged" : "");
      age.textContent = (f.oldFundsNew ? "⚠ old → new · " : "") + `wallet ${fmtAge(f.funderAgeSec)} old`;
      if (f.oldFundsNew) age.title = "A very old wallet funded this brand-new wallet";
      li.querySelector(".row-main").appendChild(age);
    }
    // Serial funder: aged wallet with a measured HABIT of funding wallets.
    // Primary signal: f.serialFunder — set at analysis time by sampling the
    // funder's own recent activity (distinct SOL recipients ≥0.05). Fallback:
    // the old tracked-counterparty out-degree heuristic. Distinct from the
    // old→new flag, which is about THIS analyzed wallet being freshly seeded.
    const legacySerial = f.funderAgeSec != null && f.funderAgeSec >= SERIAL_AGE_SEC && (fundOutDeg[f.from] || 0) >= 2;
    if (f.serialFunder || legacySerial) {
      const st = document.createElement("span");
      st.className = "serial-tag";
      st.textContent = f.serialFunder
        ? `⟳ serial funder · sent SOL to ${f.serialFanout} wallets recently` + (f.serialFreshN ? ` · ${f.serialFreshN} fresh` : "")
        : `⟳ serial funder · feeds ${fundOutDeg[f.from]} tracked wallets`;
      st.title = "Aged wallet with a repeated habit of funding wallets — measured from its own recent sends (or out-transfers to 2+ tracked counterparties). Different from ⚠ old → new, which flags THIS analyzed wallet being freshly seeded.";
      li.querySelector(".row-main").appendChild(st);
    }
    li.querySelector(".row-val").textContent = `${fmtQty(f.total)} SOL`;
    li.querySelector(".row-val-sub").textContent = `${f.count}× · first ${fmtDate(f.firstT)}`;
    li.querySelector(".copy-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(f.from);
      $("statusLine").textContent = "Address copied.";
      setTimeout(() => ($("statusLine").textContent = ""), 1500);
    });
    ul.appendChild(li);
  }
}

// Addresses excluded from SUSPECT detection for a given tracked wallet:
//   • scoped ignores — flagged "not a side wallet" for THIS wallet only
//   • connectors — global relayer/connector wallets (Phantom etc.), de-highlighted everywhere
function suspectExclusions(s, addr) {
  const scoped = (s && s.ignoredScoped && s.ignoredScoped[addr]) || [];
  const conn = (s && s.connectors) || [];
  return [...scoped, ...conn];
}
function addScopedIgnoreObj(d, addr) {
  d.ignoredScoped = d.ignoredScoped || {};
  const set = new Set(d.ignoredScoped[currentAddress] || []);
  set.add(addr);
  d.ignoredScoped[currentAddress] = [...set];
}
async function addScopedIgnore(addr) {
  const d = await store.get();
  addScopedIgnoreObj(d, addr);
  await store.set({ ignoredScoped: d.ignoredScoped });
  if (lastSettings) lastSettings.ignoredScoped = d.ignoredScoped;
  return d;
}

function renderSideWallets(stats, settings = {}) {
  const labels = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const walletTags = settings.walletTags || {};
  const evalOpts = {
    solThresh: settings.solThresh, usdThresh: settings.usdThresh,
    buyEvents: stats.buyEvents, largeInflowTs: stats.largeInflowTs,
    ignored: suspectExclusions(settings, currentAddress), ansem: settings.ansemWallets, calib: feedbackCalibration(settings.feedback),
    priceMap: stats.priceMap, solPrice: stats.solPrice,
    labels,
  };
  const suspects = findSideWallets(stats.topCounterparties || [], evalOpts);
  const section = $("sideWalletSection");
  section.classList.toggle("hidden", suspects.length === 0);
  $("sideWalletTitle").textContent =
    `Possible side wallets — ${labels[currentAddress] ? `[${labels[currentAddress]}]` : shortAddr(currentAddress || "")} (${suspects.length})`;
  const ul = $("sideWalletList");
  ul.innerHTML = "";

  // Group headers are COLLAPSIBLE. Each header owns a numeric group id; every row
  // added after it is tagged data-grp="<id>", and the header toggles rows BY that
  // attribute — robust against sibling-traversal quirks.
  let grpSeq = 0, curGrp = -1;
  const addGroupHeader = (text) => {
    const gi = ++grpSeq; curGrp = gi;
    const li = document.createElement("li");
    li.className = "group-header collapsible";
    li.dataset.grpHead = String(gi);
    li.innerHTML = `<span class="caret">▾</span> `;
    li.appendChild(document.createTextNode(text));
    li.title = "Click to collapse / expand this group";
    li.addEventListener("click", () => {
      const collapsed = li.classList.toggle("grp-collapsed");
      li.querySelector(".caret").textContent = collapsed ? "▸" : "▾";
      ul.querySelectorAll(`[data-grp="${gi}"]`).forEach(el => el.classList.toggle("hidden", collapsed));
    });
    ul.appendChild(li);
  };
  const addSuspect = (s) => {
    const li = document.createElement("li");
    li.className = "suspect" + (s.bundleRisk ? " bundle" : "");
    if (curGrp >= 0) li.dataset.grp = String(curGrp);
    li.innerHTML = `
      <div class="suspect-head">
        <span class="row-title mono"></span>
        <span class="pill fund-pill hidden"></span>
        <span class="pill ansem-pill hidden"></span>
        <span class="pill cert-pill"></span>
        <span class="pill bundle-pill hidden"></span>
        <button class="inter-ico" title="View all interactions with this wallet">⌕</button>
        <span class="expander">▸</span>
      </div>
      <div class="row-sub headline"></div>
      <div class="mutual-tokens hidden"></div>
      <div class="suspect-details hidden">
        <ul class="evidence-list"></ul>
        <div class="bias-line hidden"></div>
        <div class="bundle-block hidden"><div class="bundle-title"></div><ul class="bundle-list"></ul></div>
        <div class="factor-line"></div>
        <div class="meta-line"></div>
        <div class="refs-block"><div class="refs-title">Addresses (full, for copying)</div><ul class="refs-list"></ul></div>
        <div class="suspect-actions">
          <button class="inter-btn">Interactions</button>
          <button class="copy-btn">Copy address</button>
          <button class="track-btn">Track &amp; name wallet</button>
          <button class="chain-btn" title="Pin to the investigation chain — highlighted on every Constellation and listed on the wallets screen">⛓ Add to chain</button>
          <button class="nonsusp-btn hidden" title="Mark this token-supply move as a normal, non-suspicious transfer — records feedback to sharpen supply-sharing precision, and hides it for this wallet">✓ Not a suspicious transfer</button>
          <button class="connector-btn" title="Mark as a connector/relayer wallet (Phantom, Fomo, etc.). It stays visible everywhere but stops being highlighted as a suspect in every wallet.">⚡ Connector wallet</button>
          <button class="ansem-btn" title="Mark as a known Ansem wallet. Leads where ≥45% of a token's supply moved with it get tagged “Ansem Derived Coin Supply Share” and their certainty damped — a recognised false-positive pattern.">◎ Ansem wallet</button>
          <button class="flag-btn" title="Flag this as an incorrect result — say what it actually is and how sure you are; records feedback and hides it for this wallet">⚑ Flag incorrect</button>
          <button class="ignore-btn" title="Not a side wallet for THIS tracked wallet only — it can still be flagged when you analyze other wallets (undo in settings)">Dismiss</button>
        </div>
      </div>`;

    const name = labels[s.addr];
    li.querySelector(".row-title").textContent = name ? `[${name}]` : shortAddr(s.addr);
    li.querySelector(".row-title").title = s.addr;
    if (name) li.querySelector(".row-title").classList.add("named");

    const certPill = li.querySelector(".cert-pill");
    certPill.textContent = `${s.certBand} ${s.certainty}%`;
    certPill.classList.add(s.certBand === "HIGH" ? "pill-high" : s.certBand === "MED" ? "pill-med" : "pill-low");
    certPill.title = "Certainty from matched factors — expand for the breakdown";

    if (s.bundleRisk) {
      const bp = li.querySelector(".bundle-pill");
      bp.classList.remove("hidden");
      bp.textContent = `BUNDLE ${s.bundleScore}%`;
      bp.classList.add("pill-critical");
    }
    if (s.ansemShare) {
      const ap = li.querySelector(".ansem-pill");
      ap.classList.remove("hidden");
      ap.textContent = "ANSEM SUPPLY ⚠";
      ap.classList.add("pill-ansem");
      ap.title = "Ansem Derived Coin Supply Share — ≥45% of this token's supply moved with a known Ansem wallet. A recognised false-positive pattern; certainty damped ×0.45.";
    }
    if (s.freshSender) {
      const fp2 = document.createElement("span");
      fp2.className = "pill pill-fresh";
      fp2.textContent = "FRESH SENDER ⚠";
      fp2.title = "Fresh, unfunded wallet whose first recorded contact was SENDING tokens/supply — burner-style distribution wallet.";
      li.querySelector(".cert-pill").parentElement.insertBefore(fp2, li.querySelector(".cert-pill"));
    }
    // Funding-source badge: we could identify where this wallet's money came from.
    if (s.fundedBy) {
      const fp = li.querySelector(".fund-pill");
      fp.classList.remove("hidden");
      fp.textContent = `⬦ ${s.fundedBy}`;
      fp.classList.add("pill-fund");
      fp.title = `First funded from ${s.fundedBy}`;
    }

    li.querySelector(".headline").textContent = s.headline;

    // mutual token tickers exchanged between the two wallets
    if (s.mutualTokens && s.mutualTokens.length) {
      const mt = li.querySelector(".mutual-tokens");
      mt.classList.remove("hidden");
      mt.innerHTML = `<span class="mt-label">Tokens:</span> ` +
        s.mutualTokens.map(t => `<span class="mt-chip">${String(t).replace(/</g, "&lt;")}</span>`).join(" ");
    }

    // expanded details
    const evUl = li.querySelector(".evidence-list");
    for (const sig of s.signals) {
      const evLi = document.createElement("li");
      evLi.textContent = sig;
      evUl.appendChild(evLi);
    }
    if (s.biasTags?.length) {
      const bl = li.querySelector(".bias-line");
      bl.classList.remove("hidden");
      bl.textContent = s.biasTags.join(" · ");
    }
    if (s.bundleEvidence?.length) {
      const bb = li.querySelector(".bundle-block");
      bb.classList.remove("hidden");
      li.querySelector(".bundle-title").textContent = `Bundle evidence · ${s.bundleScore}%`;
      const bul = li.querySelector(".bundle-list");
      for (const e of s.bundleEvidence) {
        const bLi = document.createElement("li");
        bLi.textContent = e;
        bul.appendChild(bLi);
      }
    }
    li.querySelector(".factor-line").textContent =
      `Certainty ${s.certainty}% = evidence ${s.evidencePct}% × bias ×${(s.biasMult ?? 1).toFixed(2)}`;
    const refsUl = li.querySelector(".refs-list");
    for (const r of s.refs || [{ label: "suspect wallet", addr: s.addr }]) {
      const rLi = document.createElement("li");
      rLi.innerHTML = `<span class="ref-label"></span><span class="ref-addr mono"></span><button class="copy-btn" title="Copy">⧉</button>`;
      rLi.querySelector(".ref-label").textContent = r.label;
      rLi.querySelector(".ref-addr").textContent = r.addr;
      rLi.querySelector(".copy-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(r.addr);
        $("statusLine").textContent = "Address copied.";
        setTimeout(() => ($("statusLine").textContent = ""), 1500);
      });
      refsUl.appendChild(rLi);
    }
    const hist = walletTags[s.addr];
    const histTxt = hist && hist.tags.length ? ` · history: ${hist.tags.join(", ")} (seen ${hist.seen}×)` : "";
    li.querySelector(".meta-line").textContent =
      `${s.count} direct transfer(s) · ${s.in} in / ${s.out} out · ${fmtDate(s.firstTs)} → ${fmtDate(s.lastTs)}` +
      (s.alsoFunding ? " · also matches high-value funding" : "") + histTxt;

    const details = li.querySelector(".suspect-details");
    const expander = li.querySelector(".expander");
    li.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const open = details.classList.toggle("hidden");
      expander.textContent = open ? "▸" : "▾";
    });
    li.querySelector(".copy-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(s.addr);
      $("statusLine").textContent = "Address copied.";
      setTimeout(() => ($("statusLine").textContent = ""), 1500);
    });
    li.querySelector(".track-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const d = await store.get();
      if (d.wallets.some(w => w.address === s.addr)) {
        $("statusLine").textContent = "Already tracked.";
        setTimeout(() => ($("statusLine").textContent = ""), 1500);
        return;
      }
      const actions = li.querySelector(".suspect-actions");
      if (actions.querySelector(".track-name-in")) return;
      const inp = document.createElement("input");
      inp.className = "track-name-in";
      inp.placeholder = "Name this wallet (optional) — Enter to save";
      const commit = async () => {
        const dd = await store.get();
        if (!dd.wallets.some(w => w.address === s.addr)) {
          dd.wallets.push({ address: s.addr, added: Date.now(), name: inp.value.trim() });
          await store.set({ wallets: dd.wallets });
          if (lastSettings) lastSettings.wallets = dd.wallets;
          renderWalletList();
        }
        $("statusLine").textContent = "Tracked" + (inp.value.trim() ? ` as [${inp.value.trim()}]` : "") + ".";
        setTimeout(() => ($("statusLine").textContent = ""), 1800);
        if (lastStats) renderSideWallets(lastStats, lastSettings || {});
      };
      inp.addEventListener("click", (ev) => ev.stopPropagation());
      inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") commit(); else if (ev.key === "Escape" && lastStats) renderSideWallets(lastStats, lastSettings || {}); });
      actions.prepend(inp);
      inp.focus();
    });
    const rerenderSuspects = (d) => { if (lastStats) renderSideWallets(lastStats, { ...(lastSettings || {}), ignoredScoped: d.ignoredScoped, connectors: d.connectors, ansemWallets: d.ansemWallets, feedback: d.feedback }); };
    // Flag incorrect — capture WHAT it actually is + how sure, then hide (scoped).
    li.querySelector(".flag-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const actions = li.querySelector(".suspect-actions");
      if (actions.querySelector(".flag-form")) return;
      const form = document.createElement("div");
      form.className = "flag-form";
      form.innerHTML =
        `<input class="flag-what" placeholder="What is it really? e.g. exchange, pool, my other wallet">`
        + `<select class="flag-cert"><option value="low">Not sure</option><option value="med" selected>Fairly sure</option><option value="high">Certain</option></select>`
        + `<button class="flag-save tip-btn">Save</button>`;
      form.addEventListener("click", (ev) => ev.stopPropagation());
      form.querySelector(".flag-save").addEventListener("click", async () => {
        const what = form.querySelector(".flag-what").value.trim();
        const cert = form.querySelector(".flag-cert").value;
        const d = await store.get();
        d.feedback = d.feedback || [];
        d.feedback.push({
          addr: s.addr, on: currentAddress, ts: Date.now(), kind: "incorrect",
          certainty: s.certainty, certBand: s.certBand, group: s.group, bundleScore: s.bundleScore,
          actualLabel: what || null, userCertainty: cert,
          signals: (s.signals || []).slice(0, 5),
          factors: (s.factors || []).filter(f => f.w).map(f => f.label),
        });
        addScopedIgnoreObj(d, s.addr);
        await store.set({ feedback: d.feedback, ignoredScoped: d.ignoredScoped });
        if (lastSettings) lastSettings.ignoredScoped = d.ignoredScoped;
        $("statusLine").textContent = "Flagged as incorrect — thanks, this helps improve accuracy.";
        setTimeout(() => ($("statusLine").textContent = ""), 2600);
        rerenderSuspects(d);
      });
      actions.appendChild(form);
      form.querySelector(".flag-what").focus();
    });
    // Connector/relayer wallet (Phantom etc.) — GLOBAL de-highlight, never removed/hidden.
    li.querySelector(".connector-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const d = await store.get();
      d.connectors = d.connectors || [];
      if (!d.connectors.includes(s.addr)) d.connectors.push(s.addr);
      // A connector mark is also a correction — record it so the certainty of the
      // remaining results in this evidence family (and the constellation) recalibrates.
      d.feedback = d.feedback || [];
      if (!d.feedback.some(f => f.addr === s.addr && f.kind === "connector")) {
        d.feedback.push({ addr: s.addr, on: currentAddress, ts: Date.now(), kind: "connector", group: s.group, certainty: s.certainty, certBand: s.certBand, signals: (s.signals || []).slice(0, 3) });
      }
      await store.set({ connectors: d.connectors, feedback: d.feedback });
      if (lastSettings) { lastSettings.connectors = d.connectors; lastSettings.feedback = d.feedback; }
      $("statusLine").textContent = "Marked as connector wallet — no longer highlighted, and similar results recalibrated.";
      setTimeout(() => ($("statusLine").textContent = ""), 2800);
      rerenderSuspects(d);
    });
    // Pin to the investigation chain.
    li.querySelector(".chain-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      addToChain(s.addr, labels[s.addr] || "");
    });
    // Known Ansem wallet — large supply shares to it are tagged + damped (false-positive control).
    li.querySelector(".ansem-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const d = await store.get();
      d.ansemWallets = d.ansemWallets || [];
      if (!d.ansemWallets.includes(s.addr)) d.ansemWallets.push(s.addr);
      await store.set({ ansemWallets: d.ansemWallets });
      if (lastSettings) lastSettings.ansemWallets = d.ansemWallets;
      $("statusLine").textContent = "Marked as an Ansem wallet — large supply shares with it are now tagged and damped.";
      setTimeout(() => ($("statusLine").textContent = ""), 2800);
      rerenderSuspects(d);
    });
    // Supply-sharing: "not a suspicious transfer" (scoped) — hones supply precision.
    if (s.group === "supply") {
      const nb = li.querySelector(".nonsusp-btn");
      nb.classList.remove("hidden");
      nb.addEventListener("click", async (e) => {
        e.stopPropagation();
        const d = await store.get();
        d.feedback = d.feedback || [];
        const mints = (s.refs || []).filter(r => /mint|CA/i.test(r.label)).map(r => r.addr);
        if (!d.feedback.some(f => f.addr === s.addr && f.on === currentAddress && f.kind === "supply-ok")) {
          d.feedback.push({ addr: s.addr, on: currentAddress, ts: Date.now(), kind: "supply-ok", group: s.group, certainty: s.certainty, certBand: s.certBand, mints, signals: (s.signals || []).slice(0, 5) });
        }
        addScopedIgnoreObj(d, s.addr);
        await store.set({ feedback: d.feedback, ignoredScoped: d.ignoredScoped });
        if (lastSettings) lastSettings.ignoredScoped = d.ignoredScoped;
        $("statusLine").textContent = "Marked as non-suspicious — thanks, this sharpens supply precision.";
        setTimeout(() => ($("statusLine").textContent = ""), 2600);
        rerenderSuspects(d);
      });
    }
    li.querySelector(".inter-btn").addEventListener("click", () => openInteractions(s));
    li.querySelector(".inter-ico").addEventListener("click", (e) => { e.stopPropagation(); openInteractions(s); });
    // Dismiss = "not a side wallet for THIS wallet only" (scoped, not global).
    li.querySelector(".ignore-btn").addEventListener("click", async () => {
      const d = await addScopedIgnore(s.addr);
      $("statusLine").textContent = "Not a side wallet for this wallet — undo in settings.";
      setTimeout(() => ($("statusLine").textContent = ""), 2600);
      rerenderSuspects(d);
    });
    ul.appendChild(li);
  };

  const supplyGroup = applySort(suspects.filter(s => s.group === "supply"));
  const fundingGroup = applySort(suspects.filter(s => s.group === "funding"));
  if (supplyGroup.length) {
    addGroupHeader(`Token supply sharing · ${supplyGroup.length}`);
    supplyGroup.forEach(addSuspect);
  }
  if (fundingGroup.length) {
    addGroupHeader(`High-value transfers · ${fundingGroup.length}`);
    fundingGroup.forEach(addSuspect);
  }

  // Every other wallet interaction — low suspicion, but still visible and
  // expandable so connections are never silently hidden.
  const others = applySort(findOtherWallets(stats.topCounterparties || [], evalOpts));
  if (others.length) {
    addGroupHeader(`Other wallet interactions · ${others.length} · low suspicion`);
    others.forEach(addSuspect);
  }
  if (suspects.length === 0 && others.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="hint">No direct wallet interactions in the analyzed window.</span>`;
    ul.appendChild(li);
  }
  section.classList.toggle("hidden", suspects.length === 0 && others.length === 0);
}


// Category assignment for the agent/interaction breakdown. Labels come from
// on-chain classification + known-address list + observed behavior.
function agentCategory(c) {
  const kind = c.cls?.kind || "unknown";
  const label = c.cls?.label || "";
  if (kind === "wallet" && c.exchangeLike) return { key: "amm", title: "Pools & market makers · behavioral" };
  if (kind === "wallet" && c.botLike) return { key: "bots", title: "Bots & fee collectors · behavioral" };
  if (kind === "wallet") return { key: "wallets", title: "Wallets" };
  if (kind === "exchange") return { key: "cex", title: "Exchanges · labeled" };
  if (/tip/i.test(label) || /fee/i.test(label)) return { key: "fees", title: "Tips & fee accounts" };
  if (/mint \(contract\)/i.test(label)) return { key: "contracts", title: "Token contracts" };
  if (/token account/i.test(label)) return { key: "tokenacct", title: "Token accounts" };
  if (/program|pda|validator|stake/i.test(label)) return { key: "programs", title: "Programs & PDAs" };
  return { key: "other", title: "Unclassified" };
}

const CATEGORY_ORDER = ["wallets", "amm", "cex", "fees", "contracts", "programs", "tokenacct", "bots", "other"];

let cpSort = "count", progSort = "count";   // count | new | old — per-section sorts
const WALLET_CATS = ["wallets", "amm", "cex", "bots"];             // "Interacted addresses"
const PROG_CATS = ["fees", "contracts", "programs", "tokenacct", "other"]; // "Programs & PDAs"
function cpCmp(sort) {
  return (a, b) => sort === "new" ? (b.lastTs || 0) - (a.lastTs || 0)
    : sort === "old" ? (a.lastTs || 0) - (b.lastTs || 0)
    : (b.count || 0) - (a.count || 0);
}
function cpRow(c, labels, walletTags, symbolMap, connectors) {
  const li = document.createElement("li");
  const kinds = [c.sol ? `${c.sol} SOL` : null, c.token ? `${c.token} token` : null].filter(Boolean).join(", ");
  const dir = `${c.in || 0} in / ${c.out || 0} out`;
  const hist = walletTags[c.addr];
  const histTxt = hist && hist.tags.length ? " · history: " + hist.tags.join(", ") : "";
  const flagTxt = ((c.flags && c.flags.length) ? " · " + c.flags.join(" · ") : "") + histTxt;
  li.innerHTML = `<div class="row-main">
      <span class="row-title mono"></span>
      <span class="row-sub sub1"></span>
      <span class="row-sub sub2"></span></div>
    <div class="row-right"><span class="badge"></span> <button class="copy-btn" title="Copy address">⧉</button></div>`;
  const nm = labels[c.addr];
  const rt = li.querySelector(".row-title");
  // If this counterparty address is a known token mint/contract, surface its $ticker.
  const ticker = symbolMap && symbolMap[c.addr];
  rt.textContent = nm ? `[${nm}]` : (ticker ? `$${ticker}` : shortAddr(c.addr));
  if (nm || ticker) rt.classList.add("named");
  rt.title = ticker ? `$${ticker} · ${c.addr}` : c.addr;
  const isConn = connectors && connectors.has(c.addr);
  li.querySelector(".sub1").textContent = (c.cls?.label || "Unclassified") + (ticker ? ` · $${ticker}` : "") + (isConn ? " · ⚡ connector" : "");
  if (isConn) li.classList.add("connector-row");
  li.querySelector(".sub2").textContent = `${kinds} · ${dir} · last ${fmtDate(c.lastTs)}${flagTxt}`;
  li.querySelector(".badge").textContent = c.count + "×";
  li.querySelector(".copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(c.addr);
    $("statusLine").textContent = "Address copied.";
    setTimeout(() => ($("statusLine").textContent = ""), 1500);
  });
  return li;
}
function renderCpInto(listEl, cats, sort, labels, walletTags, list, symbolMap, connectors) {
  listEl.innerHTML = "";
  const groups = new Map();
  for (const c of list) {
    const cat = agentCategory(c);
    if (!cats.includes(cat.key)) continue;
    if (!groups.has(cat.key)) groups.set(cat.key, { title: cat.title, items: [] });
    groups.get(cat.key).items.push(c);
  }
  let total = 0;
  for (const key of cats) {
    const g = groups.get(key);
    if (!g) continue;
    g.items.sort(cpCmp(sort));
    const head = document.createElement("li");
    head.className = "group-header";
    head.textContent = `${g.title} (${g.items.length})`;
    listEl.appendChild(head);
    for (const c of g.items) { listEl.appendChild(cpRow(c, labels, walletTags, symbolMap, connectors)); total++; }
  }
  if (total === 0) listEl.innerHTML = `<li><span class="hint">None in the analyzed window.</span></li>`;
  return total;
}
function renderCounterparties(stats, settings = {}) {
  const labels = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const walletTags = settings.walletTags || {};
  const list = stats.topCounterparties || [];
  const symbolMap = stats.symbolMap || {};
  const connectors = new Set(settings.connectors || []);
  renderCpInto($("counterpartyList"), WALLET_CATS, cpSort, labels, walletTags, list, symbolMap, connectors);
  renderCpInto($("programsList"), PROG_CATS, progSort, labels, walletTags, list, symbolMap, connectors);
}

// ---------- interactions overlay ----------
function openInteractions(s) {
  const labels = Object.fromEntries(((lastSettings && lastSettings.wallets) || []).filter(w => w.name).map(w => [w.address, w.name]));
  const nameOf = (a) => labels[a] ? `[${labels[a]}]` : shortAddr(a);
  $("interTitle").textContent = `Interactions: ${nameOf(currentAddress || "")} ↔ ${nameOf(s.addr)}`;
  $("interSub").textContent = s.addr;
  $("interSub").title = s.addr;
  const ul = $("interList");
  ul.innerHTML = "";
  const events = s.interactions || [];
  if (events.length === 0) {
    ul.innerHTML = `<li><span class="hint">No recorded direct transfers (only trade/fee legs, which are filtered).</span></li>`;
  }
  for (const e of events) {
    const li = document.createElement("li");
    // Direction from the tracked wallet's perspective: out = tracked → suspect
    const arrow = e.dir === "out" ? "→ sent to them" : "← received from them";
    const what = e.kind === "sol"
      ? `${fmtQty(e.amt)} SOL`
      : `${fmtQty(e.amt)} ${e.symbol || (e.mint ? e.mint.slice(0, 4) + "…" : "token")}`;
    const curPrice = e.mint && lastStats?.priceMap?.[e.mint];
    const sp = lastStats?.solPrice;
    const value = e.kind === "sol" ? ""
      : e.estSol != null ? ` · worth ≈${fmtQty(e.estSol)} SOL at transfer`
      : curPrice != null ? ` · worth ≈$${fmtQty(e.amt * curPrice)}${sp ? ` / ${fmtQty(e.amt * curPrice / sp)} SOL` : ""} at current price`
      : "";
    const paired = e.paired ? " · ⇄ trade leg" : "";
    li.innerHTML = `<div class="row-main">
        <span class="row-title"></span>
        <span class="row-sub"></span></div>
      <div class="row-right"><span class="row-val-sub"></span></div>`;
    li.querySelector(".row-title").textContent = what;
    li.querySelector(".row-sub").textContent = `${arrow}${value}${paired}`;
    li.querySelector(".row-val-sub").textContent = new Date(e.t * 1000).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    ul.appendChild(li);
  }
  $("interPanel").classList.remove("hidden");
  $("interPanel").scrollTop = 0;
}

// ---------- recent sells ----------
function sellRow(sv, symbolMap) {
  const li = document.createElement("li");
  const rawSym = symbolMap[sv.mint] || sv.symbol || "";
  const sym = rawSym || (sv.mint ? sv.mint.slice(0, 4) + "…" : "token");
  const got = sv.sol > 0 ? `${fmtQty(sv.sol)} SOL` : sv.quote > 0 ? `${fmtQty(sv.quote)} stable` : "—";
  li.innerHTML = `<div class="row-main"><span class="row-title"></span><span class="row-sub mono"></span></div>
    <div class="row-right"><div class="row-val"></div><div class="row-val-sub"></div></div>`;
  li.querySelector(".row-title").textContent = `Sold ${fmtQty(sv.amt)} ${sym}`;
  // Ticker ($SYMBOL) shown right beside the CA, when a real symbol is known.
  if (rawSym) {
    const tick = document.createElement("span");
    tick.className = "sell-tick";
    tick.textContent = `$${rawSym}`;
    li.querySelector(".row-title").appendChild(tick);
  }
  const sub = li.querySelector(".row-sub");
  sub.textContent = sv.mint || "";
  sub.title = sv.mint || "";
  if (sv.mint) {
    const cp = document.createElement("button");
    cp.className = "copy-mini"; cp.textContent = "⧉"; cp.title = "Copy CA";
    cp.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(sv.mint);
      cp.textContent = "✓"; setTimeout(() => (cp.textContent = "⧉"), 1200);
    });
    sub.appendChild(cp);
  }
  li.querySelector(".row-val").textContent = `→ ${got}`;
  li.querySelector(".row-val-sub").textContent = sv.t ? new Date(sv.t * 1000).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  return li;
}
function renderSells(stats) {
  const sells = stats.sellEvents || [];
  $("sellsSection").classList.toggle("hidden", sells.length === 0);
  const ul = $("sellsList");
  ul.innerHTML = "";
  const symbolMap = stats.symbolMap || {};
  for (const sv of sells.slice(0, 30)) ul.appendChild(sellRow(sv, symbolMap));
  $("loadMoreSellsBtn").textContent = sells.length > 30
    ? `Load more sells… (showing 30 of ${sells.length} in window)`
    : "Load more sells…";
}

// Recent outbound SOL / stablecoin transfers, split by destination wallet age.
function renderSolOut(stats, settings = {}) {
  const el = $("solOutSection");
  if (!el) return;
  const out = stats.solStableOut || [];
  el.classList.toggle("hidden", out.length === 0);
  if (!out.length) return;
  const labels = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const ages = stats.destAges || {};
  const FRESH = 30 * 86400, AGED = 180 * 86400;
  const ul = $("solOutList");
  ul.innerHTML = "";
  const cls = (addr) => {
    const a = ages[addr];
    if (a == null) return "unknown";
    return a <= FRESH ? "fresh" : a >= AGED ? "aged" : "mid";
  };
  const buckets = {
    fresh: { title: "To fresh wallets (≤ 30d)", rows: [] },
    aged: { title: "To aged wallets (≥ 6mo)", rows: [] },
    mid: { title: "To other wallets", rows: [] },
    unknown: { title: "Age not resolved", rows: [] },
  };
  for (const o of out.slice(0, 40)) buckets[cls(o.to)].rows.push(o);
  let gseq = 0;
  const header = (title, n) => {
    const gi = ++gseq;
    const li = document.createElement("li");
    li.className = "group-header collapsible";
    li.innerHTML = `<span class="caret">▾</span> `;
    li.appendChild(document.createTextNode(`${title} · ${n}`));
    li.addEventListener("click", () => {
      const c = li.classList.toggle("grp-collapsed");
      li.querySelector(".caret").textContent = c ? "▸" : "▾";
      ul.querySelectorAll(`[data-sg="${gi}"]`).forEach(x => x.classList.toggle("hidden", c));
    });
    ul.appendChild(li);
    return gi;
  };
  for (const key of ["fresh", "aged", "mid", "unknown"]) {
    const b = buckets[key];
    if (!b.rows.length) continue;
    const gi = header(b.title, b.rows.length);
    for (const o of b.rows) {
      const li = document.createElement("li");
      li.dataset.sg = String(gi);
      const nm = labels[o.to] ? `[${escHtml(labels[o.to])}]` : shortAddr(o.to);
      const amtTxt = o.asset === "SOL" ? `${fmtQty(o.amt)} SOL` : `${fmtQty(o.amt)} ${(stats.symbolMap && stats.symbolMap[o.mint]) || "stable"}`;
      const ageTxt = ages[o.to] != null ? `${fmtAge(ages[o.to])} old` : "age n/a";
      li.innerHTML = `<div class="row-main"><span class="row-title"></span><span class="row-sub mono"></span></div>`
        + `<div class="row-right"><div class="row-val"></div><div class="row-val-sub"></div>`
        + `<button class="copy-mini" title="Copy address">⧉</button></div>`;
      li.querySelector(".row-title").textContent = `→ ${amtTxt}`;
      const sub = li.querySelector(".row-sub");
      sub.textContent = `${nm} · ${ageTxt}`;
      sub.title = o.to;
      li.querySelector(".row-val").textContent = fmtDate(o.t);
      li.querySelector(".copy-mini").addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(o.to);
        e.target.textContent = "✓"; setTimeout(() => (e.target.textContent = "⧉"), 1200);
      });
      ul.appendChild(li);
    }
  }
}

let sellsPanelState = null; // { sells:[], oldestSig }
function openSellsPanel() {
  if (!lastStats) return;
  const nm = (lastSettings?.wallets || []).find(w => w.address === currentAddress)?.name;
  $("sellsPanelSub").textContent = nm ? `[${nm}] · ${shortAddr(currentAddress || "")}` : (currentAddress || "");
  sellsPanelState = { sells: [...(lastStats.sellEvents || [])], oldestSig: lastStats.oldestSig || null };
  renderSellsPanel();
  $("sellsPanel").classList.remove("hidden");
  $("sellsPanel").scrollTop = 0;
}
function renderSellsPanel() {
  const ul = $("sellsPanelList");
  ul.innerHTML = "";
  const symbolMap = (lastStats && lastStats.symbolMap) || {};
  if (!sellsPanelState.sells.length) ul.innerHTML = `<li><span class="hint">No sells found in the analyzed window.</span></li>`;
  for (const sv of sellsPanelState.sells) ul.appendChild(sellRow(sv, symbolMap));
  $("sellsPanelStatus").textContent = `${sellsPanelState.sells.length} sells`;
  $("loadOlderSellsBtn").classList.toggle("hidden", !sellsPanelState.oldestSig);
}
async function loadOlderSells() {
  if (!sellsPanelState || !sellsPanelState.oldestSig) return;
  const d = await store.get();
  if (!d.apiKey) { $("sellsPanelStatus").textContent = "No API key set."; return; }
  $("loadOlderSellsBtn").disabled = true;
  $("sellsPanelStatus").textContent = "Paging older history…";
  try {
    const url = `https://api.helius.xyz/v0/addresses/${currentAddress}/transactions?api-key=${d.apiKey}&limit=100&before=${sellsPanelState.oldestSig}`;
    const res = await fetch(url);
    const txs = res.ok ? await res.json() : [];
    if (!Array.isArray(txs) || txs.length === 0) {
      sellsPanelState.oldestSig = null;
      $("sellsPanelStatus").textContent = "Reached the end of available history.";
      renderSellsPanel();
      return;
    }
    const asc = [...txs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const found = [];
    for (const tx of asc) { const sv = sellFromTx(tx, currentAddress); if (sv) found.push(sv); }
    found.reverse(); // newest of this older batch first
    sellsPanelState.sells.push(...found);
    sellsPanelState.oldestSig = asc[0]?.signature || null;
    renderSellsPanel();
    $("sellsPanelStatus").textContent = `+${found.length} older sell(s) · ${sellsPanelState.sells.length} total`;
  } catch (e) {
    $("sellsPanelStatus").textContent = "Error: " + (e && e.message ? e.message : String(e));
  } finally {
    $("loadOlderSellsBtn").disabled = false;
  }
}

// ---------- connection bubble map ----------
let MAP_W = 760, MAP_H = 580;   // dynamic — grown by openBubbleMap for busy maps
let mapShowInfra = false;        // toggle: aggregate infrastructure as cluster nodes
let mapLowConfThresh = 0;        // hide connections below this certainty % (0 = show all)
// Constellation colour palettes — four combinations, selectable on the map and
// persisted. Hues within each palette are deliberately well separated so node
// groups stay easy to tell apart at a glance.
// Each palette is a COHERENT hue family (no white anywhere): a cool or warm base
// carries the ordinary nodes and lines, and one or two accent hues are reserved
// for what matters — side-wallet/bundle leads and peer links — so maps read as
// one matched scheme instead of a rainbow.
const MAP_PALETTES = {
  arctic: { label: "Arctic",   // cool blues/teals · coral accent for leads
    groups: { self: "#3fc6ff", side: "#ff8a5c", bundle: "#ff5470", funding: "#6f8dff", wallet: "#3fe0c0", agent: "#6b7686", exchange: "#9db8d9", other: "#6b7686", cluster: "#545e6a" },
    dirIn: "#3fe0c0", dirOut: "#6f8dff", dirBoth: "#3fc6ff", peer: "#ffc46b", chain: "#ffdf57" },
  sunset: { label: "Sunset",   // warm ambers/corals · violet + azure accents
    groups: { self: "#ffb454", side: "#b98cff", bundle: "#ff3d5e", funding: "#ff6f91", wallet: "#ff8f6b", agent: "#8a8078", exchange: "#ffd98a", other: "#8a8078", cluster: "#5f5751" },
    dirIn: "#ffc46b", dirOut: "#ff6f91", dirBoth: "#ff9a5c", peer: "#7fd4ff", chain: "#5df2c8" },
  solana: { label: "Solana",   // brand greens/purples · orange accent for leads
    groups: { self: "#14f195", side: "#ff8a3c", bundle: "#ff3b5c", funding: "#a25bff", wallet: "#4fe3c1", agent: "#6b7686", exchange: "#c7a8ff", other: "#6b7686", cluster: "#545e6a" },
    dirIn: "#14f195", dirOut: "#9945ff", dirBoth: "#35d6c8", peer: "#ff7ac6", chain: "#ffe14d" },
  slate: { label: "Slate",     // graphite steels · red + amber accents
    groups: { self: "#b8c6d8", side: "#ff6b5e", bundle: "#ff3d5e", funding: "#93a6c4", wallet: "#7d8a99", agent: "#5a636e", exchange: "#aebdd0", other: "#5a636e", cluster: "#48505a" },
    dirIn: "#a9bccf", dirOut: "#6f7f8f", dirBoth: "#c4d2e0", peer: "#ff9e6b", chain: "#ffc94d" },
};
let mapPaletteName = "arctic";
let GROUP_COLOR = { ...MAP_PALETTES.arctic.groups };
let DIR_IN = MAP_PALETTES.arctic.dirIn;
let DIR_OUT = MAP_PALETTES.arctic.dirOut;
let DIR_BOTH = MAP_PALETTES.arctic.dirBoth;
let PEER_COLOR = MAP_PALETTES.arctic.peer;
let CHAIN_COLOR = MAP_PALETTES.arctic.chain;   // investigation-chain beacon — matches the active palette
function applyMapPalette(name) {
  if (name === "mono") name = "slate";                 // legacy stored value
  const p = MAP_PALETTES[name] || MAP_PALETTES.arctic;
  mapPaletteName = MAP_PALETTES[name] ? name : "arctic";
  GROUP_COLOR = { ...p.groups };
  DIR_IN = p.dirIn; DIR_OUT = p.dirOut; DIR_BOTH = p.dirBoth; PEER_COLOR = p.peer;
  CHAIN_COLOR = p.chain || "#ffdf57";
}
const GROUP_LABEL = {
  self: "Tracked wallet", side: "Side-wallet lead", bundle: "Bundle-prone",
  funding: "Funding-related", wallet: "Wallet", agent: "Program / pool / bot", exchange: "Exchange",
  cluster: "Infrastructure group",
};
// Connection colours encode DIRECTION of flow relative to the tracked wallet —
// the actual values come from the active palette (applyMapPalette above).
function edgeDir(net) {
  return net < -0.15 ? { col: DIR_IN, flow: -1 } : net > 0.15 ? { col: DIR_OUT, flow: 1 } : { col: DIR_BOTH, flow: 0 };
}
// Shift a #rrggbb toward white (amt>0) or black (amt<0) — for solid bubble depth.
function lighten(hex, amt) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const mix = (h) => {
    const v = parseInt(h, 16);
    const nv = amt >= 0 ? v + (255 - v) * amt : v * (1 + amt);
    return Math.max(0, Math.min(255, Math.round(nv))).toString(16).padStart(2, "0");
  };
  return `#${mix(m[1])}${mix(m[2])}${mix(m[3])}`;
}

function buildMapData(stats, settings) {
  const labels = Object.fromEntries((settings.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const scopedIgn = suspectExclusions(settings, currentAddress);
  const evalOpts = {
    solThresh: settings.solThresh, usdThresh: settings.usdThresh,
    buyEvents: stats.buyEvents, largeInflowTs: stats.largeInflowTs,
    ignored: scopedIgn, ansem: settings.ansemWallets, calib: feedbackCalibration(settings.feedback),
    priceMap: stats.priceMap, solPrice: stats.solPrice, labels,
  };
  const ignored = new Set(scopedIgn);
  const evalById = {};
  for (const c of stats.topCounterparties || []) {
    if (c.cls?.kind === "wallet" && !c.botLike && !c.exchangeLike && !ignored.has(c.addr)) {
      evalById[c.addr] = evaluateWallet(c, evalOpts);
    }
  }

  const groupOf = (c) => {
    const s = evalById[c.addr];
    if (s && s.qualifies) {
      if (s.bundleRisk) return "bundle";
      return s.group === "supply" ? "side" : "funding";
    }
    const k = c.cls?.kind;
    if (k === "exchange") return "exchange";
    if (k === "agent") return "agent";
    if (c.exchangeLike || c.botLike) return "agent";
    return "wallet";
  };

  // Center = the tracked wallet, ALWAYS shown by its label (or short address).
  const nodes = [{ id: currentAddress, self: true, group: "self", label: labels[currentAddress] || shortAddr(currentAddress || ""), named: !!labels[currentAddress], certainty: null, weight: 0, count: 0 }];
  const links = [];
  const cps = (stats.topCounterparties || []).slice();
  // Wallet counterparties + labeled exchanges become individual nodes (sized by
  // certainty). Infrastructure (bots, pools, programs, token accounts) is set
  // aside — optionally shown as aggregated CLUSTER nodes (≤25 members each).
  const candidates = [];
  const infra = [];
  for (const c of cps) {
    const s = evalById[c.addr];
    if (s) {
      candidates.push({ c, s, cert: s.certainty || 0, group: groupOf(c) });
    } else if (c.cls?.kind === "exchange") {
      candidates.push({ c, s: null, cert: null, group: "exchange" });
    } else {
      infra.push(c); // bots, pools, programs, token accounts, unclassified
    }
  }
  candidates.sort((a, b) => (b.cert ?? 55) - (a.cert ?? 55) || (b.c.count || 0) - (a.c.count || 0));
  // The layout ALWAYS includes every candidate — the low-confidence % filter is
  // applied later at render time so that hiding weak connections never re-seeds
  // positions (keeps the arrangement, just hides nodes).
  const shown = candidates.slice(0, 40);
  const overflow = candidates.slice(40).map(x => x.c);   // beyond the 40 cap
  for (const { c, s, group } of shown) {
    nodes.push({
      id: c.addr, group, label: labels[c.addr] || shortAddr(c.addr),
      named: !!labels[c.addr], count: c.count || 1,
      certainty: s ? s.certainty : null, bundleScore: s ? s.bundleScore : null, bundleRisk: s ? s.bundleRisk : false,
      inN: c.in || 0, outN: c.out || 0, clsLabel: (labelFor(c.addr)?.label) || c.cls?.label || "",
      topSig: s ? ((s.signals && s.signals[0]) || "") : "",
    });
    links.push({ source: currentAddress, target: c.addr, w: c.count || 1, group });
  }

  const minor = [...infra, ...overflow];
  let hidden = minor.length;
  // Cluster nodes are ALWAYS built and laid out (into empty gaps, see layoutMap), so
  // the Show/Hide infrastructure toggle can add/remove them at RENDER time without
  // re-seeding positions. Whether they're actually drawn is decided in rerenderMap.
  if (minor.length) {
    // Group by category, then chunk each category into cluster nodes of ≤25.
    const byCat = new Map();
    for (const c of minor) {
      const cat = agentCategory(c);
      if (!byCat.has(cat.key)) byCat.set(cat.key, { title: cat.title, members: [] });
      byCat.get(cat.key).members.push(c);
    }
    hidden = 0;
    for (const [key, g] of byCat) {
      g.members.sort((a, b) => (b.count || 0) - (a.count || 0));
      for (let i = 0; i < g.members.length; i += 25) {
        const chunk = g.members.slice(i, i + 25);
        const totalTx = chunk.reduce((a, m) => a + (m.count || 1), 0);
        const parts = byCat.get(key).members.length > 25 ? ` ${Math.floor(i / 25) + 1}` : "";
        const id = `cluster:${key}:${i}`;
        nodes.push({
          id, cluster: true, group: "cluster",
          label: `${g.title}${parts}`, clusterCat: g.title, count: chunk.length, totalTx,
          members: chunk.map(m => ({ addr: m.addr, label: m.cls?.label || "", n: m.count || 1 })),
          certainty: null, named: false,
        });
        links.push({ source: currentAddress, target: id, w: Math.max(1, Math.round(totalTx / chunk.length)), group: "cluster" });
      }
    }
  }
  // Inter-wallet ("peer") edges: counterparties that also transacted directly
  // with each other. Drawn only when BOTH endpoints are shown as nodes.
  const shownIds = new Set(nodes.map(n => n.id));
  const seenPeer = new Set();
  let peerCount = 0;
  for (const e of (stats.walletEdges || [])) {
    if (!shownIds.has(e.a) || !shownIds.has(e.b)) continue;
    const k = e.a < e.b ? e.a + "|" + e.b : e.b + "|" + e.a;
    if (seenPeer.has(k)) continue;
    seenPeer.add(k);
    links.push({ source: e.a, target: e.b, w: e.w || 1, group: "peer", peer: true, ab: e.ab || 0, ba: e.ba || 0 });
    peerCount++;
  }
  return { nodes, links, hidden, infraTotal: minor.length, peerCount };
}

// Deterministic hash → [0,1), used for organic (noise-like) seeding.
function hash01(str, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

// Organic force layout — noise-seeded positions, repulsion, and a soft,
// per-node-varied pull toward the hub so it disperses like scattered growth
// rather than concentric rings. Center is pinned; nodes are draggable after.
function layoutMap(nodes, links) {
  const cx = MAP_W / 2, cy = MAP_H / 2;
  const radiusFor = (n) => {
    if (n.self) return 28;
    if (n.cluster) return 15 + Math.min(20, Math.sqrt(n.count || 1) * 4); // clusters sized by members
    const cert = n.certainty;
    let base;
    // Sizes are deliberately NOT proportional to certainty — low-% nodes stay
    // comfortably clickable/readable; high-% nodes still read as bigger.
    if (cert == null) base = 14;                          // exchanges/funding sources
    else if (cert < 60) base = 10 + 8 * (cert / 60);      // 10…18 — small but never tiny
    else base = 18 + 16 * Math.pow((cert - 60) / 40, 0.8);// 18…34 — prominent
    // Deterministic per-wallet jitter so equal-confidence spheres aren't identical
    // (narrow band, so the floor above actually holds).
    return base * (0.9 + hash01(n.id, 53) * 0.25);        // ×0.90 … ×1.15
  };
  for (const n of nodes) n.r = radiusFor(n);

  const self = nodes.find(n => n.self);
  const others = nodes.filter(n => !n.self);
  const reals = others.filter(n => !n.cluster);           // real counterparties
  const clusters = others.filter(n => n.cluster);         // infra clusters (placed last)
  const N = reals.length || 1;

  const netOf = (n) => {
    const i = n.inN || 0, o = n.outN || 0, t = i + o;
    return t ? (o - i) / t : 0;                            // -1 pure in … +1 pure out
  };
  for (const n of reals) n.net = netOf(n);

  // The hub does NOT sit dead-centre: it's anchored to a deterministic, per-wallet
  // off-centre spot (position varies per wallet). Connections are seeded in a FULL
  // circle around it — not a one-sided wedge — so the whole canvas gets used and the
  // analysed wallet sits AMONG its connections at a randomised offset.
  const ang0 = hash01(self.id, 3) * Math.PI * 2;
  const r0 = (0.10 + hash01(self.id, 9) * 0.17) * Math.min(MAP_W, MAP_H);
  const ax = cx + Math.cos(ang0) * r0, ay = cy + Math.sin(ang0) * r0;

  const peerSet = new Set();
  for (const l of links) if (l.peer) { peerSet.add(l.source); peerSet.add(l.target); }
  const confOf = (n) => (n.certainty != null ? n.certainty : 55);   // exchanges ≈ 55
  const ordered = [...reals].sort((a, b) => confOf(b) - confOf(a));  // high-confidence first → nearest hub
  const GA = Math.PI * (3 - Math.sqrt(5));
  const spread = Math.min(MAP_W, MAP_H) * 0.54;
  // Connections spread through a per-wallet fan centred on a random direction. The
  // gap opposite that direction is what makes the hub read as off-centre once the
  // cloud is scaled to fill the canvas — the fan direction differs every wallet, so
  // the analysed wallet lands in a different corner/edge each time.
  const bAng = hash01(self.id, 15) * Math.PI * 2;
  const span = Math.PI * 2 * 0.52;
  // Pre-split: one-way hub-only spokes get their own stratified placement so they
  // never bunch together near the hub; everything else keeps the confidence spiral.
  const oneWays = [], spiralNodes = [];
  for (const n of ordered) {
    const peered = peerSet.has(n.id);
    const twoWay = (n.inN || 0) > 0 && (n.outN || 0) > 0;  // recurring back-and-forth
    (!peered && !twoWay ? oneWays : spiralNodes).push(n);
  }
  // Density-aware inner ring: with many connections the high-certainty nodes
  // (which sit nearest the hub) start further out and spread wider, so busy maps
  // stay readable. Sparse maps keep the original tight, pleasant grouping.
  const innerBase = 0.20 + Math.min(0.16, Math.max(0, N - 14) * 0.006);
  spiralNodes.forEach((n, i) => {
    const g = (((i * GA) % span) + span) % span;
    const ang = bAng - span / 2 + g + (hash01(n.id, 7) - 0.5) * 0.3;
    const radBase = innerBase + 0.66 * Math.sqrt((i + 0.5) / Math.max(1, spiralNodes.length));
    const rad = spread * radBase * (0.85 + hash01(n.id, 19) * 0.3);
    n.restLen = rad * (0.9 + hash01(n.id, 31) * 0.25);
    n.x = ax + Math.cos(ang) * rad;
    n.y = ay + Math.sin(ang) * rad;
  });
  // One-way spokes: STRATIFIED angular slots across the fan (guaranteed separation —
  // no two originate close together at the hub) + strongly varied radii, and each
  // spring rest-length follows its OWN seeded radius, so the settle keeps the varied
  // distances instead of pulling them all back into one tight, even ring.
  const K = Math.max(1, oneWays.length);
  oneWays.forEach((n, k) => {
    const slot = (k + 0.5) / K;                                  // even slot across the fan
    const jit = (hash01(n.id, 23) - 0.5) * (span / K) * 0.9;     // jitter within the slot
    const ang = bAng - span / 2 + slot * span + jit;
    const rad = spread * (0.55 + hash01(n.id, 29) * 1.25);       // 0.55–1.8 × spread
    n.restLen = rad * (0.85 + hash01(n.id, 31) * 0.3);
    n.x = ax + Math.cos(ang) * rad;
    n.y = ay + Math.sin(ang) * rad;
  });
  self.x = ax; self.y = ay;

  // Force settle — the hub + REAL nodes only. Clusters are excluded here and placed
  // afterwards, so showing/hiding infrastructure never disturbs the real layout.
  const sim = [self, ...reals];
  const rep = 13 + N * 0.9;
  for (let iter = 0; iter < 420; iter++) {
    const cool = 1 - iter / 500;
    for (let a = 0; a < sim.length; a++) {
      for (let b = a + 1; b < sim.length; b++) {
        const p = sim[a], q = sim[b];
        let dx = p.x - q.x, dy = p.y - q.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const minD = p.r + q.r + 20 + Math.min(26, Math.max(0, N - 14) * 1.1); // busier maps → more breathing room
        const force = (p.r * q.r * rep) / d2;
        const ux = dx / d, uy = dy / d;
        if (!p.self) { p.x += ux * force * cool; p.y += uy * force * cool; }
        if (!q.self) { q.x -= ux * force * cool; q.y -= uy * force * cool; }
        if (d < minD) {
          const push = (minD - d) / 2 + 0.5;
          if (!p.self) { p.x += ux * push; p.y += uy * push; }
          if (!q.self) { q.x -= ux * push; q.y -= uy * push; }
        }
      }
    }
    for (const n of reals) {                              // gentle pull toward the hub anchor
      const dx = ax - n.x, dy = ay - n.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const k = (d - n.restLen) * 0.006;                  // low, so the seeded fan shape survives
      n.x += (dx / d) * k; n.y += (dy / d) * k;
    }
  }

  // ---- Hub placement + guaranteed radial spread (the readability core) ----
  // The settle above gives organic ANGLES, but on real data the distances bunch:
  // a clump hugs the hub while a few far spokes stretch the bounding box, so any
  // box-based fit leaves most of the canvas empty. Instead: place the hub at its
  // per-wallet off-centre spot, KEEP each node's direction from the hub, and
  // remap the distances by rank so nodes run from an inner ring all the way to
  // the canvas edge in their own direction — full-canvas usage is guaranteed no
  // matter how the physics settled.
  {
    // The hub position DRIVES the whole design — its range is wide: anywhere from
    // near-centre out to strongly offset (15–85% across, per-wallet deterministic).
    const hAng = hash01(self.id, 33) * Math.PI * 2;
    const hRad = (0.05 + hash01(self.id, 37) * 0.30) * Math.min(MAP_W, MAP_H);
    let hx = MAP_W / 2 + Math.cos(hAng) * hRad * (MAP_W / Math.min(MAP_W, MAP_H)) * 0.85;
    let hy = MAP_H / 2 + Math.sin(hAng) * hRad * 0.9;
    hx = Math.max(MAP_W * 0.15, Math.min(MAP_W * 0.85, hx));
    hy = Math.max(MAP_H * 0.16, Math.min(MAP_H * 0.84, hy));
    const ddx = hx - self.x, ddy = hy - self.y;
    self.x = hx; self.y = hy;
    for (const n of reals) { n.x += ddx; n.y += ddy; }

    const m = 14;
    const boundaryT = (ux, uy) => {                     // distance hub→canvas edge along (ux,uy)
      let t = Infinity;
      if (ux > 1e-6) t = Math.min(t, (MAP_W - m - hx) / ux);
      if (ux < -1e-6) t = Math.min(t, (m - hx) / ux);
      if (uy > 1e-6) t = Math.min(t, (MAP_H - m - hy) / uy);
      if (uy < -1e-6) t = Math.min(t, (m - hy) / uy);
      return t;
    };
    // "Between other wallets" connections come FIRST: each peer-linked pair is
    // pushed as far apart as possible — opposite ends of a per-pair axis through
    // the canvas — close to but never touching the edges. That leaves the whole
    // stretch between them free for every other connection to fill.
    const peerPlaced = new Set();
    const cX = MAP_W / 2, cY = MAP_H / 2;
    const edgeR = (ux, uy, r) => {              // centre → margin distance along (ux,uy)
      let t = Infinity;
      if (ux > 1e-6) t = Math.min(t, (MAP_W - m - cX) / ux);
      if (ux < -1e-6) t = Math.min(t, (m - cX) / ux);
      if (uy > 1e-6) t = Math.min(t, (MAP_H - m - cY) / uy);
      if (uy < -1e-6) t = Math.min(t, (m - cY) / uy);
      return Math.max(60, t - r - 6);
    };
    const byId = {};
    for (const n of reals) byId[n.id] = n;
    const peerLinks = links.filter(l => l.peer && byId[l.source] && byId[l.target]);
    // Direction rule: every peer pair gets its OWN angular slot across the half-turn
    // (an axis covers both ways), so no two peer lines stream in the same exact
    // direction — comfortably inside the "no more than 2" limit.
    const axis0 = hash01(self.id, 61) * Math.PI;
    const slotW = Math.PI / Math.max(1, peerLinks.length);
    const P = Math.max(1, peerLinks.length);
    const maxOff = 0.34 * Math.min(MAP_W, MAP_H);
    // reach from an arbitrary point to the margin box along (ux,uy)
    const reachFrom = (px2, py2, ux, uy, r) => {
      let t = Infinity;
      if (ux > 1e-6) t = Math.min(t, (MAP_W - m - px2) / ux);
      if (ux < -1e-6) t = Math.min(t, (m - px2) / ux);
      if (uy > 1e-6) t = Math.min(t, (MAP_H - m - py2) / uy);
      if (uy < -1e-6) t = Math.min(t, (m - py2) / uy);
      return Math.max(40, t - r - 6);
    };
    let pairIdx = 0;
    for (const l of peerLinks) {
      const a = byId[l.source], b = byId[l.target];
      const aDone = peerPlaced.has(a.id), bDone = peerPlaced.has(b.id);
      if (aDone && bDone) continue;
      if (!aDone && !bDone) {
        // Unique angle per pair AND a stratified sideways offset from centre: every
        // peer line is its own separated CHORD — none can overlap another's course
        // or run the same exact direction, with real space kept between them.
        const th = axis0 + pairIdx * slotW + (hash01(a.id + b.id, 57) - 0.5) * slotW * 0.4;
        const off = (((pairIdx + 0.5) / P) - 0.5) * 2 * maxOff;
        pairIdx++;
        const ux = Math.cos(th), uy = Math.sin(th);
        const bx = cX + (-uy) * off, by = cY + ux * off;     // chord base, shifted off-centre
        const f = 0.88 + hash01(a.id, 59) * 0.08;            // peers own the OUTERMOST ring
        const tA = reachFrom(bx, by, ux, uy, a.r) * f;
        const tB = reachFrom(bx, by, -ux, -uy, b.r) * f;
        a.x = bx + ux * tA; a.y = by + uy * tA;
        b.x = bx - ux * tB; b.y = by - uy * tB;
        peerPlaced.add(a.id); peerPlaced.add(b.id);
      } else {                                               // chain: place opposite the fixed one
        const done = aDone ? a : b, todo = aDone ? b : a;
        let ux = done.x - cX, uy = done.y - cY;
        const L2 = Math.hypot(ux, uy) || 1; ux /= L2; uy /= L2;
        const f = 0.88 + hash01(todo.id, 59) * 0.08;
        todo.x = cX - ux * edgeR(-ux, -uy, todo.r) * f;
        todo.y = cY - uy * edgeR(-ux, -uy, todo.r) * f;
        peerPlaced.add(todo.id);
      }
    }
    for (const id of peerPlaced) {                           // elbow their long hub-spokes too
      const n = byId[id];
      const t = Math.hypot(n.x - hx, n.y - hy);
      if (t > 0.5 * Math.min(MAP_W, MAP_H)) {
        const ux = (n.x - hx) / t, uy = (n.y - hy) / t;
        const lat = (hash01(n.id, 51) - 0.5) * 2 * Math.min(90, t * 0.16);
        n.viaX = hx + ux * t * 0.55 - uy * lat;
        n.viaY = hy + uy * t * 0.55 + ux * lat;
      } else { n.viaX = undefined; n.viaY = undefined; }
    }

    // Placement bands INVERT the old near-hub rule: strong results (≥30%
    // certainty, plus labelled exchanges) go OUT toward the edges where their
    // big bubbles and labels have room, and the small low-certainty dots fill
    // the ring in between. Long spokes get an ELBOW — the endpoint swings
    // laterally off the pure ray into empty space, and the line bends to follow.
    const place2 = (n, ang, f) => {
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const maxT = Math.max(90, boundaryT(ux, uy) - n.r - 4);
      const t = Math.min(maxT, Math.max(Math.min(90, maxT * 0.3), f * maxT));
      let px = hx + ux * t, py = hy + uy * t;
      if (t > 0.5 * Math.min(MAP_W, MAP_H)) {
        const lat = (hash01(n.id, 51) - 0.5) * 2 * Math.min(150, t * 0.34);   // lateral swing
        px += -uy * lat; py += ux * lat;
        n.viaX = hx + ux * t * 0.55; n.viaY = hy + uy * t * 0.55;             // elbow point on the ray
      } else { n.viaX = undefined; n.viaY = undefined; }
      n.x = px; n.y = py;
    };
    // Each band gets EVEN angular slots around the full circle (ordered by the
    // settled angle so the organic arrangement survives, then re-spaced) — nodes
    // can no longer clump into one sector. Radius still follows certainty rank.
    const spreadBand = (band, fBase, fRange, fJit, phase) => {
      const K = Math.max(1, band.length);
      const fById = {};
      [...band].sort((a, b) => confOf(a) - confOf(b)).forEach((n, i) => {
        fById[n.id] = fBase + ((i + 0.5) / K) * fRange + (hash01(n.id, 47) - 0.5) * fJit;
      });
      [...band].sort((a, b) => Math.atan2(a.y - hy, a.x - hx) - Math.atan2(b.y - hy, b.x - hx))
        .forEach((n, i) => {
          const ang = phase + ((i + 0.5) / K) * Math.PI * 2 + (hash01(n.id, 67) - 0.5) * (Math.PI * 2 / K) * 0.6;
          place2(n, ang, fById[n.id]);
        });
    };
    const bandable = reals.filter(n => !peerPlaced.has(n.id));   // peer pairs already pinned
    const strong = bandable.filter(n => confOf(n) >= 30);
    const weak = bandable.filter(n => confOf(n) < 30);
    const ph0 = hash01(self.id, 63) * Math.PI * 2;
    spreadBand(strong, 0.52, 0.26, 0.08, ph0);
    spreadBand(weak, 0.24, 0.30, 0.10, ph0 + Math.PI / Math.max(1, Math.max(strong.length, weak.length)));

    // Short collision relax so remapped nodes never overlap (hub pinned).
    for (let it = 0; it < 70; it++) {
      for (let a = 0; a < reals.length; a++) {
        for (let b = a + 1; b < reals.length; b++) {
          const p = reals[a], q2 = reals[b];
          let dx = p.x - q2.x, dy = p.y - q2.y;
          let d = Math.hypot(dx, dy) || 0.01;
          const minD = p.r + q2.r + 22 + Math.min(22, Math.max(0, N - 14))
            + ((peerPlaced.has(p.id) || peerPlaced.has(q2.id)) ? 16 : 0);   // peers get extra clearance
          if (d < minD) {
            const push = (minD - d) / 2;
            const ux = dx / d, uy = dy / d;
            p.x += ux * push; p.y += uy * push;
            q2.x -= ux * push; q2.y -= uy * push;
          }
        }
      }
      for (const p of reals) {                          // and clear of the hub bubble
        const dx = p.x - self.x, dy = p.y - self.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const minD = p.r + self.r + 30;
        if (d < minD) { p.x += (dx / d) * (minD - d); p.y += (dy / d) * (minD - d); }
      }
    }
  }

  // Drop infrastructure clusters into the emptiest regions of the canvas. Because
  // the real layout above ignored them, toggling infrastructure on/off never resets
  // the arrangement — the clusters simply appear/disappear in their reserved gaps.
  if (clusters.length) {
    const GX = 6, GY = 5, cells = [];
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const px = (gx + 0.5) / GX * MAP_W, py = (gy + 0.5) / GY * MAP_H;
      let nearest = 1e9;
      for (const n of [self, ...reals]) { const dd = Math.hypot(n.x - px, n.y - py) - n.r; if (dd < nearest) nearest = dd; }
      cells.push({ px, py, score: nearest });
    }
    cells.sort((a, b) => b.score - a.score);              // emptiest cells first
    clusters.forEach((n, i) => { const c = cells[Math.min(i, cells.length - 1)]; n.x = c.px; n.y = c.py; });
    for (let it = 0; it < 90; it++) {                     // settle clusters off everything (reals pinned)
      for (const p of clusters) {
        for (const q of nodes) {
          if (q === p) continue;
          let dx = p.x - q.x, dy = p.y - q.y;
          let d = Math.hypot(dx, dy) || 0.01;
          const minD = p.r + q.r + 16;
          if (d < minD) { const push = (minD - d) * 0.5; p.x += (dx / d) * push; p.y += (dy / d) * push; }
        }
      }
    }
  }

  for (const n of nodes) {
    if (n.self) continue;
    n.x = Math.max(n.r + 8, Math.min(MAP_W - n.r - 8, n.x));
    n.y = Math.max(n.r + 8, Math.min(MAP_H - n.r - 8, n.y));
  }
}

function renderMapSVG(nodes, links) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const groupsUsed = [...new Set(nodes.map(n => n.group))];

  // SOLID bubbles with a glossy highlight (lighter center → solid edge, all
  // opacity 1) so they read cleanly over the connection lines.
  let defs = "";
  for (const g of groupsUsed) {
    const col = GROUP_COLOR[g] || "#666";
    defs += `<radialGradient id="grad-${g}" cx="36%" cy="30%" r="82%">`
      + `<stop offset="0%" stop-color="${lighten(col, 0.42)}" stop-opacity="1"/>`
      + `<stop offset="52%" stop-color="${col}" stop-opacity="1"/>`
      + `<stop offset="100%" stop-color="${lighten(col, -0.18)}" stop-opacity="1"/>`
      + `</radialGradient>`;
  }
  defs += `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">`
    + `<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  defs += `<radialGradient id="mapbg" cx="50%" cy="42%" r="75%">`
    + `<stop offset="0%" stop-color="#0c1016"/><stop offset="100%" stop-color="#050506"/></radialGradient>`;

  // Constellation edges: clean STRAIGHT lines — no curves, no noise. Each line to
  // the tracked wallet is COLOURED BY DIRECTION (green = inflow, purple = outflow,
  // teal = two-way) with a chevron pointing the way value flows. Interactions
  // BETWEEN other wallets get a SOLID pink line (its own colour, not dashed).
  // Line thickness grows with the number of transfers, so recurring links read
  // as heavier.
  const centerMax = Math.max(...links.filter(l => !l.peer).map(l => l.w), 1);
  const peerMax = Math.max(...links.filter(l => l.peer).map(l => l.w), 1);
  // A small triangle at fraction `at` along s→t, pointing along the flow.
  const chevron = (s, t, at, sign, col, sw) => {
    let ux = t.x - s.x, uy = t.y - s.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
    ux *= sign; uy *= sign;                              // +1 = s→t, -1 = t→s
    const mx = s.x + (t.x - s.x) * at, my = s.y + (t.y - s.y) * at;
    const px = -uy, py = ux, z = 5 + (sw || 2) * 1.7;    // arrowhead grows with line thickness
    // Arrows stay FULLY OPAQUE with a dark outline (lines are semi-transparent, the
    // direction marker must not be) — solid and slightly larger for readability.
    return `<path d="M${(mx + ux * z).toFixed(1)},${(my + uy * z).toFixed(1)} `
      + `L${(mx - ux * z + px * z * 0.7).toFixed(1)},${(my - uy * z + py * z * 0.7).toFixed(1)} `
      + `L${(mx - ux * z - px * z * 0.7).toFixed(1)},${(my - uy * z - py * z * 0.7).toFixed(1)} Z" fill="${col}" fill-opacity="1" stroke="#05070a" stroke-width="1" stroke-linejoin="round"/>`;
  };
  let peerEdges = "", edges = "", arrows = "", peerArrows = "";
  for (const l of links) {
    const s = nodes.find(n => n.id === l.source), t = nodes.find(n => n.id === l.target);
    if (!s || !t) continue;
    if (l.peer) {
      // Interaction between two OTHER counterparties — solid pink line, thicker when
      // they transacted more, directional chevrons (both ways when bidirectional).
      const psw = 0.9 + 3.4 * Math.pow(l.w / peerMax, 0.7);
      peerEdges += `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="${PEER_COLOR}" stroke-opacity="0.55" stroke-width="${psw.toFixed(2)}" stroke-linecap="round"/>`;
      const ab = l.ab || 0, ba = l.ba || 0;   // ab = source→target, ba = target→source
      if (ab > 0) peerArrows += chevron(s, t, 0.64, 1, PEER_COLOR, psw);
      if (ba > 0) peerArrows += chevron(s, t, 0.36, -1, PEER_COLOR, psw);
      if (!ab && !ba) peerArrows += chevron(s, t, 0.5, 1, PEER_COLOR, psw);
      continue;
    }
    // source is the tracked wallet; target is the counterparty. Colour by the
    // counterparty's net flow; chevron points the way value moved; thickness by count.
    const cp = t.self ? s : t;
    const hub = t.self ? t : s;
    const { col, flow } = edgeDir(cp.net != null ? cp.net : 0);
    const sw = 0.8 + 4.4 * Math.pow(l.w / centerMax, 0.72);   // recurring transfers → thicker
    if (cp.viaX != null && !cp.cluster) {
      // Long spoke with an ELBOW: hub → bend point → node, so the endpoint can sit
      // laterally off the ray and the space between spokes gets used.
      edges += `<path d="M${hub.x.toFixed(1)},${hub.y.toFixed(1)} L${cp.viaX.toFixed(1)},${cp.viaY.toFixed(1)} L${cp.x.toFixed(1)},${cp.y.toFixed(1)}" fill="none" stroke="${col}" stroke-opacity="0.42" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (flow !== 0) arrows += chevron({ x: cp.viaX, y: cp.viaY }, cp, 0.6, flow, col, sw); // on the outer segment
    } else {
      edges += `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="${col}" stroke-opacity="0.42" stroke-width="${sw.toFixed(2)}" stroke-linecap="round"/>`;
      if (flow !== 0 && !cp.cluster) arrows += chevron(s, t, 0.62, flow, col, sw); // +1 out (self→cp), -1 in (cp→self)
    }
  }

  // Faint deterministic starfield behind everything, for the constellation feel.
  let stars = "";
  const starN = Math.round((MAP_W * MAP_H) / 8500);
  for (let i = 0; i < starN; i++) {
    const sx = hash01("star" + i, 3) * MAP_W, sy = hash01("star" + i, 7) * MAP_H;
    const sr = 0.4 + hash01("star" + i, 11) * 1.0;
    const so = 0.05 + hash01("star" + i, 13) * 0.20;
    stars += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(2)}" fill="#cfe0ff" fill-opacity="${so.toFixed(2)}"/>`;
  }

  let bubbles = "";
  // The canvas grows with node count but is squeezed into the same panel width —
  // so label font must grow WITH the canvas or dense maps become unreadable when
  // fully zoomed out. LBL keeps the on-screen label size constant at 1× zoom.
  const LBL = Math.max(1, MAP_W / 760);

  // ---- Label placement pre-pass ----
  // Every chip picks the least-colliding spot among below/above/side candidates,
  // scored against ALL node bodies and every chip placed so far (important labels
  // choose first). Deterministic, so re-renders never shuffle labels around.
  const lblPlan = new Map();
  {
    const dense = nodes.length > 26;                     // on busy maps, label the meaningful nodes
    const obstacles = nodes.map(x => ({ x: x.x - x.r, y: x.y - x.r, w: x.r * 2, h: x.r * 2 }));
    const jobs = [];
    nodes.forEach((n, idx) => {
      const showLabel = n.self || n.named || n.cluster || mapLabelsAll
        || !dense || (n.certainty != null && n.certainty >= 30) || n.r >= 17;
      if (!showLabel) return;
      const base = n.cluster ? n.label : (n.named ? `[${n.label}]` : n.label);
      const pct = n.cluster ? ` · ${n.count}` : (n.certainty != null ? ` · ${n.certainty}%` : "");
      const labelText = base + pct;                      // ID/label + certainty% (or member count)
      const fontSize = (n.self ? 12 : 10.5) * LBL;
      // Wrap long labels onto a second line instead of clipping out of the chip.
      const maxW = 190 * LBL;
      const estW = (t) => 10 * LBL + t.length * (fontSize * 0.58);
      let lines = [labelText];
      if (estW(labelText) > maxW) {
        const mid = Math.ceil(labelText.length / 2);
        let cut = labelText.lastIndexOf(" ", mid);
        if (cut < 4) cut = labelText.indexOf(" ", mid);
        if (cut < 4) cut = mid;
        lines = [labelText.slice(0, cut).trim(), labelText.slice(cut).trim()];
        while (lines[1].length > 4 && estW(lines[1]) > maxW) lines[1] = lines[1].slice(0, -2).trimEnd() + "…";
      }
      const lineH = fontSize + 3;
      const chipH = fontSize + 6 + (lines.length - 1) * lineH;
      const chipW = Math.min(maxW, Math.max(...lines.map(estW)));
      jobs.push({ n, idx, lines, fontSize, lineH, chipH, chipW });
    });
    jobs.sort((a, b) => (b.n.self ? 1e9 : (b.n.certainty ?? 55)) - (a.n.self ? 1e9 : (a.n.certainty ?? 55)));
    const inter = (r, s) => Math.max(0, Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x))
                          * Math.max(0, Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y));
    for (const j of jobs) {
      const { n, idx, lines, fontSize, lineH, chipH, chipW } = j;
      const mkc = (cx, topY) => {
        const lx = Math.max(chipW / 2 + 4, Math.min(MAP_W - chipW / 2 - 4, cx));
        const y = Math.max(2, Math.min(MAP_H - chipH - 2, topY));
        return { lx, ly: y + fontSize, rect: { x: lx - chipW / 2, y, w: chipW, h: chipH } };
      };
      const belowY = n.y + n.r + 12 - fontSize;                                  // chip-top when below
      const aboveY = n.y - n.r - 10 - (lines.length - 1) * lineH - fontSize;     // chip-top when above
      const sideY = n.y - chipH / 2;
      const prefAbove = n.self || (!n.cluster && hash01(n.id, 71) < 0.4);        // deterministic first choice
      const stack = [mkc(n.x, prefAbove ? aboveY : belowY), mkc(n.x, prefAbove ? belowY : aboveY),
        mkc(n.x + n.r + 10 + chipW / 2, sideY), mkc(n.x - n.r - 10 - chipW / 2, sideY),
        mkc(n.x, belowY + chipH * 0.8), mkc(n.x, aboveY - chipH * 0.8)];
      let best = stack[0], bestCost = Infinity;
      for (const c of stack) {
        let cost = 0;
        for (let oi = 0; oi < obstacles.length; oi++) {
          if (oi === idx) continue;                       // own node body doesn't count
          cost += inter(c.rect, obstacles[oi]);
        }
        if (cost === 0) { best = c; bestCost = 0; break; }  // first collision-free spot in preference order
        if (cost < bestCost - 1) { bestCost = cost; best = c; }
      }
      lblPlan.set(n.id, { lx: best.lx, ly: best.ly, lines, fontSize, lineH, chipH, chipW });
      obstacles.push(best.rect);                          // later (less important) chips avoid this one
    }
  }

  for (const n of nodes) {
    const col = GROUP_COLOR[n.group] || "#666";
    bubbles += `<g class="mnode" data-id="${esc(n.id)}" style="cursor:grab">`;
    bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + (n.self ? 8 : 5)).toFixed(1)}" fill="${col}" fill-opacity="${n.self ? 0.16 : 0.08}" filter="url(#glow)"/>`;
    bubbles += `<circle class="mbub" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="url(#grad-${n.group})" stroke="${lighten(col, 0.25)}" stroke-width="${n.self ? 2.5 : 1.4}" stroke-opacity="0.95"/>`;
    // bright star-core glint (skipped where a certainty numeral fills the node)
    if (!n.cluster && (n.self || n.r < 19)) bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${Math.max(1.4, n.r * 0.16).toFixed(1)}" fill="#ffffff" fill-opacity="0.85" pointer-events="none"/>`;
    // clusters get a concentric outline to read as "a stack of many"
    if (n.cluster) bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 3.5).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1" stroke-opacity="0.5" stroke-dasharray="2 3"/>`;
    if (n.bundleRisk) bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 3).toFixed(1)}" fill="none" stroke="#ff5d6c" stroke-width="1.2" stroke-opacity="0.7" stroke-dasharray="3 3"/>`;
    if (mapChainSet.has(n.id)) {   // pinned to the investigation chain — beacon in the ACTIVE PALETTE's chain colour: glow + halo + slow-spinning dashed ring + ⛓ badge
      bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 13).toFixed(1)}" fill="${CHAIN_COLOR}" fill-opacity="0.16" filter="url(#glow)" pointer-events="none"/>`;
      bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 8).toFixed(1)}" fill="none" stroke="${CHAIN_COLOR}" stroke-width="5" stroke-opacity="0.22" pointer-events="none"/>`;
      bubbles += `<circle class="chain-ring" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 5).toFixed(1)}" fill="none" stroke="${CHAIN_COLOR}" stroke-width="2.8" stroke-opacity="1" stroke-dasharray="11 6" stroke-linecap="round" pointer-events="none"/>`;
      const bx = n.x + (n.r + 5) * 0.707, by = n.y - (n.r + 5) * 0.707;   // badge at the ring's upper-right
      bubbles += `<g pointer-events="none"><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="8.5" fill="#0b0e13" stroke="${CHAIN_COLOR}" stroke-width="1.5"/>`
        + `<circle cx="${(bx - 2.3).toFixed(1)}" cy="${by.toFixed(1)}" r="2.8" fill="none" stroke="${CHAIN_COLOR}" stroke-width="1.6"/>`
        + `<circle cx="${(bx + 2.3).toFixed(1)}" cy="${by.toFixed(1)}" r="2.8" fill="none" stroke="${CHAIN_COLOR}" stroke-width="1.6"/></g>`;
    }
    if (mapSelection.has(n.id)) bubbles += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 6).toFixed(1)}" fill="none" stroke="#57b8ff" stroke-width="1.7" stroke-opacity="0.95" stroke-dasharray="5 3"/>`;
    if (lblPlan.has(n.id)) {
      const P = lblPlan.get(n.id);
      // mlabel group: zoom counter-scales these around their anchor so labels keep
      // a constant on-screen size (readable at 1×, out of the way when zoomed in).
      bubbles += `<g class="mlabel" data-ax="${P.lx.toFixed(1)}" data-ay="${(P.ly - P.fontSize + P.chipH / 2).toFixed(1)}">`;
      bubbles += `<rect x="${(P.lx - P.chipW / 2).toFixed(1)}" y="${(P.ly - P.fontSize).toFixed(1)}" width="${P.chipW.toFixed(1)}" height="${P.chipH.toFixed(1)}" rx="${Math.min(9 * LBL, P.chipH / 2).toFixed(1)}" fill="#0b0e13" fill-opacity="0.78" stroke="${col}" stroke-opacity="0.4" stroke-width="0.8"/>`;
      P.lines.forEach((t, li2) => {
        bubbles += `<text x="${P.lx.toFixed(1)}" y="${(P.ly + 1.5 + li2 * P.lineH).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${P.fontSize.toFixed(1)}" fill="${n.named || n.self ? "#eafff6" : "#cfd4dc"}" font-family="system-ui,sans-serif" font-weight="${n.named || n.self ? 700 : 500}">${esc(t)}</text>`;
      });
      bubbles += `</g>`;
    }
    // certainty numeral inside big bubbles too (redundant-but-clear)
    if (!n.self && n.certainty != null && n.r >= 19) {
      bubbles += `<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="${Math.min(13, n.r * 0.48).toFixed(1)}" fill="#ffffff" font-family="system-ui,sans-serif" font-weight="800" pointer-events="none">${n.certainty}</text>`;
    }
    bubbles += `</g>`;
  }
  return `<svg id="mapSvg" data-build="${RELEASE_TAG.toString(36)}" viewBox="0 0 ${MAP_W} ${MAP_H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="border-radius:12px">`
    + `<defs>${defs}</defs>`
    + `<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="url(#mapbg)"/>`
    + `<g>${stars}</g><g>${peerEdges}</g><g>${peerArrows}</g><g>${edges}</g><g>${arrows}</g><g>${bubbles}</g></svg>`;
}

let lastMapSVG = "";
let mapNodes = [], mapLinks = [], mapDrag = null, mapMoved = false, mapBound = false, mapPinnedId = null;
let mapSelectMode = false;                 // group-select: click to add, drag to move all, Enter to finish
const mapSelection = new Set();
let mapChainSet = new Set();                // wallet ids pinned to the investigation chain (gold halo)
let mapZoom = 1, mapPanX = 0, mapPanY = 0; // constellation zoom (viewBox-based) + pan
let mapLabelsAll = false;                  // zoomed in ≥1.8× → reveal EVERY label (local density is low)

// Labels keep a CONSTANT on-screen size: zooming in scales the world up, so we
// counter-scale each label chip around its anchor by 1/zoom. Aids navigation —
// zoomed-out labels are readable, zoomed-in labels stay compact instead of huge.
function scaleMapLabels() {
  const svg = $("mapStage")?.querySelector("svg");
  if (!svg) return;
  const s = (1 / mapZoom).toFixed(4);
  svg.querySelectorAll("g.mlabel").forEach(g => {
    const ax = g.getAttribute("data-ax"), ay = g.getAttribute("data-ay");
    g.setAttribute("transform", mapZoom > 1.001 ? `translate(${ax} ${ay}) scale(${s}) translate(-${ax} -${ay})` : "");
  });
}

// Apply the current zoom/pan as the SVG viewBox (clamped so the view can't
// wander far off-canvas). Zoom never touches node data — pure viewport.
function applyMapView() {
  const svg = $("mapStage")?.querySelector("svg");
  if (!svg) return;
  // Crossing the reveal threshold changes WHICH labels exist → re-render once.
  const all = mapZoom >= 1.8;
  if (all !== mapLabelsAll) { mapLabelsAll = all; rerenderMap(); return; }
  const w = MAP_W / mapZoom, h = MAP_H / mapZoom;
  mapPanX = Math.max(-20, Math.min(MAP_W - w + 20, mapPanX));
  mapPanY = Math.max(-20, Math.min(MAP_H - h + 20, mapPanY));
  svg.setAttribute("viewBox", `${mapPanX.toFixed(1)} ${mapPanY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  scaleMapLabels();
  const zl = $("zoomLevel");
  if (zl) zl.textContent = mapZoom.toFixed(1).replace(/\.0$/, "") + "×";
}

// Recompute a node's elbow after it moves: SAME deterministic lateral angle
// (hash-seeded per address), applied to the new position — dragging no longer
// resets the bend to a straight line.
function refreshVia(n) {
  if (!n || n.self || n.cluster) return;
  const self = mapNodes.find(x => x.self);
  if (!self) return;
  const t = Math.hypot(n.x - self.x, n.y - self.y);
  if (t > 0.5 * Math.min(MAP_W, MAP_H)) {
    const ux = (n.x - self.x) / t, uy = (n.y - self.y) / t;
    const lat = (hash01(n.id, 51) - 0.5) * 2 * Math.min(150, t * 0.34);
    n.viaX = self.x + ux * t * 0.55 - uy * lat;
    n.viaY = self.y + uy * t * 0.55 + ux * lat;
  } else { n.viaX = undefined; n.viaY = undefined; }
}
let mapMeta = { peerCount: 0, hidden: 0, infraTotal: 0 };

function pinMapTip(n) {
  const tip = $("mapTip");
  if (!tip) return;
  mapPinnedId = n.id;
  const col = GROUP_COLOR[n.group] || "#888";
  const tracked = ((lastSettings?.wallets) || []).some(w => w.address === n.id);
  const bar = n.certainty != null ? `<div class="tip-bar"><span style="width:${n.certainty}%;background:${col}"></span></div>` : "";
  tip.innerHTML =
    `<div class="tip-name" style="color:${n.self ? GROUP_COLOR.self : col}">${n.self ? "◎ " : ""}${(n.named ? `[${n.label}]` : n.label)}</div>`
    + `<div class="tip-grp">${GROUP_LABEL[n.group]}${n.clsLabel ? ` · ${n.clsLabel}` : ""}${(lastStats && lastStats.symbolMap && lastStats.symbolMap[n.id]) ? ` · $${lastStats.symbolMap[n.id]}` : ""}</div>`
    + (n.certainty != null ? `<div class="tip-row"><span>Certainty</span><b>${n.certainty}%</b></div>${bar}` : "")
    + `<div class="tip-actions">`
    + `<button class="tip-btn tip-copy">Copy</button>`
    + (!n.self && !tracked ? `<button class="tip-btn tip-track">＋ Track &amp; name</button>` : (tracked ? `<span class="tip-tracked">✓ tracked</span>` : ""))
    + (!n.self ? `<button class="tip-btn tip-chain">${mapChainSet.has(n.id) ? "⛓ in chain" : "⛓ chain"}</button>` : "")
    + `<button class="tip-btn tip-close">✕</button>`
    + `</div>`;
  tip.classList.add("pinned");
  tip.classList.remove("hidden");
  // position near the node (svg coords → stage px)
  const stage = $("mapStage"), svg = stage.querySelector("svg");
  if (svg) {
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / (MAP_W / mapZoom) || 1;
    const px = (n.x - mapPanX) * scale, py = (n.y - mapPanY) * scale;
    let x = px + 14, y = py + 14;
    if (x + 210 > rect.width) x = px - 214;
    tip.style.left = Math.max(6, x) + "px"; tip.style.top = Math.max(6, y) + "px";
  }
  tip.querySelector(".tip-copy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(n.id);
    $("statusLine").textContent = "Address copied.";
    setTimeout(() => ($("statusLine").textContent = ""), 1500);
  });
  tip.querySelector(".tip-close")?.addEventListener("click", () => unpinMapTip());
  tip.querySelector(".tip-chain")?.addEventListener("click", async () => {
    await addToChain(n.id, (n.named ? n.label : ""));
    mapChainSet.add(n.id);
    rerenderMap();
    unpinMapTip();
  });
  tip.querySelector(".tip-track")?.addEventListener("click", () => {
    const actions = tip.querySelector(".tip-actions");
    actions.innerHTML = `<input class="tip-name-in" placeholder="Name (optional)"><button class="tip-btn tip-name-save">Track</button>`;
    const inp = actions.querySelector(".tip-name-in");
    const save = async () => {
      const d = await store.get();
      if (!d.wallets.some(w => w.address === n.id)) {
        d.wallets.push({ address: n.id, added: Date.now(), name: inp.value.trim() });
        await store.set({ wallets: d.wallets });
        if (lastSettings) lastSettings.wallets = d.wallets;
        renderWalletList();
      }
      $("statusLine").textContent = "Tracked" + (inp.value.trim() ? ` as [${inp.value.trim()}]` : "") + ".";
      setTimeout(() => ($("statusLine").textContent = ""), 1800);
      unpinMapTip();
    };
    actions.querySelector(".tip-name-save").addEventListener("click", save);
    inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") save(); });
    inp.focus();
  });
}
function unpinMapTip() {
  mapPinnedId = null;
  const tip = $("mapTip");
  if (tip) { tip.classList.remove("pinned"); tip.classList.add("hidden"); }
}

function rerenderMap() {
  // Apply the confidence filter at RENDER time only — hidden nodes keep their
  // positions so the arrangement never resets when the % changes.
  const thr = mapLowConfThresh;
  // Render-time filters — BOTH the low-% filter and the infrastructure toggle hide
  // nodes without touching their positions, so neither one ever resets the layout.
  const visNodes = mapNodes.filter(n => {
    if (n.self) return true;
    if (n.cluster) return mapShowInfra;                 // infra clusters only when toggled on
    if (n.certainty == null) return true;               // exchanges / funding sources
    return n.certainty >= thr;                          // low-confidence filter
  });
  const visIds = new Set(visNodes.map(n => n.id));
  const visLinks = mapLinks.filter(l => visIds.has(l.source) && visIds.has(l.target));
  lastMapSVG = renderMapSVG(visNodes, visLinks);
  const stage = $("mapStage");
  const tip = stage.querySelector("#mapTip");
  const holder = document.createElement("div");
  holder.innerHTML = lastMapSVG;
  stage.replaceChildren(holder.firstChild, tip || makeTip());
  attachNodeHandlers();
  applyMapView();            // re-apply zoom/pan — re-renders never reset the viewport
  const lowHidden = mapNodes.filter(n => !n.self && !n.cluster && n.certainty != null && n.certainty < thr).length;
  renderMapLegend(visNodes, lowHidden);
}

function renderMapLegend(visNodes, lowConfHidden) {
  const present = [...new Set(visNodes.map(n => n.group))];
  const dirBit =
    `<span class="leg"><span class="leg-line" style="background:${DIR_IN}"></span>inflow → you</span>`
    + `<span class="leg"><span class="leg-line" style="background:${DIR_OUT}"></span>you → outflow</span>`
    + `<span class="leg"><span class="leg-line" style="background:${DIR_BOTH}"></span>two-way</span>`;
  const peerBit = mapMeta.peerCount
    ? ` <span class="leg"><span class="leg-line" style="background:${PEER_COLOR}"></span>between other wallets (${mapMeta.peerCount})</span>`
    : "";
  const infoBit = mapMeta.infraTotal
    ? (mapShowInfra
        ? ` <span class="leg" style="color:var(--ink-3)">${mapMeta.infraTotal} infrastructure grouped into clusters</span>`
        : ` <span class="leg" style="color:var(--ink-3)">${mapMeta.infraTotal} infrastructure/minor hidden — use “Show infrastructure”</span>`)
    : "";
  const lowBit = mapLowConfThresh > 0 && lowConfHidden
    ? ` <span class="leg" style="color:var(--ink-3)">${lowConfHidden} below ${mapLowConfThresh}% hidden</span>` : "";
  const chainN = visNodes.filter(n => mapChainSet.has(n.id)).length;
  const chainBit = chainN ? ` <span class="leg"><span class="leg-dot" style="background:transparent;box-shadow:0 0 0 2px ${CHAIN_COLOR}"></span>investigation chain (${chainN})</span>` : "";
  const groupBit = present.map(g =>
    `<span class="leg"><span class="leg-dot" style="background:${GROUP_COLOR[g]}"></span>${GROUP_LABEL[g]}</span>`).join("");
  $("mapLegend").innerHTML = `<span class="leg-group">lines: ${dirBit}${peerBit}</span><span class="leg-group">nodes: ${groupBit}${chainBit}</span>${infoBit}${lowBit}`;
}
function makeTip() { const t = document.createElement("div"); t.id = "mapTip"; t.className = "map-tip hidden"; return t; }

function attachNodeHandlers() {
  const tip = $("mapTip");
  const nodeById = Object.fromEntries(mapNodes.map(n => [n.id, n]));
  $("mapStage").querySelectorAll(".mnode").forEach(g => {
    const n = nodeById[g.getAttribute("data-id")];
    if (!n) return;
    g.addEventListener("mouseenter", () => {
      if (mapDrag || mapPinnedId) return;
      const col = GROUP_COLOR[n.group] || "#888";
      if (n.cluster) {
        const sample = (n.members || []).slice(0, 6).map(m => `${m.addr.slice(0, 4)}…${m.addr.slice(-4)}${m.label ? ` — ${m.label}` : ""}`).join("<br>");
        tip.innerHTML =
          `<div class="tip-name" style="color:${col}">${n.clusterCat}</div>`
          + `<div class="tip-grp">${n.count} address(es) · ${n.totalTx} transfer(s) total</div>`
          + `<div class="tip-sig">${sample}${n.members && n.members.length > 6 ? `<br>+ ${n.members.length - 6} more…` : ""}</div>`
          + `<div class="tip-hint">grouped infrastructure — drag to move</div>`;
        tip.classList.remove("hidden");
        return;
      }
      const bar = n.certainty != null ? `<div class="tip-bar"><span style="width:${n.certainty}%;background:${col}"></span></div>` : "";
      const tracked = ((lastSettings?.wallets) || []).some(w => w.address === n.id);
      tip.innerHTML =
        `<div class="tip-name" style="color:${n.self ? GROUP_COLOR.self : col}">${n.self ? "◎ " : ""}${(n.named ? `[${n.label}]` : n.label)}</div>`
        + `<div class="tip-grp">${GROUP_LABEL[n.group]}${n.clsLabel ? ` · ${n.clsLabel}` : ""}${(lastStats && lastStats.symbolMap && lastStats.symbolMap[n.id]) ? ` · $${lastStats.symbolMap[n.id]}` : ""}</div>`
        + (n.certainty != null ? `<div class="tip-row"><span>Certainty</span><b>${n.certainty}%</b></div>${bar}` : "")
        + (n.bundleScore ? `<div class="tip-row"><span>Bundle</span><b style="color:#ff8f8e">${n.bundleScore}%</b></div>` : "")
        + (n.count ? `<div class="tip-row"><span>Transfers</span><b>${n.count} · ${n.inN} in / ${n.outN} out</b></div>` : "")
        + (n.topSig ? `<div class="tip-sig">${String(n.topSig).replace(/</g, "&lt;")}</div>` : "")
        + `<div class="tip-hint">drag to move · click to ${n.self ? "copy" : (tracked ? "copy" : "copy / track")}</div>`;
      tip.classList.remove("hidden");
    });
    g.addEventListener("mouseleave", () => { if (!mapDrag && !mapPinnedId) tip.classList.add("hidden"); });
    g.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      mapDrag = n; mapMoved = false;
      tip.classList.add("hidden");
      $("mapStage").querySelector("svg")?.classList.add("dragging");
    });
  });
}

// Stage-level move/up (bound once) so a full re-render mid-drag never severs the gesture.
function bindMapDrag() {
  if (mapBound) return; mapBound = true;
  const stage = $("mapStage");
  const tip = () => $("mapTip");
  let marquee = null;   // drag-select rectangle (select mode): {x0,y0 in svg units, el}
  let panDrag = null;   // background pan while zoomed: {cx, cy} last client coords
  const toSvg = (ev) => {
    const svg = stage.querySelector("svg"); if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: mapPanX + (ev.clientX - rect.left) / rect.width * (MAP_W / mapZoom),
      y: mapPanY + (ev.clientY - rect.top) / rect.height * (MAP_H / mapZoom),
    };
  };
  const marqueeBox = (ev) => {
    const p = toSvg(ev); if (!p) return null;
    return { x0: Math.min(marquee.x0, p.x), y0: Math.min(marquee.y0, p.y), x1: Math.max(marquee.x0, p.x), y1: Math.max(marquee.y0, p.y) };
  };
  const drawMarquee = (box) => {
    const svg = stage.querySelector("svg"); if (!svg) return;
    const rect = svg.getBoundingClientRect(), host = stage.getBoundingClientRect();
    const scale = rect.width / (MAP_W / mapZoom) || 1;
    marquee.el.style.left = (rect.left - host.left + (box.x0 - mapPanX) * scale) + "px";
    marquee.el.style.top = (rect.top - host.top + (box.y0 - mapPanY) * scale) + "px";
    marquee.el.style.width = ((box.x1 - box.x0) * scale) + "px";
    marquee.el.style.height = ((box.y1 - box.y0) * scale) + "px";
  };
  stage.addEventListener("pointermove", (ev) => {
    if (marquee) {                       // rubber-band select: grow the rectangle
      const box = marqueeBox(ev);
      if (box) drawMarquee(box);
      return;
    }
    if (panDrag) {                       // zoomed-in background pan
      const svg = stage.querySelector("svg");
      if (svg) {
        const rect = svg.getBoundingClientRect();
        mapPanX -= (ev.clientX - panDrag.cx) / rect.width * (MAP_W / mapZoom);
        mapPanY -= (ev.clientY - panDrag.cy) / rect.height * (MAP_H / mapZoom);
        panDrag = { cx: ev.clientX, cy: ev.clientY };
        applyMapView();
      }
      return;
    }
    if (mapDrag) {
      const p = toSvg(ev); if (!p) return;
      const nx = Math.max(mapDrag.r + 4, Math.min(MAP_W - mapDrag.r - 4, p.x));
      const ny = Math.max(mapDrag.r + 4, Math.min(MAP_H - mapDrag.r - 4, p.y));
      if (mapSelectMode && mapSelection.has(mapDrag.id)) {
        // group move: shift every selected node by the same delta
        const dx = nx - mapDrag.x, dy = ny - mapDrag.y;
        for (const id of mapSelection) {
          const nn = mapNodes.find(n2 => n2.id === id);
          if (!nn) continue;
          nn.x = Math.max(nn.r + 4, Math.min(MAP_W - nn.r - 4, nn.x + dx));
          nn.y = Math.max(nn.r + 4, Math.min(MAP_H - nn.r - 4, nn.y + dy));
          refreshVia(nn);                                // keep the SAME elbow angle at the new spot
        }
      } else {
        mapDrag.x = nx; mapDrag.y = ny;
        refreshVia(mapDrag);
      }
      mapMoved = true;
      rerenderMap();
      return;
    }
    // move the tooltip with the cursor when hovering (not when pinned)
    const t = tip(); if (!t || t.classList.contains("hidden") || mapPinnedId) return;
    const rect = stage.getBoundingClientRect();
    let x = ev.clientX - rect.left + 16, y = ev.clientY - rect.top + 16;
    if (x + 220 > rect.width) x = ev.clientX - rect.left - 224;
    if (y + (t.offsetHeight || 120) > rect.height) y = rect.height - (t.offsetHeight || 120) - 6;
    t.style.left = Math.max(6, x) + "px"; t.style.top = Math.max(6, y) + "px";
  });
  const endDrag = (ev) => {
    if (marquee) {                       // finish rubber-band
      const box = marqueeBox(ev);
      if (box) {
        const tiny = (box.x1 - box.x0) < 6 && (box.y1 - box.y0) < 6;
        if (tiny) {
          // plain click on empty canvas = CLEAR the current selection so the
          // user can start another one (Enter is what completes the action)
          mapSelection.clear();
        } else {
          for (const n of mapNodes) {
            if (n.self) continue;
            if (n.x >= box.x0 && n.x <= box.x1 && n.y >= box.y0 && n.y <= box.y1) mapSelection.add(n.id);
          }
        }
      }
      marquee.el.remove(); marquee = null;
      rerenderMap();
      return;
    }
    if (mapDrag && !mapMoved && mapSelectMode && !mapDrag.self) {
      // group-select mode: a click toggles the node in/out of the selection
      if (mapSelection.has(mapDrag.id)) mapSelection.delete(mapDrag.id);
      else mapSelection.add(mapDrag.id);
      rerenderMap();
    } else if (mapDrag && !mapMoved && !mapDrag.self && !mapDrag.cluster) {
      // click (no drag) on a wallet node → pin an actions popover (copy / track)
      pinMapTip(mapDrag);
    }
    if (mapDrag) stage.querySelector("svg")?.classList.remove("dragging");
    mapDrag = null;
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointerleave", () => {
    if (mapDrag) { stage.querySelector("svg")?.classList.remove("dragging"); mapDrag = null; }
    if (marquee) { marquee.el.remove(); marquee = null; }
  });
  stage.addEventListener("pointerdown", (ev) => {
    // click on empty stage background dismisses a pinned popover
    if (mapPinnedId && !ev.target.closest(".mnode") && !ev.target.closest("#mapTip")) unpinMapTip();
    // select mode: dragging on EMPTY canvas starts a rubber-band selection
    if (mapSelectMode && !ev.target.closest(".mnode") && !ev.target.closest("#mapTip")) {
      const p = toSvg(ev); if (!p) return;
      const el = document.createElement("div");
      el.className = "map-marquee";
      stage.appendChild(el);
      marquee = { x0: p.x, y0: p.y, el };
    } else if (!mapSelectMode && mapZoom > 1 && !ev.target.closest(".mnode") && !ev.target.closest("#mapTip")) {
      panDrag = { cx: ev.clientX, cy: ev.clientY };   // zoomed: drag background to pan
    }
  });
  stage.addEventListener("pointerup", () => { panDrag = null; });
  // Wheel = zoom around the cursor (1×–4×). Pure viewport — nothing moves.
  stage.addEventListener("wheel", (ev) => {
    const svg = stage.querySelector("svg"); if (!svg) return;
    ev.preventDefault();
    const rect = svg.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width, fy = (ev.clientY - rect.top) / rect.height;
    const sx = mapPanX + fx * (MAP_W / mapZoom), sy = mapPanY + fy * (MAP_H / mapZoom);
    mapZoom = Math.max(1, Math.min(4, mapZoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (mapZoom <= 1.001) { mapZoom = 1; mapPanX = 0; mapPanY = 0; }
    else { mapPanX = sx - fx * (MAP_W / mapZoom); mapPanY = sy - fy * (MAP_H / mapZoom); }
    applyMapView();
  }, { passive: false });
}

// Full (re)build + fresh layout — this is the "original arrangement" / Reset path.
function openBubbleMap() {
  if (!lastStats) return;
  const built = buildMapData(lastStats, lastSettings || {});
  // Grow the canvas with crowding so bubbles have room to breathe.
  const n = built.nodes.length;
  const grow = Math.min(2.6, Math.max(1.15, Math.sqrt(n / 9)));  // every map gets extra room; dense ones much more
  MAP_W = Math.round(760 * grow);
  MAP_H = Math.round(560 * grow);
  const { nodes, links, hidden, infraTotal, peerCount } = built;
  layoutMap(nodes, links);
  mapNodes = nodes; mapLinks = links; mapDrag = null; mapPinnedId = null;
  mapChainSet = new Set(((lastSettings?.chain) || []).map(c => c.address));   // chain halos
  mapSelectMode = false; mapSelection.clear();
  $("mapSelectBtn").textContent = "Select group";
  $("mapSelectBtn").classList.remove("active");
  mapZoom = 1; mapPanX = 0; mapPanY = 0; mapLabelsAll = false;
  mapMeta = { peerCount, hidden, infraTotal };
  $("mapStage").replaceChildren(makeTip());
  bindMapDrag();
  rerenderMap();            // renders + builds the legend (with the current % filter)
  const nm = (lastSettings?.wallets || []).find(w => w.address === currentAddress)?.name;
  $("mapTitle").textContent = `Constellation — ${nm ? `[${nm}]` : shortAddr(currentAddress || "")}`;
  $("infraToggle").textContent = mapShowInfra ? "Hide infrastructure" : "Show infrastructure";
  $("infraToggle").classList.toggle("active", mapShowInfra);
  $("lowConfInput").value = mapLowConfThresh > 0 ? String(mapLowConfThresh) : "";
  $("mapPaletteSel").value = mapPaletteName;
  $("mapPanel").classList.remove("hidden");
  $("mapPanel").scrollTop = 0;
}

function saveMapSVG() {
  if (!lastMapSVG) return;
  const blob = new Blob([lastMapSVG], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `constellation-${shortAddr(currentAddress || "wallet").replace(/[^\w]/g, "")}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- self-update (File System Access API) ----------
// Chrome won't let an unpacked extension rewrite its own files from ordinary
// JS. The File System Access API can — but only on a directory the user grants.
// So: remember a read/write handle to the install folder (asked once), then
// "Update from folder" copies a chosen new-version folder into it and reloads.
const IDB_NAME = "wt-fs", IDB_STORE = "handles";
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
    tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(val, key);
    tx.onsuccess = () => res(); tx.onerror = () => rej(tx.error);
  });
}

async function ensurePermission(handle, mode) {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

async function readManifest(dirHandle) {
  const fh = await dirHandle.getFileHandle("manifest.json");
  return JSON.parse(await (await fh.getFile()).text());
}

async function copyDir(src, dst) {
  for await (const [name, entry] of src.entries()) {
    if (name.startsWith(".")) continue;
    if (entry.kind === "file") {
      const file = await entry.getFile();
      const w = await (await dst.getFileHandle(name, { create: true })).createWritable();
      await w.write(await file.arrayBuffer());
      await w.close();
    } else if (entry.kind === "directory") {
      const sub = await dst.getDirectoryHandle(name, { create: true });
      await copyDir(entry, sub);
    }
  }
}

function cmpVer(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i] || 0, 10)) - (parseInt(pb[i] || 0, 10));
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const setUpStatus = (msg, ok) => {
  const el = $("updateStatus");
  el.textContent = msg;
  el.style.color = ok === true ? "var(--good)" : ok === false ? "var(--critical)" : "var(--ink-3)";
};

// One-time: link the folder Chrome actually loaded this extension from.
// This MUST be the exact directory shown as the extension's path in
// chrome://extensions — otherwise files are copied somewhere reload() won't read.
// Identify our extension folder by its FILES, never by the manifest name — the
// display name can change between versions (e.g. a rebrand), and matching on it
// is what used to break updates across a rename.
async function hasFile(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}
async function looksLikeOurExtension(dir) {
  return (await hasFile(dir, "popup.js")) && (await hasFile(dir, "popup.html"));
}
async function linkInstallFolder() {
  const myManifest = chrome.runtime.getManifest();
  if (!window.showDirectoryPicker) {
    setUpStatus("This browser build doesn't expose folder access here — use “Reload now” after replacing files manually.", false);
    return null;
  }
  setUpStatus("Select the folder Chrome loaded this extension from (its Path in chrome://extensions)…");
  const dir = await window.showDirectoryPicker({ id: "wt-install", mode: "readwrite" });
  let m;
  try { m = await readManifest(dir); }
  catch { setUpStatus("That folder has no manifest.json — it isn't the extension folder.", false); return null; }
  if (!(await looksLikeOurExtension(dir))) { setUpStatus("That folder doesn't look like this extension (no popup.js / popup.html). Pick the extension's own folder.", false); return null; }
  // Sanity: the linked folder's manifest version should match what's running.
  if (m.version !== myManifest.version) {
    setUpStatus(`Linked folder is v${m.version} but the running extension is v${myManifest.version}. That folder is probably NOT the one Chrome loaded — pick the exact Path from chrome://extensions.`, false);
    return null;
  }
  await idbSet("installDir", dir);
  await refreshLinkLabel();
  setUpStatus(`Linked install folder “${dir.name}”. You can now update from a new-version folder.`, true);
  return dir;
}

async function refreshLinkLabel() {
  try {
    const dir = await idbGet("installDir");
    $("linkedFolder").textContent = dir ? `Linked: ${dir.name}` : "Not linked yet";
  } catch { $("linkedFolder").textContent = "Not linked yet"; }
}

async function updateFromFolder() {
  const myManifest = chrome.runtime.getManifest();
  if (!window.showDirectoryPicker) {
    setUpStatus("This browser build doesn't allow folder access here. Replace files in your extension folder and click Reload now.", false);
    return;
  }
  try {
    // Ensure the install folder is linked first (this is the key correctness step).
    let installDir = await idbGet("installDir");
    if (!installDir) {
      setUpStatus("First, link your installed folder…");
      installDir = await linkInstallFolder();
      if (!installDir) return;
    }
    if (!(await ensurePermission(installDir, "readwrite"))) {
      setUpStatus("Write permission to the install folder was denied.", false); return;
    }
    // The linked folder must still be the running version (else it's the wrong folder).
    let insM;
    try { insM = await readManifest(installDir); } catch { insM = null; }
    if (!insM || insM.version !== myManifest.version) {
      setUpStatus(`Linked folder (v${insM ? insM.version : "?"}) doesn't match the running v${myManifest.version}. Re-link it to the exact chrome://extensions Path.`, false);
      await idbSet("installDir", undefined);
      await refreshLinkLabel();
      return;
    }

    setUpStatus("Select the NEW version folder…");
    const newDir = await window.showDirectoryPicker({ id: "wt-new", mode: "read" });
    let newManifest;
    try { newManifest = await readManifest(newDir); }
    catch { setUpStatus("That folder has no manifest.json — pick the new version's folder.", false); return; }
    // Identify by files, not name — a rebrand (renamed extension) must still update.
    if (!(await looksLikeOurExtension(newDir))) { setUpStatus("That folder doesn't look like an ARRAY.FIND build (no popup.js / popup.html). Pick the new version's folder.", false); return; }
    if (cmpVer(newManifest.version, myManifest.version) < 0) {
      setUpStatus(`Selected v${newManifest.version} is older than installed v${myManifest.version}. Aborted.`, false); return;
    }

    setUpStatus(`Copying v${newManifest.version} into “${installDir.name}”…`);
    await copyDir(newDir, installDir);

    // VERIFY the files actually landed: re-read the install folder's manifest.
    const check = await readManifest(installDir);
    if (check.version !== newManifest.version) {
      setUpStatus(`Copy finished but the install folder still reads v${check.version}. The linked folder is likely not the one Chrome loaded — re-link to the exact Path and retry. NOT reloading.`, false);
      return;
    }
    setUpStatus(`Verified v${check.version} in place. Reloading…`, true);
    setTimeout(() => chrome.runtime.reload(), 800);
  } catch (e) {
    if (e && e.name === "AbortError") { setUpStatus("Cancelled."); return; }
    setUpStatus("Update failed: " + (e?.message || e) + ". You can still replace files manually and click Reload now.", false);
  }
}

function reloadExtension() {
  setUpStatus("Reloading…", true);
  setTimeout(() => chrome.runtime.reload(), 300);
}

// ---------- export / import (additive sharing) ----------
const setShareStatus = (msg, ok) => {
  const el = $("shareStatus");
  el.textContent = msg;
  el.style.color = ok === true ? "var(--good)" : ok === false ? "var(--critical)" : "var(--ink-3)";
};

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportWallets() {
  const d = await store.get();
  const labelled = (d.wallets || []).filter(w => w.name);
  if (!labelled.length) { setShareStatus("No labelled wallets to export yet.", false); return; }
  downloadJSON({ type: "wt-wallet-labels", v: 1, exportedAt: new Date().toISOString(), wallets: labelled.map(w => ({ address: w.address, name: w.name })) }, "wallet-labels.json");
  setShareStatus(`Exported ${labelled.length} wallet label(s).`, true);
}

async function exportFunding() {
  const d = await store.get();
  const user = d.userFunding || [];
  if (!user.length) { setShareStatus("No custom funding sources to export (built-ins ship with the extension).", false); return; }
  downloadJSON({ type: "wt-funding", v: 1, exportedAt: new Date().toISOString(), funding: user.map(f => ({ address: f.address, label: f.label, category: f.category || "user" })) }, "funding-sources.json");
  setShareStatus(`Exported ${user.length} funding source(s).`, true);
}

async function exportFeedback() {
  const d = await store.get();
  const fb = d.feedback || [];
  if (!fb.length) { setShareStatus("No flagged results to export yet.", false); return; }
  downloadJSON({ type: "arrayfind-feedback", v: 1, exportedAt: new Date().toISOString(), flagged: fb }, "arrayfind-flagged-results.json");
  setShareStatus(`Exported ${fb.length} flagged result(s).`, true);
}

let importMode = null; // "wallets" | "funding"
async function exportConnectors() {
  const d = await store.get();
  const list = d.connectors || [];
  if (!list.length) { setShareStatus("No connector flags to export yet.", false); return; }
  downloadJSON({ type: "arrayfind-connectors", v: 1, exportedAt: new Date().toISOString(), connectors: list }, "arrayfind-connector-flags.json");
  setShareStatus(`Exported ${list.length} connector flag(s).`, true);
}

async function exportAnsem() {
  const d = await store.get();
  const list = d.ansemWallets || [];
  if (!list.length) { setShareStatus("No Ansem wallets to export yet.", false); return; }
  downloadJSON({ type: "arrayfind-ansem", v: 1, exportedAt: new Date().toISOString(), ansemWallets: list }, "arrayfind-ansem-wallets.json");
  setShareStatus(`Exported ${list.length} Ansem wallet(s).`, true);
}

function triggerImport(mode) { importMode = mode; $("importFile").value = ""; $("importFile").click(); }

async function handleImportFile(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { setShareStatus("That file isn't valid JSON.", false); return; }

  const d = await store.get();
  if (importMode === "wallets") {
    const incoming = Array.isArray(data) ? data : (data.wallets || []);
    if (!Array.isArray(incoming) || (data.type && data.type !== "wt-wallet-labels")) { setShareStatus("Not a wallet-labels export.", false); return; }
    const have = new Set((d.wallets || []).map(w => w.address));
    let added = 0, skipped = 0;
    for (const w of incoming) {
      if (!w || !BASE58_RE.test(w.address || "")) { continue; }
      if (have.has(w.address)) { skipped++; continue; }   // never overwrite existing
      d.wallets.push({ address: w.address, added: Date.now(), name: (w.name || "").toString().slice(0, 60) });
      have.add(w.address); added++;
    }
    await store.set({ wallets: d.wallets });
    renderWalletList();
    setShareStatus(`Imported ${added} new wallet label(s); ${skipped} already present were kept as-is.`, true);
  } else if (importMode === "funding") {
    const incoming = Array.isArray(data) ? data : (data.funding || []);
    if (!Array.isArray(incoming) || (data.type && data.type !== "wt-funding")) { setShareStatus("Not a funding-sources export.", false); return; }
    const have = new Set((d.userFunding || []).map(f => f.address));
    let added = 0, skipped = 0;
    for (const f of incoming) {
      if (!f || !BASE58_RE.test(f.address || "")) continue;
      if (have.has(f.address) || KNOWN_ADDRESSES[f.address]) { skipped++; continue; } // skip existing + built-ins
      d.userFunding.push({ address: f.address, label: (f.label || "Funding source").toString().slice(0, 60), category: f.category || "imported" });
      have.add(f.address); added++;
    }
    await store.set({ userFunding: d.userFunding });
    rebuildExtraLabels(d.userFunding);
    renderFundingLib();
    setShareStatus(`Imported ${added} new funding source(s); ${skipped} already present/built-in were skipped.`, true);
  } else if (importMode === "feedback") {
    const incoming = Array.isArray(data) ? data : (data.flagged || []);
    if (!Array.isArray(incoming) || (data.type && data.type !== "atlas-feedback" && data.type !== "arrayfind-feedback")) { setShareStatus("Not a flagged-results export.", false); return; }
    d.feedback = d.feedback || [];
    const key = (f) => `${f.addr}|${f.on || ""}|${f.kind || "incorrect"}`;
    const have = new Set(d.feedback.map(key));
    let added = 0, skipped = 0;
    for (const f of incoming) {
      if (!f || !BASE58_RE.test(f.addr || "")) continue;
      if (have.has(key(f))) { skipped++; continue; }     // adds only — never overwrites
      d.feedback.push({ ...f, imported: true });
      have.add(key(f)); added++;
    }
    await store.set({ feedback: d.feedback });
    if (lastSettings) lastSettings.feedback = d.feedback;
    renderFeedbackList();
    setShareStatus(`Imported ${added} flagged result(s); ${skipped} duplicate(s) skipped. Certainty calibration updated.`, true);
  } else if (importMode === "connectors") {
    const incoming = Array.isArray(data) ? data : (data.connectors || []);
    if (!Array.isArray(incoming) || (data.type && data.type !== "atlas-connectors" && data.type !== "arrayfind-connectors")) { setShareStatus("Not a connector-flags export.", false); return; }
    d.connectors = d.connectors || [];
    const have = new Set(d.connectors);
    let added = 0, skipped = 0;
    for (const a of incoming) {
      const addr = typeof a === "string" ? a : (a && a.address);
      if (!addr || !BASE58_RE.test(addr)) continue;
      if (have.has(addr)) { skipped++; continue; }
      d.connectors.push(addr); have.add(addr); added++;
    }
    await store.set({ connectors: d.connectors });
    if (lastSettings) lastSettings.connectors = d.connectors;
    renderConnectorList();
    setShareStatus(`Imported ${added} connector flag(s); ${skipped} already present.`, true);
  } else if (importMode === "ansem") {
    const incoming = Array.isArray(data) ? data : (data.ansemWallets || []);
    if (!Array.isArray(incoming) || (data.type && data.type !== "atlas-ansem" && data.type !== "arrayfind-ansem")) { setShareStatus("Not an Ansem-wallets export.", false); return; }
    d.ansemWallets = d.ansemWallets || [];
    const have = new Set(d.ansemWallets);
    let added = 0, skipped = 0;
    for (const a of incoming) {
      const addr = typeof a === "string" ? a : (a && a.address);
      if (!addr || !BASE58_RE.test(addr)) continue;
      if (have.has(addr)) { skipped++; continue; }
      d.ansemWallets.push(addr); have.add(addr); added++;
    }
    await store.set({ ansemWallets: d.ansemWallets });
    if (lastSettings) lastSettings.ansemWallets = d.ansemWallets;
    renderAnsemList();
    setShareStatus(`Imported ${added} Ansem wallet(s); ${skipped} already present.`, true);
  }
}

// ---------- funding sources library ----------
async function renderFundingLib() {
  const { userFunding } = await store.get();
  const q = ($("fundSearch").value || "").toLowerCase();
  const seed = FUNDING_DB.map(f => ({ ...f, seed: true }));
  const user = (userFunding || []).map(f => ({ ...f, seed: false }));
  const all = [...user, ...seed].filter(f =>
    !q || f.address.toLowerCase().includes(q) || (f.label || "").toLowerCase().includes(q) || (f.category || "").toLowerCase().includes(q));
  $("fundCount").textContent = `${seed.length} built-in · ${user.length} added`;
  const ul = $("fundingLibList");
  ul.innerHTML = "";
  if (all.length === 0) { ul.innerHTML = `<li><span class="hint">No matches.</span></li>`; return; }
  for (const f of all) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="row-main">
        <span class="row-title"></span>
        <span class="row-sub mono"></span></div>
      <div class="row-right">
        <span class="badge"></span>
        <button class="copy-btn" title="Copy address">⧉</button>
        <button class="rm-fund icon-btn small hidden" title="Remove">✕</button></div>`;
    li.querySelector(".row-title").textContent = f.label || "Funding source";
    li.querySelector(".row-sub").textContent = f.address;
    li.querySelector(".row-sub").title = f.address;
    li.querySelector(".badge").textContent = f.seed ? (f.category || "built-in") : "added";
    li.querySelector(".copy-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(f.address);
      $("statusLine").textContent = "Address copied.";
      setTimeout(() => ($("statusLine").textContent = ""), 1500);
    });
    if (!f.seed) {
      const rm = li.querySelector(".rm-fund");
      rm.classList.remove("hidden");
      rm.addEventListener("click", async () => {
        const d = await store.get();
        d.userFunding = (d.userFunding || []).filter(x => x.address !== f.address);
        await store.set({ userFunding: d.userFunding });
        rebuildExtraLabels(d.userFunding);
        renderFundingLib();
      });
    }
    ul.appendChild(li);
  }
}

async function addFundingSource() {
  const addr = $("fundAddr").value.trim();
  const label = $("fundLabel").value.trim();
  $("fundErr").classList.add("hidden");
  const err = (m) => { const e = $("fundErr"); e.textContent = m; e.classList.remove("hidden"); };
  if (!BASE58_RE.test(addr)) return err("That doesn't look like a valid Solana address.");
  if (!label) return err("Add a label so you recognize this source.");
  const d = await store.get();
  if ((d.userFunding || []).some(f => f.address === addr) || KNOWN_ADDRESSES[addr]) return err("That address is already in the library.");
  d.userFunding = [...(d.userFunding || []), { address: addr, label, category: "user" }];
  await store.set({ userFunding: d.userFunding });
  rebuildExtraLabels(d.userFunding);
  $("fundAddr").value = ""; $("fundLabel").value = "";
  $("statusLine").textContent = "Funding source added.";
  setTimeout(() => ($("statusLine").textContent = ""), 1500);
  renderFundingLib();
}

async function renderIgnoredList() {
  const d = await store.get();
  const labels = Object.fromEntries((d.wallets || []).filter(w => w.name).map(w => [w.address, w.name]));
  const nameOf = (a) => labels[a] ? `[${labels[a]}]` : shortAddr(a);
  const scoped = d.ignoredScoped || {};
  // Flatten scoped ignores into {on, addr} pairs, plus any legacy global ignores.
  const pairs = [];
  for (const on of Object.keys(scoped)) for (const addr of (scoped[on] || [])) pairs.push({ on, addr });
  for (const addr of (d.ignored || [])) pairs.push({ on: null, addr });   // legacy global
  $("ignoredSection").classList.toggle("hidden", pairs.length === 0);
  const ul = $("ignoredList");
  ul.innerHTML = "";
  for (const { on, addr } of pairs) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="row-main"><span class="row-title mono"></span><span class="row-sub"></span></div><div class="row-right"><button class="copy-btn" title="Stop ignoring">↺ unignore</button></div>`;
    li.querySelector(".row-title").textContent = shortAddr(addr);
    li.querySelector(".row-title").title = addr;
    li.querySelector(".row-sub").textContent = on ? `not a side wallet for ${nameOf(on)}` : "legacy (global)";
    li.querySelector(".copy-btn").addEventListener("click", async () => {
      const dd = await store.get();
      if (on) { dd.ignoredScoped = dd.ignoredScoped || {}; dd.ignoredScoped[on] = (dd.ignoredScoped[on] || []).filter(a => a !== addr); }
      else dd.ignored = (dd.ignored || []).filter(a => a !== addr);
      await store.set({ ignoredScoped: dd.ignoredScoped, ignored: dd.ignored });
      renderIgnoredList();
    });
    ul.appendChild(li);
  }
}

async function renderAnsemList() {
  const d = await store.get();
  const list = d.ansemWallets || [];
  const ul = $("ansemList");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = `<li><span class="hint">No Ansem wallets added yet.</span></li>`;
    return;
  }
  for (const addr of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ref-addr mono"></span><button class="copy-btn" title="Remove from Ansem wallets">↺ remove</button>`;
    li.querySelector(".ref-addr").textContent = addr;
    li.querySelector(".ref-addr").title = addr;
    li.querySelector(".copy-btn").addEventListener("click", async () => {
      const dd = await store.get();
      dd.ansemWallets = (dd.ansemWallets || []).filter(a => a !== addr);
      await store.set({ ansemWallets: dd.ansemWallets });
      if (lastSettings) lastSettings.ansemWallets = dd.ansemWallets;
      renderAnsemList();
    });
    ul.appendChild(li);
  }
}

async function renderConnectorList() {
  const d = await store.get();
  const list = d.connectors || [];
  $("connectorSection").classList.toggle("hidden", list.length === 0);
  const ul = $("connectorList");
  ul.innerHTML = "";
  for (const addr of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ref-addr mono"></span><button class="copy-btn" title="Stop treating as a connector">↺ remove</button>`;
    li.querySelector(".ref-addr").textContent = addr;
    li.querySelector(".ref-addr").title = addr;
    li.querySelector(".copy-btn").addEventListener("click", async () => {
      const dd = await store.get();
      dd.connectors = (dd.connectors || []).filter(a => a !== addr);
      await store.set({ connectors: dd.connectors });
      renderConnectorList();
    });
    ul.appendChild(li);
  }
}

async function renderFeedbackList() {
  const { feedback } = await store.get();
  const list = feedback || [];
  $("feedbackSection").classList.toggle("hidden", list.length === 0);
  const ul = $("feedbackList");
  ul.innerHTML = "";
  for (const f of [...list].sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="row-main">
        <span class="row-title mono"></span>
        <span class="row-sub"></span></div>
      <div class="row-right"><button class="copy-btn" title="Remove this flag">↺ undo</button></div>`;
    li.querySelector(".row-title").textContent = shortAddr(f.addr);
    li.querySelector(".row-title").title = f.addr;
    const when = f.ts ? new Date(f.ts).toLocaleDateString() : "";
    const kindTxt = f.kind === "supply-ok" ? "non-suspicious transfer" : f.kind === "connector" ? "connector wallet" : "incorrect result";
    const certWord = { low: "not sure", med: "fairly sure", high: "certain" }[f.userCertainty];
    const youSaid = f.actualLabel ? ` · you: “${f.actualLabel}”${certWord ? ` (${certWord})` : ""}` : (certWord ? ` · you: ${certWord}` : "");
    li.querySelector(".row-sub").textContent =
      `${kindTxt}${youSaid} · ${when} · was ${f.certBand || "?"} ${f.certainty ?? "?"}%`;
    li.querySelector(".copy-btn").addEventListener("click", async () => {
      const d = await store.get();
      d.feedback = (d.feedback || []).filter(x => !(x.addr === f.addr && x.on === f.on));
      await store.set({ feedback: d.feedback });
      renderFeedbackList();
    });
    ul.appendChild(li);
  }
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ---------- events ----------
document.addEventListener("DOMContentLoaded", async () => {
  const d = await store.get();
  $("apiKeyInput").value = d.apiKey;
  $("txDepthInput").value = String(d.txDepth);
  $("txDepthWarn").classList.toggle("hidden", !(Number(d.txDepth) > 10000));
  $("dustCheck").checked = !!d.dust;
  $("dustUsdSelect").value = String(d.dustUsd);
  $("supplyPctSelect").value = String(d.supplyPct);
  applyMapPalette(d.mapPalette || "arctic");
  // Splash: 3-second welcome (click to skip). Toggle lives in Settings.
  $("splashToggle").checked = d.splash !== false;
  if (d.splash !== false) {
    const sp = $("splash");
    try { $("splashVer").textContent = "v" + chrome.runtime.getManifest().version; } catch {}
    sp.classList.remove("hidden");
    const hideSplash = () => { sp.classList.add("splash-out"); setTimeout(() => sp.classList.add("hidden"), 480); };
    setTimeout(hideSplash, 3000);
    sp.addEventListener("click", hideSplash, { once: true });
  }
  rebuildExtraLabels(d.userFunding);
  renderWalletList();
  if (!d.apiKey) show("settings");

  $("ansemAddBtn").addEventListener("click", async () => {
    const addr = $("ansemAddr").value.trim();
    const err = $("ansemErr");
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
      err.textContent = "That doesn't look like a Solana address.";
      err.classList.remove("hidden");
      return;
    }
    err.classList.add("hidden");
    const d = await store.get();
    d.ansemWallets = d.ansemWallets || [];
    if (!d.ansemWallets.includes(addr)) d.ansemWallets.push(addr);
    await store.set({ ansemWallets: d.ansemWallets });
    if (lastSettings) lastSettings.ansemWallets = d.ansemWallets;
    $("ansemAddr").value = "";
    renderAnsemList();
  });

  $("copyAddrBtn").addEventListener("click", () => {
    if (!currentAddress) return;
    navigator.clipboard.writeText(currentAddress);
    $("copyAddrBtn").textContent = "✓";
    setTimeout(() => ($("copyAddrBtn").textContent = "⧉"), 1200);
  });

  $("navUp").addEventListener("click", () => navJump(-1));
  $("navDown").addEventListener("click", () => navJump(1));
  $("navHome").addEventListener("click", () => { show("list"); window.scrollTo({ top: 0 }); });
  $("interBackBtn").addEventListener("click", () => $("interPanel").classList.add("hidden"));
  $("bubbleMapBtn").addEventListener("click", openBubbleMap);
  $("mapBackBtn").addEventListener("click", () => $("mapPanel").classList.add("hidden"));
  $("mapSaveBtn").addEventListener("click", saveMapSVG);
  $("infraToggle").addEventListener("click", () => {
    // Non-destructive: clusters are already laid out in their gaps, so just re-render
    // — the analysed wallet and every connection keep their exact positions.
    mapShowInfra = !mapShowInfra;
    $("infraToggle").textContent = mapShowInfra ? "Hide infrastructure" : "Show infrastructure";
    $("infraToggle").classList.toggle("active", mapShowInfra);
    rerenderMap();
  });
  $("lowConfInput").addEventListener("change", () => {
    const v = parseInt($("lowConfInput").value, 10);
    mapLowConfThresh = (isNaN(v) || v <= 0) ? 0 : Math.min(100, v);
    rerenderMap();   // filter at render — keeps the existing arrangement
  });
  $("mapResetBtn").addEventListener("click", () => { mapLowConfThresh = 0; openBubbleMap(); });
  const setMapSelectMode = (on) => {
    mapSelectMode = on;
    if (!on) mapSelection.clear();
    $("mapSelectBtn").textContent = on ? "Done (Enter)" : "Select group";
    $("mapSelectBtn").classList.toggle("active", on);
    rerenderMap();
  };
  $("mapSelectBtn").addEventListener("click", () => setMapSelectMode(!mapSelectMode));
  const zoomStep = (dir) => {
    const sx = mapPanX + 0.5 * (MAP_W / mapZoom), sy = mapPanY + 0.5 * (MAP_H / mapZoom);
    mapZoom = Math.max(1, Math.min(4, mapZoom * (dir > 0 ? 1.3 : 1 / 1.3)));
    if (mapZoom <= 1.001) { mapZoom = 1; mapPanX = 0; mapPanY = 0; }
    else { mapPanX = sx - 0.5 * (MAP_W / mapZoom); mapPanY = sy - 0.5 * (MAP_H / mapZoom); }
    applyMapView();
  };
  $("zoomInBtn").addEventListener("click", () => zoomStep(1));
  $("zoomOutBtn").addEventListener("click", () => zoomStep(-1));
  document.addEventListener("keydown", (ev) => {
    if (!mapSelectMode) return;
    if (ev.key === "Enter" || ev.key === "Escape") { ev.preventDefault(); setMapSelectMode(false); }
  });
  $("mapPaletteSel").addEventListener("change", async () => {
    applyMapPalette($("mapPaletteSel").value);
    await store.set({ mapPalette: mapPaletteName });
    if (lastSettings) lastSettings.mapPalette = mapPaletteName;
    // Recolour only — positions untouched (same non-destructive path as the filters).
    if (!$("mapPanel").classList.contains("hidden")) rerenderMap();
  });

  $("settingsBtn").addEventListener("click", () => {
    if (currentView === "settings") { closeSettings(); return; }   // gear toggles settings closed
    settingsReturnView = currentView; // remember where we came from
    renderIgnoredList();
    renderConnectorList();
    renderAnsemList();
    renderFeedbackList();
    renderFundingLib();
    try { $("verNow").textContent = "v" + chrome.runtime.getManifest().version; } catch {}
    refreshLinkLabel();
    setUpStatus(""); setShareStatus("");
    show("settings");
  });
  $("updateFolderBtn").addEventListener("click", updateFromFolder);
  $("linkFolderBtn").addEventListener("click", () => linkInstallFolder().catch(e => { if (e?.name !== "AbortError") setUpStatus("Link failed: " + (e?.message || e), false); }));
  $("reloadExtBtn").addEventListener("click", reloadExtension);
  $("exportWalletsBtn").addEventListener("click", exportWallets);
  $("exportFundingBtn").addEventListener("click", exportFunding);
  $("exportFeedbackBtn").addEventListener("click", exportFeedback);
  $("exportFeedbackBtn2").addEventListener("click", exportFeedback);
  $("importFeedbackBtn").addEventListener("click", () => triggerImport("feedback"));
  $("importFeedbackBtn2").addEventListener("click", () => triggerImport("feedback"));
  $("exportConnectorsBtn").addEventListener("click", exportConnectors);
  $("importConnectorsBtn").addEventListener("click", () => triggerImport("connectors"));
  $("exportConnectorsBtn2").addEventListener("click", exportConnectors);
  $("importConnectorsBtn2").addEventListener("click", () => triggerImport("connectors"));
  $("exportAnsemBtn").addEventListener("click", exportAnsem);
  $("importAnsemBtn").addEventListener("click", () => triggerImport("ansem"));
  $("splashToggle").addEventListener("change", async () => {
    await store.set({ splash: $("splashToggle").checked });
  });
  $("importWalletsBtn").addEventListener("click", () => triggerImport("wallets"));
  $("importFundingBtn").addEventListener("click", () => triggerImport("funding"));
  $("importFile").addEventListener("change", (e) => handleImportFile(e.target.files[0]));
  $("fundAddBtn").addEventListener("click", addFundingSource);
  $("fundLabel").addEventListener("keydown", (e) => { if (e.key === "Enter") addFundingSource(); });
  $("fundSearch").addEventListener("input", renderFundingLib);
  $("backBtn").addEventListener("click", () => show("list"));

  // Close settings → return to whatever screen was open before (list or the open
  // detail), never a forced reload. The API key is saved only if it changed.
  const closeSettings = async () => {
    const d = await store.get();
    const typed = $("apiKeyInput").value.trim();
    if (typed !== (d.apiKey || "")) await store.set({ apiKey: typed });
    if (settingsReturnView === "detail" && currentAddress) show("detail");
    else show("list");
  };
  $("saveSettingsBtn").addEventListener("click", closeSettings);
  $("closeSettingsBtn").addEventListener("click", closeSettings);

  // Per-analysis filters live on the search page and persist as they change;
  // changing any of them clears cached analyses so the next open recomputes.
  $("filterToggle").addEventListener("click", () => {
    const body = $("filterBody");
    const open = body.classList.toggle("hidden");
    $("filterCaret").textContent = open ? "▾" : "▴";
  });
  const persistFilters = async () => {
    // parseFloat("0") is 0 (a valid "Any %" choice) — don't let `|| 0.5` clobber it.
    const spRaw = parseFloat($("supplyPctSelect").value);
    // Transaction depth: free type-in, clamped to 100–50,000.
    const txRaw = parseInt($("txDepthInput").value, 10);
    const txDepth = Number.isNaN(txRaw) ? 300 : Math.max(100, Math.min(50000, txRaw));
    await store.set({
      txDepth,
      dust: $("dustCheck").checked,
      dustUsd: parseFloat($("dustUsdSelect").value),
      supplyPct: Number.isNaN(spRaw) ? 0.5 : Math.max(0, spRaw),
      cache: {},
    });
  };
  for (const id of ["txDepthInput", "dustCheck", "dustUsdSelect", "supplyPctSelect"]) {
    $(id).addEventListener("change", persistFilters);
  }
  // Live warning while typing a large transaction count.
  $("txDepthInput").addEventListener("input", () => {
    $("txDepthWarn").classList.toggle("hidden", !(Number($("txDepthInput").value) > 10000));
  });

  $("addWalletBtn").addEventListener("click", addWallet);
  $("addressInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWallet(); });

  $("refreshBtn").addEventListener("click", () => { if (currentAddress) openDetail(currentAddress, true); });

  $("sortSelect").addEventListener("change", () => {
    resultSort = $("sortSelect").value;
    if (lastData) renderDetail(lastData, lastSettings || {});
  });
  // Generic collapsible section headers (all detail sections use this).
  document.querySelectorAll(".h3-toggle[data-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = $(btn.dataset.target);
      if (!target) return;
      const collapsed = target.classList.toggle("hidden");
      const caret = btn.querySelector(".caret");
      if (caret) caret.textContent = collapsed ? "▸" : "▾";
    });
  });

  // Per-section sorting for Interacted addresses and Programs & PDAs.
  $("cpSortSelect").addEventListener("change", () => { cpSort = $("cpSortSelect").value; if (lastStats) renderCounterparties(lastStats, lastSettings || {}); });
  $("progSortSelect").addEventListener("change", () => { progSort = $("progSortSelect").value; if (lastStats) renderCounterparties(lastStats, lastSettings || {}); });

  // ---- recent sells ----
  $("loadMoreSellsBtn").addEventListener("click", () => openSellsPanel());
  $("sellsBackBtn").addEventListener("click", () => $("sellsPanel").classList.add("hidden"));
  $("loadOlderSellsBtn").addEventListener("click", loadOlderSells);

  // ---- multi-wallet refresh ----
  $("selectModeBtn").addEventListener("click", () => {
    selectMode = !selectMode;
    if (!selectMode) selectedWallets.clear();
    $("selectModeBtn").textContent = selectMode ? "Done" : "Select";
    $("selectModeBtn").classList.toggle("active", selectMode);
    document.querySelector(".sel-all").classList.toggle("hidden", !selectMode);
    $("refreshSelectedBtn").classList.toggle("hidden", !selectMode);
    $("selectAllChk").checked = false;
    renderWalletList();
  });
  $("selectAllChk").addEventListener("change", async () => {
    const { wallets } = await store.get();
    selectedWallets.clear();
    if ($("selectAllChk").checked) wallets.forEach(w => selectedWallets.add(w.address));
    renderWalletList();
  });
  $("refreshAllBtn").addEventListener("click", async () => {
    const { wallets } = await store.get();
    confirmBatch(wallets.map(w => w.address));
  });
  $("refreshSelectedBtn").addEventListener("click", () => {
    if (selectedWallets.size) confirmBatch([...selectedWallets]);
  });
  $("batchCancelBtn").addEventListener("click", () => $("batchWarn").classList.add("hidden"));
  $("batchGoBtn").addEventListener("click", runBatch);
  $("batchStopBtn").addEventListener("click", () => { batchStop = true; $("batchStopBtn").textContent = "Stopping…"; });


  async function addWallet() {
    const addr = $("addressInput").value.trim();
    const name = $("nameInput").value.trim();
    $("addError").classList.add("hidden");
    if (!BASE58_RE.test(addr)) {
      showError("addError", "That doesn't look like a valid Solana address (base58, 32–44 chars).");
      return;
    }
    const d2 = await store.get();
    if (d2.wallets.some(w => w.address === addr)) {
      showError("addError", "Wallet already added.");
      return;
    }
    d2.wallets.push({ address: addr, added: Date.now(), name });
    await store.set({ wallets: d2.wallets });
    $("addressInput").value = "";
    $("nameInput").value = "";
    renderWalletList();
    openDetail(addr); // the program does the rest
  }
});
