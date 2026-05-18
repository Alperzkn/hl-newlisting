// src/hl-client.ts

export type MetaResult = {
  symbols: Set<string>;
  leverage: Record<string, number>;
};

export type SpotMetaResult = {
  symbols: Set<string>;
  /**
   * Maps the canonical universe name (e.g. "@335") to a human-readable form
   * (e.g. "HPL/USDC"), built by resolving each universe entry's token indices
   * against the top-level `tokens` array. ~99% of HL spot pairs use `@N` names,
   * so this is essential for usable notifications.
   */
  displayNames: Record<string, string>;
};

export type PerpDex = {
  name: string;
  fullName: string;
};

export type HlClient = {
  fetchMeta(dex?: string): Promise<MetaResult>;
  fetchSpotMeta(): Promise<SpotMetaResult>;
  fetchAllMids(): Promise<Record<string, number>>;
  fetchPerpDexs(): Promise<PerpDex[]>;
};

type RawMeta = { universe: Array<{ name: string; maxLeverage?: number }> };
type RawSpotMeta = {
  universe: Array<{ name: string; tokens?: number[] }>;
  tokens?: Array<{ name: string }>;
};
type RawPerpDexEntry = { name: string; fullName?: string } | null;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HL API ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

export function createHlClient(baseUrl: string): HlClient {
  return {
    async fetchMeta(dex?: string) {
      const body: Record<string, unknown> = { type: "meta" };
      if (dex) body.dex = dex;
      const raw = await post<RawMeta>(baseUrl, body);
      const symbols = new Set<string>();
      const leverage: Record<string, number> = {};
      for (const a of raw.universe) {
        symbols.add(a.name);
        if (typeof a.maxLeverage === "number") leverage[a.name] = a.maxLeverage;
      }
      return { symbols, leverage };
    },
    async fetchSpotMeta() {
      const raw = await post<RawSpotMeta>(baseUrl, { type: "spotMeta" });
      const tokens = raw.tokens ?? [];
      const symbols = new Set<string>();
      const displayNames: Record<string, string> = {};
      for (const entry of raw.universe) {
        symbols.add(entry.name);
        const idx = entry.tokens;
        if (idx && idx.length >= 2) {
          const base = tokens[idx[0]]?.name;
          const quote = tokens[idx[1]]?.name;
          if (base && quote) displayNames[entry.name] = `${base}/${quote}`;
        }
      }
      return { symbols, displayNames };
    },
    async fetchAllMids() {
      const raw = await post<Record<string, string>>(baseUrl, { type: "allMids" });
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
      }
      return out;
    },
    async fetchPerpDexs() {
      const raw = await post<RawPerpDexEntry[]>(baseUrl, { type: "perpDexs" });
      const out: PerpDex[] = [];
      for (const entry of raw) {
        if (entry && typeof entry.name === "string" && entry.name.length > 0) {
          out.push({ name: entry.name, fullName: entry.fullName ?? entry.name });
        }
      }
      return out;
    },
  };
}
