// Shared room metrics store — separated from game-socket.ts to avoid
// pulling socket.io into the Next.js page bundle at build time.

export interface RoomMetrics {
    aktifLobiSayisi: number;
    onlineKullaniciSayisi: number;
    aktifMacSayisi: number;
    izleyiciSayisi: number;
    bagliSocketSayisi: number;
}

type RoomMetricsGetter = () => RoomMetrics;

type RoomMetricsGlobal = typeof globalThis & {
    __hushleRoomMetricsGetter?: RoomMetricsGetter;
};

function getMetricsGlobal(): RoomMetricsGlobal {
    return globalThis as RoomMetricsGlobal;
}

/**
 * Register the metrics provider (called by game-socket.ts at startup).
 */
export function registerMetricsProvider(getter: RoomMetricsGetter): void {
    getMetricsGlobal().__hushleRoomMetricsGetter = getter;
}

/**
 * Get current room metrics (safe to call even if socket not initialized).
 */
export function getRoomMetrics(): RoomMetrics {
    const metricsGetter = getMetricsGlobal().__hushleRoomMetricsGetter;
    if (metricsGetter) {
        return metricsGetter();
    }
    return {
        aktifLobiSayisi: 0,
        onlineKullaniciSayisi: 0,
        aktifMacSayisi: 0,
        izleyiciSayisi: 0,
        bagliSocketSayisi: 0,
    };
}
