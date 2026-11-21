// Token Launch Radar — the valuation model.
//
// The board ranks protocols that record no token yet by what a launch would be worth if the
// protocol's record stayed as it is. The value is not a multiple picked from the air: it is
// priced off the snapshot's own launched protocols. Every protocol whose token already trades
// gives one observation, market cap per dollar of TVL. Protocols in the same DefiLlama category
// form a peer set; a pre-token protocol is priced at its category's peer ratio, shrunk toward
// the global median when the peer set is small, then tilted by the two facts the snapshot
// carries about the protocol itself: its seven-day TVL momentum and how long it has run with
// no token. No protocol name is ever special-cased: one function prices every row, and the
// dashboard shows the arithmetic for any row a reader opens.
//
//   peers(cat)   = launched protocols in the category, ratio_i = mcap_i / tvl_i
//   ratio(cat)   = (n x median(peers) + 6 x globalMedian) / (n + 6), capped to [0.01, 3]
//   growthMult   = 1 + clamp(change_7d, -50, 100) / 100 x 0.6        (no report: 1)
//   maturityMult = 0.78 + 0.42 x (1 - exp(-age_days / 620))          (age unknown: 0.92)
//   implied      = round(tvl_usd x ratio x growthMult x maturityMult), at least 1
//
// The board carries every rankable pre-token protocol in the snapshot, not only the watchlist:
// the watchlist is the floor the house drew at $50M of TVL, and the radar exists to find the
// launches below it early. A protocol is rankable when it records no token and is not itself a
// wrapped, staked, bridged or versioned product of one that trades, by the same rule the house
// states for its watchlist. Protocols whose token already trades are never ranked: they are
// listed apart at their market value, in the dashboard's Already trading view.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's peer evidence: how its launched protocols are priced per TVL dollar. */
export interface PeerStats {
  category: string;
  peers: number;
  median_ratio: number;
  p25_ratio: number;
  p75_ratio: number;
  blended_ratio: number;
}

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic. */
export interface RadarConstants {
  shrink_k: number;
  ratio_floor: number;
  ratio_cap: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_tau_days: number;
  unknown_age_mult: number;
}

export const CONSTANTS: RadarConstants = {
  shrink_k: 6,
  ratio_floor: 0.01,
  ratio_cap: 3,
  growth_weight: 0.6,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_base: 0.78,
  maturity_span: 0.42,
  maturity_tau_days: 620,
  unknown_age_mult: 0.92,
};

export const MODEL_VERSION = 'peer-radar-2';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's evidence attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    peer_category: string;
    peer_count: number;
    peer_median_ratio: number;
    blended_ratio: number;
    growth_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one ranked row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  peer_category: string;
  peer_count: number;
  peer_median_ratio: number;
  blended_ratio: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown at market value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

/** One launched peer of a category, for a detail view's evidence table. */
export interface PeerRow {
  name: string;
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** Everything the dashboard renders, from the snapshot alone. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  constants: RadarConstants;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_median_ratio: number;
  categories: PeerStats[];
  rows: RadarRow[];
  live: LiveRow[];
  peers: Record<string, PeerRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of a token that already trades, per the house's watchlist rule. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a product may begin with, per the same rule. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol may be ranked: it records no token, and it is not a wrapped, staked,
 * bridged or versioned product of a protocol whose token already trades.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The quantile of an ascending-sorted array, by nearest rank. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at]!;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The category key a protocol is priced under: its own category, or the whole market's. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorized';
}

/**
 * The peer evidence: for every category with at least one launched protocol, the distribution
 * of market cap per TVL dollar among them, and the shrunk ratio the model prices with.
 */
