export type DerivTick = {
    symbol: string;
    quote: number;
    epoch: number;
    id?: string;
};

export type DerivActiveSymbol = {
    symbol: string;
    display_name: string;
    market: string;
    submarket?: string;
    exchange_is_open?: number;
    is_trading_suspended?: number;
};

type Waiter = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

export class DerivAPI extends EventTarget {
    private ws: WebSocket | null = null;
    private readonly url: string;
    private reqId = 1;
    private waiters = new Map<number, Waiter>();
    private tickListeners = new Set<(tick: DerivTick) => void>();
    private pocListeners = new Set<(poc: any) => void>();
    private connectPromise: Promise<void> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private shouldReconnect = true;

    authorized = false;

    constructor(appId = '1089') {
        super();
        this.url = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
    }

    connect(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.shouldReconnect = true;

        this.connectPromise = new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;

            const timeout = setTimeout(() => {
                reject(new Error('Deriv WebSocket connection timeout'));
                ws.close();
            }, 15000);

            ws.onopen = () => {
                clearTimeout(timeout);
                resolve();
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Deriv WebSocket error'));
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                this.connectPromise = null;
                this.handleClose();
            };

            ws.onmessage = this.handleMessage;
        });

        return this.connectPromise;
    }

    private handleClose() {
        this.dispatchEvent(new Event('close'));

        if (!this.shouldReconnect) {
            return;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(() => {
            this.connectPromise = null;
            void this.connect();
        }, 3000);
    }

    private handleMessage = (event: MessageEvent) => {
        let data: any;

        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        if (data.msg_type === 'tick' && data.tick) {
            const tick: DerivTick = {
                symbol: data.tick.symbol,
                quote: Number(data.tick.quote),
                epoch: Number(data.tick.epoch),
                id: data.tick.id,
            };

            this.tickListeners.forEach(listener => {
                try {
                    listener(tick);
                } catch (error) {
                    console.error(error);
                }
            });
        }

        if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
            this.pocListeners.forEach(listener => {
                try {
                    listener(data.proposal_open_contract);
                } catch (error) {
                    console.error(error);
                }
            });
        }

        if (data.req_id && this.waiters.has(data.req_id)) {
            const waiter = this.waiters.get(data.req_id)!;
            clearTimeout(waiter.timer);
            this.waiters.delete(data.req_id);

            if (data.error) {
                waiter.reject(new Error(data.error.message || 'Deriv API error'));
            } else {
                waiter.resolve(data);
            }

            return;
        }

        if (data.error) {
            console.error('Deriv API error:', data.error.message);
        }
    };

    async send<T = any>(payload: Record<string, unknown>): Promise<T> {
        await this.connect();

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Deriv WebSocket is not open');
        }

        const req_id = this.reqId++;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(req_id);
                reject(new Error('Deriv API request timeout'));
            }, 30000);

            this.waiters.set(req_id, { resolve, reject, timer });
            this.ws!.send(JSON.stringify({ ...payload, req_id }));
        });
    }

    addTickListener(listener: (tick: DerivTick) => void) {
        this.tickListeners.add(listener);

        return () => {
            this.tickListeners.delete(listener);
        };
    }

    addProposalOpenContractListener(listener: (poc: any) => void) {
        this.pocListeners.add(listener);

        return () => {
            this.pocListeners.delete(listener);
        };
    }

    async authorize(token: string) {
        const response = await this.send({ authorize: token });
        this.authorized = true;
        return response?.authorize;
    }

    async activeSymbols(): Promise<DerivActiveSymbol[]> {
        const response = await this.send({
            active_symbols: 'brief',
            product_type: 'basic',
        });

        return response?.active_symbols ?? [];
    }

    async getTickHistory(symbol: string, count = 90): Promise<DerivTick[]> {
        const response = await this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count,
            end: 'latest',
            style: 'ticks',
        });

        const prices = response?.history?.prices ?? [];
        const times = response?.history?.times ?? [];

        return prices.map((price: string | number, index: number) => ({
            symbol,
            quote: Number(price),
            epoch: Number(times[index] ?? Date.now() / 1000),
        }));
    }

    async subscribeTicks(symbol: string) {
        return this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: 1,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
        });
    }

    close() {
        this.shouldReconnect = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.ws?.close();
    }
}
