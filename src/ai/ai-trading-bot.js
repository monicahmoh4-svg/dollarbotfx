/**
 * AI Trading Bot
 * Autonomous trading bot controller
 */

import { tradingEngine } from './deriv-trading-engine';
import { marketAnalyzer } from './market-analyzer';

export class AITradingBot {
    constructor() {
        this.engine = tradingEngine;
        this.analyzer = marketAnalyzer;
        
        this.config = {
            enabled: false,
            mode: 'paper', // 'paper' or 'live'
            appId: '1089',
            apiToken: '',
            
            // Markets to trade
            markets: {
                volatility: true,
                forex: false,
                crypto: false,
                indices: false,
                commodities: false
            },
            
            // Trading parameters
            baseStake: 1,
            currency: 'USD',
            duration: 5,
            durationUnit: 't', // ticks
            
            // Risk management
            maxConcurrentTrades: 1,
            dailyLossLimit: 50,
            dailyProfitTarget: 100,
            cooldownMs: 5000,
            
            // Martingale
            martingaleEnabled: false,
            martingaleMultiplier: 2,
            maxMartingaleSteps: 3,
            maxStake: 100,
            
            // Signal thresholds
            minConfidence: 0.65,
            scanIntervalMs: 10000
        };

        this.scanTimer = null;
        this.isScanning = false;
        this.logs = [];
        
        this.engine.setRiskConfig({
            baseStake: this.config.baseStake,
            maxStake: this.config.maxStake,
            dailyLossLimit: this.config.dailyLossLimit,
            maxConcurrentTrades: this.config.maxConcurrentTrades,
            cooldownMs: this.config.cooldownMs,
            martingaleEnabled: this.config.martingaleEnabled,
            martingaleMultiplier: this.config.martingaleMultiplier,
            maxMartingaleSteps: this.config.maxMartingaleSteps
        });
    }

    async start(config = {}) {
        if (this.config.enabled) {
            this.log('Bot is already running');
            return;
        }

        this.updateConfig(config);
        this.log(`Starting AI bot in ${this.config.mode} mode...`);

        try {
            await this.engine.connect(this.config.appId);
            
            if (this.config.mode === 'live' && this.config.apiToken) {
                await this.engine.authorize(this.config.apiToken);
                await this.engine.getBalance();
                this.log('Live trading authorized successfully');
            } else {
                this.log('Running in paper trading mode');
            }

            this.config.enabled = true;
            this.startScanning();
            this.log('AI bot started successfully');
            
        } catch (error) {
            this.log(`Failed to start: ${error.message}`, 'error');
            throw error;
        }
    }

    stop() {
        if (!this.config.enabled) {
            this.log('Bot is not running');
            return;
        }

        this.config.enabled = false;
        
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }

