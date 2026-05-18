export type Market = "perp" | "spot";

export type ListingEvent = {
  symbol: string;
  market: Market;
  detectedAt: string;
  maxLeverage?: number;
  midPrice?: number;
  tradingUrl: string;
};

export type AssetSnapshot = {
  perps: Set<string>;
  spot: Set<string>;
};

export type AssetMeta = {
  firstSeen: string;
};

export type KnownAssets = {
  perps: Record<string, AssetMeta>;
  spot: Record<string, AssetMeta>;
  lastPollAt: string;
};

export type Notifier = {
  notify(event: ListingEvent): Promise<void>;
};

export type HeartbeatStatus = {
  lastPollAt: string;
  perpsCount: number;
  spotCount: number;
};