export function peerStats(snapshot: Snapshot, c: RadarConstants = CONSTANTS): { stats: Map<string, PeerStats>; globalMedian: number } {
  const launched = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const allRatios = launched.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const globalMedian = quantile(allRatios, 0.5);
  const byCategory = new Map<string, number[]>();
  for (const p of launched) {
    const key = categoryKey(p);
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const stats = new Map<string, PeerStats>();
  for (const [category, ratios] of byCategory) {
    ratios.sort((a, b) => a - b);
    const median = quantile(ratios, 0.5);
    const blended = clamp((ratios.length * median + c.shrink_k * globalMedian) / (ratios.length + c.shrink_k), c.ratio_floor, c.ratio_cap);
    stats.set(category, {
      category,
      peers: ratios.length,
      median_ratio: median,
      p25_ratio: quantile(ratios, 0.25),
      p75_ratio: quantile(ratios, 0.75),
      blended_ratio: blended,
    });
  }
  return { stats, globalMedian };
}

/** The peer stats a protocol is priced with: its category's, or the market's when it has none. */
function statsFor(p: SnapshotProtocol, stats: Map<string, PeerStats>, globalMedian: number, c: RadarConstants): PeerStats {
  const own = stats.get(categoryKey(p));
  if (own !== undefined) return own;
  return { category: 'All categories', peers: 0, median_ratio: globalMedian, p25_ratio: globalMedian, p75_ratio: globalMedian, blended_ratio: clamp(globalMedian, c.ratio_floor, c.ratio_cap) };
}

/** The two tilts the protocol's own record applies to its category price. */
export function tilts(p: SnapshotProtocol, asOf: string, c: RadarConstants = CONSTANTS): { growth: number; maturity: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const pct = p.change_7d === null ? 0 : clamp(p.change_7d, c.growth_floor_pct, c.growth_cap_pct);
  const growth = p.change_7d === null ? 1 : 1 + (pct / 100) * c.growth_weight;
  const maturity = age === null ? c.unknown_age_mult : c.maturity_base + c.maturity_span * (1 - Math.exp(-age / c.maturity_tau_days));
  return { growth, maturity, age };
}

/** One protocol's implied value and the evidence behind it. */
export function price(p: SnapshotProtocol, snapshot: Snapshot, stats: Map<string, PeerStats>, globalMedian: number, c: RadarConstants = CONSTANTS): { implied: number; low: number; high: number; peer: PeerStats; growth: number; maturity: number; age: number | null } {
  const peer = statsFor(p, stats, globalMedian, c);
  const { growth, maturity, age } = tilts(p, snapshot.as_of, c);
  const tilt = growth * maturity;
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.blended_ratio * tilt));
  const lowRatio = clamp((peer.peers * peer.p25_ratio + c.shrink_k * globalMedian) / (peer.peers + c.shrink_k), c.ratio_floor, c.ratio_cap);
  const highRatio = clamp((peer.peers * peer.p75_ratio + c.shrink_k * globalMedian) / (peer.peers + c.shrink_k), c.ratio_floor, c.ratio_cap);
  return {
    implied,
    low: Math.max(1, Math.round(p.tvl_usd * Math.min(lowRatio, peer.blended_ratio) * tilt)),
    high: Math.max(implied, Math.round(p.tvl_usd * Math.max(highRatio, peer.blended_ratio) * tilt)),
    peer,
    growth,
    maturity,
    age,
  };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Roughly what one transaction costs on a chain, in the words of a farm plan. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $12 in ETH gas per transaction at ordinary fees';
  if (chain === 'Solana') return 'about $0.25 in SOL fees per transaction';
  if (chain === 'Bitcoin') return 'about $2 in BTC fees per transaction';
  if (['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Polygon', 'Avalanche', 'BSC', 'Fantom', 'Gnosis'].includes(chain)) {
    return 'about $1 in gas per transaction';
  }
  return 'about $3 in gas per transaction';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a longer record earns a shorter qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow about 40% of it once so the wallet shows both sides of the market`;
  if (c.includes('dex') || c.includes('aggregator')) return `Swap about $${capital} through ${name} on ${chain} across at least three separate days, then hold a small position in its main liquidity pool`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and trade one small hedged position a week, keeping total volume steady rather than large`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and leave the vault shares untouched in the wallet`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Allocate $${capital} into one curated vault on ${name} on ${chain} and keep the shares for the full holding period`;
  if (c.includes('rwa') || c.includes('real world')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} after its onboarding check, and hold the asset in the farming wallet`;
  if (c.includes('privacy')) return `Shield $${capital} through ${name} on ${chain}, make one private transfer to a second wallet you control, and unshield after the holding period`;
  if (c.includes('payment')) return `Route $${capital} of payments or remittance volume through ${name} over the holding period, in at least four separate transfers`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it; rebalance only when the index itself does`;
  if (c.includes('insurance')) return `Underwrite $${capital} of cover in ${name}'s capital pool on ${chain}, or buy one policy and keep it to expiry`;
  if (c.includes('nft')) return `Lend or borrow $${capital} against one listed NFT through ${name} on ${chain} and complete the term without defaulting`;
  if (c.includes('launchpad') || c.includes('ido')) return `Stake or hold $${capital} in ${name}'s allocation pool on ${chain} and take part in one sale during the holding period`;
  if (c.includes('gaming') || c.includes('game')) return `Spend about $${capital} inside ${name} across at least five play sessions, keeping the account active every week`;
  if (c.includes('ai')) return `Pay about $${capital} for inference or agent runs on ${name} over the holding period, from the farming wallet, in weekly sessions`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app, and keep the position open for the full holding period`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page weekly.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Create a fresh wallet for ${p.name} alone, back up its seed phrase on paper, and fund it from an exchange with the $${capital} you plan to farm plus gas money`,
      cost: 'one exchange withdrawal fee, about $1 to $5',
      time: '20 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital in the position and ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one qualifying action every week without fail: a deposit, a swap, a vote or a claim inside ${p.name}'s own app, always from the same wallet`,
      cost: gas.replace('per transaction', 'a week'),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the wallet appears in several weekly snapshots instead of a single day's spike`,
      cost: `the $${capital} stays in the position; expect no yield promise`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points, rewards or governance page once a week and follow only the links that page publishes; never pay a third party to claim anything`,
      cost: 'nothing to check; a claim fee, if one ever exists, is paid only to the protocol',
      time: '5 minutes a week',
    },
    {
      text: `Keep a farm log with the wallet address, every date, amount and transaction hash, and unwind the position in one session once the holding period ends or a launch is announced`,
      cost: `${gas} to unwind`,
      time: '30 minutes to exit',
    },
  ];
}

/** The protocols the board ranks, most valuable first, with ranks 1..n and the watchlist covered. */
export function buildBoard(snapshot: Snapshot, c: RadarConstants = CONSTANTS): BoardRow[] {
  const { stats, globalMedian } = peerStats(snapshot, c);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => ({ p, ...price(p, snapshot, stats, globalMedian, c) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    on_watchlist: watch.has(s.p.slug),
    implied_value_usd: s.implied,
    implied_low_usd: s.low,
    implied_high_usd: s.high,
    model: {
      peer_category: s.peer.category,
      peer_count: s.peer.peers,
      peer_median_ratio: round4(s.peer.median_ratio),
      blended_ratio: round4(s.peer.blended_ratio),
      growth_multiplier: round4(s.growth),
      maturity_multiplier: round4(s.maturity),
    },
    farm_steps: farmPlan(s.p, s.age).map(stepText),
  }));
}

/** The launched protocols, by market cap: the market's own prices, kept apart from the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
      change_7d: p.change_7d,
    }));
}

/** The top launched peers of each category, for the detail views' evidence tables. */
export function peerRows(snapshot: Snapshot): Record<string, PeerRow[]> {
  const out: Record<string, PeerRow[]> = {};
  const launched = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  for (const p of launched) {
    const key = categoryKey(p);
    const row: PeerRow = { name: p.name, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: round4(p.mcap_usd! / p.tvl_usd) };
    const list = out[key];
    if (list === undefined) out[key] = [row];
    else list.push(row);
  }
  for (const key of Object.keys(out)) {
    out[key]!.sort((a, b) => b.mcap_usd - a.mcap_usd);
    out[key] = out[key]!.slice(0, 6);
  }
  return out;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, c: RadarConstants = CONSTANTS): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, c);
  const { stats, globalMedian } = peerStats(snapshot, c);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    constants: c,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    global_median_ratio: round4(globalMedian),
    categories: [...stats.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)).map((s) => ({ ...s, median_ratio: round4(s.median_ratio), p25_ratio: round4(s.p25_ratio), p75_ratio: round4(s.p75_ratio), blended_ratio: round4(s.blended_ratio) })),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      peer_category: r.model.peer_category,
      peer_count: r.model.peer_count,
      peer_median_ratio: r.model.peer_median_ratio,
      blended_ratio: r.model.blended_ratio,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
    peers: peerRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((x): x is string => typeof x === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a protocol in the snapshot`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