        this.engine.disconnect();
        this.log('AI bot stopped');
    }

    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.engine.setMode(this.config.mode);
        this.engine.setRiskConfig({
            baseStake: this.config.baseStake,
            maxStake: this.config.maxStake,
            dailyLossLimit: this.config.dailyLossLimit,
            maxConcurrentTrades: this.config.maxConcurrentTrades,
            cooldownMs: this.config.cooldownMs,
            martingaleEnabled: this.config.martingaleEnabled,
            martingaleMultiplier: this.config.martingaleMultiplier,
            maxMartingaleSteps: this.config.maxMartingaleSteps
        });
    }

    startScanning() {
        this.scanTimer = setInterval(() => {
            if (!this.isScanning) {
                this.scan();
            }
        }, this.config.scanIntervalMs);

        // Initial scan
        setTimeout(() => this.scan(), 1000);
    }

    async scan() {
        if (!this.config.enabled || this.isScanning) {
            return;
        }

        this.isScanning = true;
        this.log('Scanning markets...');

        try {
            const symbols = await this.getSymbolsToTrade();
            const signals = await this.analyzer.analyzeMultiple(this.engine, symbols);

            if (signals.length > 0) {
                this.log(`Found ${signals.length} trading opportunities`);
                
                for (const signal of signals) {
                    if (this.engine.canTrade(signal.symbol)) {
                        await this.executeTrade(signal);
                    }
                }
            } else {
                this.log('No high-confidence signals found');
            }

        } catch (error) {
            this.log(`Scan error: ${error.message}`, 'error');
        } finally {
            this.isScanning = false;
        }
    }

    async getSymbolsToTrade() {
        const activeSymbols = await this.engine.getActiveSymbols();
        const symbols = [];

        activeSymbols.forEach(symbol => {
            if (!symbol.is_trading_suspended) {
                const market = symbol.market;
                
                if (this.config.markets.volatility && market === 'synthetic_index') {
                    symbols.push(symbol.symbol);
                }
                if (this.config.markets.forex && market === 'forex') {
                    symbols.push(symbol.symbol);
                }
                if (this.config.markets.crypto && market === 'cryptocurrency') {
                    symbols.push(symbol.symbol);
                }
                if (this.config.markets.indices && market === 'stock_indices') {
                    symbols.push(symbol.symbol);
                }
                if (this.config.markets.commodities && market === 'commodities') {
                    symbols.push(symbol.symbol);
                }
            }
        });

        return symbols.slice(0, 20); // Limit to 20 symbols for performance
    }

    async executeTrade(signal) {
        try {
            const stake = this.engine.calculateStake();
            
            this.log(`Executing ${signal.contractType} on ${signal.symbol}`, 'info');
            this.log(`Reason: ${signal.reason}`, 'info');
            this.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`, 'info');

            const trade = await this.engine.buyContract({
                symbol: signal.symbol,
                contract_type: signal.contractType,
                amount: stake,
                basis: 'stake',
                duration: this.config.duration,
                duration_unit: this.config.durationUnit,
                currency: this.config.currency,
                price: stake
            });

            this.log(`Trade opened: ${trade.contract_id || trade.id}`, 'success');

            // Monitor trade
            this.monitorTrade(trade, signal);

        } catch (error) {
            this.log(`Trade execution failed: ${error.message}`, 'error');
        }
    }

    monitorTrade(trade, signal) {
        const checkInterval = setInterval(() => {
            const tradeData = this.engine.openTrades.get(trade.contract_id || trade.id);
            
            if (!tradeData || tradeData.status === 'closed') {
                clearInterval(checkInterval);
                return;
            }

            // Check if trade expired (for paper trades)
            if (this.config.mode === 'paper') {
                const elapsed = Date.now() - trade.startTime;
                const durationMs = this.config.durationUnit === 't' ? 
                    this.config.duration * 2000 : // ~2 seconds per tick
                    this.config.duration * 1000;

                if (elapsed >= durationMs) {
                    this.closePaperTrade(trade, signal);
                    clearInterval(checkInterval);
                }
            }
        }, 1000);
    }

    async closePaperTrade(trade, signal) {
        try {
            const history = await this.engine.getTickHistory(trade.symbol, 10);
            const prices = history.prices.map(p => parseFloat(p));
            const currentPrice = prices[prices.length - 1];
            const entryPrice = trade.price;

            let profit = 0;
            let win = false;

            if (signal.contractType === 'CALL') {
                win = currentPrice > entryPrice;
            } else if (signal.contractType === 'PUT') {
                win = currentPrice < entryPrice;
            }

            if (win) {
                profit = trade.amount * 0.95; // ~95% payout
                this.engine.recordTrade(true, profit);
                this.log(`Trade WON: +${profit.toFixed(2)} ${this.config.currency}`, 'success');
            } else {
                profit = -trade.amount;
                this.engine.recordTrade(false, profit);
                this.log(`Trade LOST: ${profit.toFixed(2)} ${this.config.currency}`, 'error');
            }

            this.engine.openTrades.delete(trade.id);

        } catch (error) {
            this.log(`Error closing trade: ${error.message}`, 'error');
        }
    }

    log(message, level = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString(),
            level,
            message
        };

        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }

        console.log(`[AI Bot] [${level.toUpperCase()}] ${message}`);
    }

    getStatus() {
        return {
            enabled: this.config.enabled,
            mode: this.config.mode,
            stats: this.engine.stats,
            openTrades: this.engine.openTrades.size,
            logs: this.logs.slice(0, 20)
        };
    }
}

// Export singleton instance
export const aiBot = new AITradingBot();
