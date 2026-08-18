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
    pip?: number;
};

export type DerivContractDurationRange = {
    value: number;
    unit: string;
};

export type DerivContractSpec = {
    contractType: string;
    minDuration: DerivContractDurationRange | null;
    maxDuration: DerivContractDurationRange | null;
};

function parseDuration(raw: unknown): DerivContractDurationRange | null {
    if (typeof raw !== 'string') {
        return null;
    }

    const match = raw.trim().match(/^(\d+)\s*([a-zA-Z]+)$/);

    if (!match) {
        return null;
    }

    return { value: Number(match[1]), unit: match[2] };
}

type Waiter = {
    resolve: (value: any) => void;
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
    private lastToken: string | null = null;

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

    /**
     * A WebSocket authorization only applies to the connection it was sent
     * on. This bot used to authorize once at start-up and then assume it
     * stayed authorized — but any dropped connection (network hiccup,
     * mobile tab backgrounded, Wi-Fi handoff, Deriv-side restart) triggers
     * the reconnect logic below with a brand-new, unauthorized socket. The
     * engine's `authorized` flag was never told, so Live mode could sit
     * there believing it was still authorized while every buy silently
     * failed. This now re-authorizes automatically on every reconnect and
     * tells the engine (via events) whether that succeeded, so Live mode
     * never runs blind.
     */
    private handleClose() {
        this.authorized = false;
        this.dispatchEvent(new Event('close'));

        if (!this.shouldReconnect) {
            return;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(async () => {
            this.connectPromise = null;

            try {
                await this.connect();
                this.dispatchEvent(new Event('reconnected'));

                if (this.lastToken) {
                    try {
                        await this.authorize(this.lastToken);
                        this.dispatchEvent(new Event('reauthorized'));
                    } catch (error: any) {
                        this.dispatchEvent(new CustomEvent('reauthorize-failed', { detail: error?.message }));
                    }
                }
            } catch {
                // connect() failing triggers its own onclose, which schedules
                // another reconnect attempt — no separate handling needed here.
            }
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
        this.lastToken = token;
        return response?.authorize;
    }

    /**
     * 'full' (rather than 'brief') is required so each symbol includes its
     * `pip` value — the engine needs that to correctly compute the last
     * traded digit for DIGIT-family contracts (even/odd, over/under,
     * matches/differs). Falls back to 'brief' if 'full' is ever rejected.
     */
    async activeSymbols(): Promise<DerivActiveSymbol[]> {
        try {
            const response = await this.send({
                active_symbols: 'full',
                product_type: 'basic',
            });

            return response?.active_symbols ?? [];
        } catch (error) {
            const response = await this.send({
                active_symbols: 'brief',
                product_type: 'basic',
            });

            return response?.active_symbols ?? [];
        }
    }

    async getTickHistory(symbol: string, count = 300): Promise<DerivTick[]> {
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

    /** Request a price quote for a contract without buying it. Used both to
     * price live trades and to give paper trades a realistic payout ratio. */
    async requestProposal(params: Record<string, unknown>) {
        return this.send({
            proposal: 1,
            ...params,
        });
    }

    async buyProposal(proposalId: string, price: number) {
        return this.send({
            buy: proposalId,
            price,
        });
    }

    /**
     * Not every contract type is actually offered on every symbol, and the
     * valid duration range differs per contract/symbol (e.g. a forex
     * Rise/Fall may only be offered in minutes, while a synthetic index
     * offers ticks). Blindly guessing a duration and contract type — as
     * this bot used to — means Deriv silently rejects the `proposal` call
     * for anything that doesn't match, which looked like "nothing ever
     * trades" from the outside. This fetches the real, current list of
     * contracts Deriv actually offers for a symbol, so the engine can pick
     * a duration that is guaranteed valid instead of guessing.
     */
    async contractsFor(symbol: string, currency = 'USD'): Promise<DerivContractSpec[]> {
        const response = await this.send({
            contracts_for: symbol,
            currency,
            product_type: 'basic',
        });

        const available = response?.contracts_for?.available ?? [];

        return available.map((item: any) => ({
            contractType: item.contract_type,
            minDuration: parseDuration(item.min_contract_duration),
            maxDuration: parseDuration(item.max_contract_duration),
        }));
    }

    close() {
        this.shouldReconnect = false;
        this.lastToken = null;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.ws?.close();
    }
}
