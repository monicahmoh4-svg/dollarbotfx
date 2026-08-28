// ---------------------------------------------------------------------------
// Live tick recorder (supports the backtest harness).
// Persists ticks fetched during normal scanning into IndexedDB so historical
// data accumulates over time without manual export.
// ---------------------------------------------------------------------------

const DB_NAME = 'dollarbotfx-history';
const STORE = 'ticks';
const MAX_PER_SYMBOL = 40000;

interface StoredTick {
    symbol: string;
    time: number;
    price: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('symbol', 'symbol', { unique: false });
                store.createIndex('symbol_time', ['symbol', 'time'], { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

export function recordMarketTicks(symbol: string, times: number[] | undefined, prices: number[]): void {
    if (!prices || prices.length === 0) return;
    const rows: StoredTick[] = prices.map((p, i) => ({
        symbol,
        time: Array.isArray(times) && Number.isFinite(Number(times[i])) ? Number(times[i]) : 0,
        price: Number(p),
    })).filter((r) => Number.isFinite(r.price));
    if (rows.length === 0) return;
    openDB().then((db) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const r of rows) store.add(r);
        tx.oncomplete = () => trimSymbol(symbol);
    }).catch(() => { /* non-fatal: backtest is best-effort */ });
}

function trimSymbol(symbol: string): void {
    openDB().then((db) => {
        const tx = db.transaction(STORE, 'readwrite');
        const idx = tx.objectStore(STORE).index('symbol');
        const range = IDBKeyRange.only(symbol);
        let count = 0;
        const cursorReq = idx.openCursor(range);
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            count += 1;
            if (count > MAX_PER_SYMBOL) {
                cursor.delete();
                cursor.continue();
            } else {
                cursor.continue();
            }
        };
    }).catch(() => { /* non-fatal */ });
}

export async function loadStoredTicks(symbol: string, limit?: number): Promise<number[]> {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const idx = tx.objectStore(STORE).index('symbol');
        const prices: number[] = [];
        const cursorReq = idx.openCursor(IDBKeyRange.only(symbol));
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
                prices.push((cursor.value as StoredTick).price);
                cursor.continue();
            } else {
                const out = limit && prices.length > limit ? prices.slice(prices.length - limit) : prices;
                resolve(out);
            }
        };
        cursorReq.onerror = () => resolve([]);
    });
}

export async function getStoredRange(symbol: string): Promise<{ count: number; start: number; end: number }> {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const idx = tx.objectStore(STORE).index('symbol');
        let count = 0;
        let start = Infinity;
        let end = -Infinity;
        const cursorReq = idx.openCursor(IDBKeyRange.only(symbol));
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
                const v = cursor.value as StoredTick;
                count += 1;
                if (v.time > 0) {
                    if (v.time < start) start = v.time;
                    if (v.time > end) end = v.time;
                }
                cursor.continue();
            } else {
                resolve({ count, start: start === Infinity ? 0 : start, end: end === -Infinity ? 0 : end });
            }
        };
        cursorReq.onerror = () => resolve({ count: 0, start: 0, end: 0 });
    });
}
