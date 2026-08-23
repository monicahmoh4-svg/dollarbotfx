export type WSState = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING' | 'READY' | 'RECONNECTING' | 'ERROR' | 'HALTED';

export class DerivWSManager extends EventTarget {
    private ws: WebSocket | null = null;
    private state: WSState = 'DISCONNECTED';
    private reqId = 1;
    private waiters = new Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>();
    private reconnectAttempts = 0;
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private token: string | null = null;
    private appId: string;

    constructor(appId: string) {
        super();
        this.appId = appId;
    }

    getState() { return this.state; }

    async connect(token: string): Promise<void> {
        this.token = token;
        return new Promise((resolve, reject) => {
            this.setState('CONNECTING');
            this.ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`);
            
            const timeout = setTimeout(() => {
                this.ws?.close();
                reject(new Error('WebSocket connection timeout'));
            }, 10000);

            this.ws.onopen = () => {
                clearTimeout(timeout);
                this.setState('AUTHENTICATING');
                this.reconnectAttempts = 0;
                this.startPing();
                this.authenticate(token).then(resolve).catch(reject);
            };

            this.ws.onclose = () => this.handleClose();
            this.ws.onerror = () => {
                clearTimeout(timeout);
                this.setState('ERROR');
            };
            this.ws.onmessage = (event) => this.handleMessage(event);
        });
    }

    private setState(newState: WSState) {
        this.state = newState;
        this.dispatchEvent(new CustomEvent('stateChange', { detail: newState }));
    }

    private async authenticate(token: string) {
        try {
            await this.send({ authorize: token });
            this.setState('READY');
        } catch (e) {
            this.setState('ERROR');
            throw e;
        }
    }

    private startPing() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(async () => {
            if (this.state === 'READY' || this.state === 'RECONNECTING') {
                try {
                    await this.send({ ping: 1 }, 3000);
                } catch {
                    this.handleClose(); // Stale connection
                }
            }
        }, 15000);
    }

    private handleClose() {
        this.setState('RECONNECTING');
        if (this.pingInterval) clearInterval(this.pingInterval);
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        
        setTimeout(() => {
            if (this.token) this.connect(this.token).catch(() => {});
        }, delay);
    }

    private handleMessage(event: MessageEvent) {
        let data: any;
        try { data = JSON.parse(event.data); } catch { return; }

        if (data.req_id && this.waiters.has(data.req_id)) {
            const waiter = this.waiters.get(data.req_id)!;
            clearTimeout(waiter.timer);
            this.waiters.delete(data.req_id);
            if (data.error) waiter.reject(new Error(data.error.message));
            else waiter.resolve(data);
        }
    }

    async send<T = any>(payload: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
        if (this.state !== 'READY' && this.state !== 'AUTHENTICATING') {
            throw new Error(`WebSocket not ready. State: ${this.state}`);
        }
        const req_id = this.reqId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(req_id);
                reject(new Error('Request timeout'));
            }, timeoutMs);
            this.waiters.set(req_id, { resolve, reject, timer });
            this.ws!.send(JSON.stringify({ ...payload, req_id }));
        });
    }

    halt() {
        this.setState('HALTED');
        this.ws?.close();
        if (this.pingInterval) clearInterval(this.pingInterval);
    }
}
