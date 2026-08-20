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
            } catch {}
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

    async ping(): Promise<number> {
        const startedAt = Date.now();
        await this.send({ ping: 1 });
        return Date.now() - startedAt;
    }

    async activeSymbols(): Promise<DerivActiveSymbol[]> {
        const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
            { label: "full + product_type:'basic'", payload: { active_symbols: 'full', product_type: 'basic' } },
            { label: "brief + product_type:'basic'", payload: { active_symbols: 'brief', product_type: 'basic' } },
            { label: 'brief (no product_type)', payload: { active_symbols: 'brief' } },
            { label: 'full (no product_type)', payload: { active_symbols: 'full' } },
        ];
        let lastError: Error | null = null;
        for (const attempt of attempts) {
            try {
                const response = await this.send(attempt.payload);
                const symbols: DerivActiveSymbol[] = response?.active_symbols ?? [];
                this.dispatchEvent(
                    new CustomEvent('active-symbols-attempt', {
                        detail: { label: attempt.label, count: symbols.length },
                    })
                );
                if (symbols.length > 0) {
                    return symbols;
                }
            } catch (error: any) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.dispatchEvent(
                    new CustomEvent('active-symbols-attempt', {
                        detail: { label: attempt.label, count: 0, error: lastError.message },
                    })
                );
            }
        }
        if (lastError) {
            throw lastError;
        }
        return [];
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

    async subscribeProposalOpenContract(contractId: string) {
        return this.send({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1,
        });
    }

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

    async contractsFor(symbol: string, currency?: string): Promise<DerivContractSpec[]> {
        const payload: Record<string, unknown> = {
            contracts_for: symbol,
            product_type: 'basic',
        };
        if (currency) {
            payload.currency = currency;
        }

        try {
            const response = await this.send(payload);
            const available = response?.contracts_for?.available ?? [];
            return available.map((item: any) => ({
                contractType: item.contract_type,
                minDuration: parseDuration(item.min_contract_duration),
                maxDuration: parseDuration(item.max_contract_duration),
            }));
        } catch (error: any) {
            throw error;
        }
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
