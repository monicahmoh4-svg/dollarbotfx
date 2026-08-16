/**
 * Deriv AI Trading Engine
 * Autonomous trading bot for all Deriv markets
 */

export class DerivTradingEngine {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.authorized = false;
        this.appId = '1089'; // Default Deriv app ID
        this.apiToken = '';
        
        // Trading state
        this.isRunning = false;
        this.mode = 'paper'; // 'paper' or 'live'
        this.balance = { demo: 0, real: 0 };
        this.openTrades = new Map();
        
        // Statistics
        this.stats = {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            profit: 0,
            dailyProfit: 0,
            streak: 0
        };
        
        // Risk management
        this.riskConfig = {
            baseStake: 1,
            maxStake: 100,
            dailyLossLimit: 50,
            maxConcurrentTrades: 1,
            cooldownMs: 5000,
            martingaleEnabled: false,
            martingaleMultiplier: 2,
            maxMartingaleSteps: 3
        };
        
        // Market configuration
        this.markets = {
            volatility: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'],
            forex: ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 'frxUSDCAD'],
            crypto: ['cryBTCUSD', 'cryETHUSD'],
            indices: ['stRNG', 'OTC_AS51', 'OTC_SPC'],
            commodities: ['frxXAUUSD', 'frxXAGUSD']
        };
        
        this.lastTradeTime = new Map();
        this.messageHandlers = new Map();
    }

    async connect(appId = '1089') {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return true;
        }

        this.appId = appId;
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
            
            this.ws.onopen = () => {
                this.connected = true;
                console.log('[Deriv Engine] Connected to Deriv WebSocket');
                resolve(true);
            };

            this.ws.onerror = (error) => {
                console.error('[Deriv Engine] WebSocket error:', error);
                reject(error);
            };

            this.ws.onclose = () => {
                this.connected = false;
                this.authorized = false;
                console.log('[Deriv Engine] Disconnected');
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        });
    }

    async authorize(token) {
        if (!this.connected) {
            throw new Error('Not connected to Deriv');
        }

        this.apiToken = token;
        const response = await this.send({ authorize: token });
        
        if (response.error) {
            throw new Error(response.error.message);
        }

        this.authorized = true;
        this.balance.real = response.authorize.balance;
        console.log('[Deriv Engine] Authorized successfully');
        return response.authorize;
    }

    async getBalance() {
        const response = await this.send({ balance: 1, subscribe: 1 });
        if (response.balance) {
            this.balance.real = response.balance.balance;
            this.balance.demo = response.balance.demo_balance || 0;
        }
        return this.balance;
    }

    async getActiveSymbols() {
        const response = await this.send({
            active_symbols: 'brief',
            product_type: 'basic'
        });
        return response.active_symbols || [];
    }

    async getTickHistory(symbol, count = 100) {
        const response = await this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: count,
            end: 'latest',
            style: 'ticks'
        });
        return response.history || { prices: [], times: [] };
    }

    async subscribeTicks(symbol) {
        const response = await this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: 1,
            end: 'latest',
            style: 'ticks',
            subscribe: 1
        });
        return response;
    }

    async unsubscribeTicks(symbol) {
        return this.send({ forget_all: 'ticks' });
    }

    async buyContract(params) {
        if (this.mode === 'paper') {
            return this.executePaperTrade(params);
        }

        const response = await this.send({
            buy: 1,
            price: params.price,
            parameters: {
                contract_type: params.contract_type,
                symbol: params.symbol,
                duration: params.duration,
                duration_unit: params.duration_unit,
                amount: params.amount,
                basis: 'stake',
                currency: params.currency || 'USD'
            }
        });

        if (response.error) {
            throw new Error(response.error.message);
        }

        return response.buy;
    }

    executePaperTrade(params) {
        const tradeId = `paper_${Date.now()}_${Math.random()}`;
        const trade = {
            id: tradeId,
            ...params,
            mode: 'paper',
            startTime: Date.now(),
            status: 'open'
        };

        this.openTrades.set(tradeId, trade);
        this.stats.totalTrades++;

        console.log('[Paper Trade] Opened:', trade);
        return trade;
    }

    async sellContract(contractId) {
        if (this.mode === 'paper') {
            const trade = this.openTrades.get(contractId);
            if (trade) {
                trade.status = 'closed';
                this.openTrades.delete(contractId);
            }
            return { status: 'closed' };
        }

        const response = await this.send({ sell: contractId });
        return response.sell;
    }

    send(request) {
        return new Promise((resolve, reject) => {
            const reqId = Math.floor(Math.random() * 1000000);
            request.req_id = reqId;

            this.messageHandlers.set(reqId, { resolve, reject });

            this.ws.send(JSON.stringify(request));

            setTimeout(() => {
                if (this.messageHandlers.has(reqId)) {
                    this.messageHandlers.delete(reqId);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    handleMessage(data) {
        const message = JSON.parse(data);

        if (message.req_id && this.messageHandlers.has(message.req_id)) {
            const handler = this.messageHandlers.get(message.req_id);
            this.messageHandlers.delete(message.req_id);
            handler.resolve(message);
            return;
        }

        if (message.msg_type === 'tick') {
            this.emit('tick', message.tick);
        }

        if (message.msg_type === 'proposal_open_contract') {
            this.emit('contract_update', message.proposal_open_contract);
        }
    }

    emit(event, data) {
        if (this.eventHandlers && this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }

    on(event, handler) {
        if (!this.eventHandlers) this.eventHandlers = {};
        if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
        this.eventHandlers[event].push(handler);
    }

    setMode(mode) {
        this.mode = mode;
    }

    setRiskConfig(config) {
        this.riskConfig = { ...this.riskConfig, ...config };
    }

    calculateStake() {
        let stake = this.riskConfig.baseStake;

        if (this.riskConfig.martingaleEnabled && this.stats.streak < 0) {
            const steps = Math.min(
                Math.abs(this.stats.streak),
                this.riskConfig.maxMartingaleSteps
            );
            stake = this.riskConfig.baseStake * Math.pow(
                this.riskConfig.martingaleMultiplier,
                steps
            );
        }

        return Math.min(stake, this.riskConfig.maxStake);
    }

    canTrade(symbol) {
        if (this.openTrades.size >= this.riskConfig.maxConcurrentTrades) {
            return false;
        }

        const lastTrade = this.lastTradeTime.get(symbol);
        if (lastTrade && Date.now() - lastTrade < this.riskConfig.cooldownMs) {
            return false;
        }

        if (this.stats.dailyProfit <= -this.riskConfig.dailyLossLimit) {
            return false;
        }

        return true;
    }

    recordTrade(win, profit) {
        if (win) {
            this.stats.wins++;
            this.stats.streak = this.stats.streak > 0 ? this.stats.streak + 1 : 1;
        } else {
            this.stats.losses++;
            this.stats.streak = this.stats.streak < 0 ? this.stats.streak - 1 : -1;
        }

        this.stats.profit += profit;
        this.stats.dailyProfit += profit;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.authorized = false;
    }
}

export const tradingEngine = new DerivTradingEngine();
