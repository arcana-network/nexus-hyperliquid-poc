import { UserAsset } from "@arcana/ca-sdk";
import { debugInfo } from "../utils/debug";

const cacheKeys = {
  UNIFIED_BALANCES: "unifiedBalances",
  ALREADY_RUNNING: "unifiedBalancesAlreadyRunning",
};

window.nexusCache = new Map<string, any>();

if (window.nexus) {
  window.nexus
    .getUnifiedBalances()
    .then((balances) => {
      window.nexusCache.set(cacheKeys.UNIFIED_BALANCES, {
        balances,
        expiry: Date.now() + 30000, // Cache for 30 seconds
      });
      debugInfo("Unified balances cached:", balances);
    })
    .catch((error) => {
      debugInfo("Failed to fetch unified balances:", error);
    });
}

export function clearCache() {
  window.nexusCache = new Map();
}

export async function fetchUnifiedBalances() {
  debugInfo(
    "UNIFIED BALANCES",
    window.nexusCache,
    window.nexusCache.has(cacheKeys.UNIFIED_BALANCES),
    window.nexusCache.get(cacheKeys.UNIFIED_BALANCES),
    Date.now()
  );
  if (window.nexusCache.has(cacheKeys.UNIFIED_BALANCES)) {
    const cached = window.nexusCache.get(cacheKeys.UNIFIED_BALANCES);
    debugInfo("UNIFIED BALANCES CACHED", cached, Date.now());
    if (cached.expiry > Date.now()) {
      debugInfo("UNIFIED BALANCES RETURNING CACHE");
      return cached.balances as UserAsset[];
    }
  }
  debugInfo("UNIFIED BALANCES CACHE FALLBACK");
  //   if (
  //     window.nexusCache.has(cacheKeys.ALREADY_RUNNING) &&
  //     window.nexusCache.get(cacheKeys.ALREADY_RUNNING)
  //   ) {
  //     debugInfo("UNIFIED BALANCES SKIPPING CROWD");
  //     return [];
  //   }
  window.nexusCache.set(cacheKeys.ALREADY_RUNNING, true);
  debugInfo("UNIFIED BALANCES FETCHING FROM NETWORK");
  const balances = await window.nexus.getUnifiedBalances();
  window.nexusCache.set(cacheKeys.ALREADY_RUNNING, false);
  debugInfo("UNIFIED BALANCES FETCHED FROM NETWORK");
  window.nexusCache.set(cacheKeys.UNIFIED_BALANCES, {
    balances,
    expiry: Date.now() + 60 * 1000, // Cache for 1 minute
  });
  debugInfo("UNIFIED BALANCES Unified balances fetched and cached:", balances);
  return balances;
}
