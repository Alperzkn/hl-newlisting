export type Market = "perp" | "spot";

export type ListingEvent = {
  symbol: string;
  market: Market;
  dex?: string;
  dexFullName?: string;
  detectedAt: string;
  maxLeverage?: number;
  midPrice?: number;
  tradingUrl: string;
  // Set for spot pairs whose base token already trades in another pair
  // (e.g. KNTQ/USDC when KNTQ/USDH already exists) — a new market, not a new token.
  isNewQuotePair?: boolean;
  baseToken?: string;
};

export type AssetSnapshot = {
  perps: Set<string>;
  spot: Set<string>;
};

export type DexSnapshot = {
  dex: string;
  fullName: string;
  perps: Set<string>;
  leverage: Record<string, number>;
};

export type AssetMeta = {
  firstSeen: string;
};

export type DexInfo = {
  fullName: string;
  firstSeen: string;
  assets: Record<string, AssetMeta>;
};

export type KnownAssets = {
  perps: Record<string, AssetMeta>;
  spot: Record<string, AssetMeta>;
  dexPerps: Record<string, DexInfo>;
  lastPollAt: string;
};

export type Notifier = {
  notify(event: ListingEvent): Promise<void>;
};

export type HeartbeatStatus = {
  lastPollAt: string;
  perpsCount: number;
  spotCount: number;
  dexCount: number;
  dexAssetsCount: number;
};
