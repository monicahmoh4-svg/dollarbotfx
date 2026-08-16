/**
 * Market Analyzer
 * Analyzes Deriv markets and generates trading signals
 */

export class MarketAnalyzer {
    constructor() {
        this.minConfidence = 0.65;
        this.minTicks = 30;
    }

    /**
     * Calculate RSI (Relative Strength Index)
     */
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;

        let gains = 0;
        let losses = 0;

        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses += Math.abs(change);
            }
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        return rsi;
    }

    /**
     * Calculate EMA (Exponential Moving Average)
     */
    calculateEMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];

        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }

        return ema;
    }

    /**
     * Calculate volatility (standard deviation)
     */
    calculateVolatility(prices) {
        if (prices.length < 2) return 0;

        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((sum, price) => {
            return sum + Math.pow(price - mean, 2);
        }, 0) / prices.length;

        return Math.sqrt(variance);
    }

    /**
     * Detect trend direction
     */
    detectTrend(prices) {
        if (prices.length < 10) return 'neutral';

        const recent = prices.slice(-10);
        const first5 = recent.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        const last5 = recent.slice(-5).reduce((a, b) => a + b, 0) / 5;

        const change = (last5 - first5) / first5;

        if (change > 0.001) return 'up';
        if (change < -0.001) return 'down';
        return 'neutral';
    }

    /**
     * Detect patterns (higher highs, lower lows, etc.)
     */
    detectPatterns(prices) {
        if (prices.length < 20) return { pattern: 'none' };

        const recent = prices.slice(-20);
        const peaks = [];
        const troughs = [];

        for (let i = 2; i < recent.length - 2; i++) {
            if (recent[i] > recent[i - 1] && recent[i] > recent[i + 1] &&
                recent[i] > recent[i - 2] && recent[i] > recent[i + 2]) {
                peaks.push({ price: recent[i], index: i });
            }
            if (recent[i] < recent[i - 1] && recent[i] < recent[i + 1] &&
                recent[i] < recent[i - 2] && recent[i] < recent[i + 2]) {
                troughs.push({ price: recent[i], index: i });
            }
        }

        if (peaks.length >= 2) {
            const last2Peaks = peaks.slice(-2);
            if (last2Peaks[1].price > last2Peaks[0].price) {
                return { pattern: 'higher_highs', strength: 0.7 };
            }
        }

        if (troughs.length >= 2) {
            const last2Troughs = troughs.slice(-2);
            if (last2Troughs[1].price < last2Troughs[0].price) {
                return { pattern: 'lower_lows', strength: 0.7 };
            }
        }

        return { pattern: 'none', strength: 0 };
    }

    /**
     * Analyze digit patterns (for digit trading)
     */
    analyzeDigitPatterns(prices) {
        if (prices.length < 50) return null;

        const digits = prices.map(p => Math.floor(p * 100) % 10);
        const digitCounts = new Array(10).fill(0);

        digits.forEach(d => digitCounts[d]++);

        const recent = digits.slice(-20);
        const recentCounts = new Array(10).fill(0);
        recent.forEach(d => recentCounts[d]++);

        // Find most frequent recent digit
        let maxDigit = 0;
        let maxCount = 0;
        recentCounts.forEach((count, digit) => {
            if (count > maxCount) {
                maxCount = count;
                maxDigit = digit;
            }
        });

        const frequency = maxCount / recent.length;

        if (frequency >= 0.25) {
            return {
                type: 'matches',
                digit: maxDigit,
                confidence: frequency,
                description: `Digit ${maxDigit} appeared ${maxCount} times in last 20 ticks`
            };
        }

        // Check for odd/even bias
        const oddCount = recent.filter(d => d % 2 === 1).length;
        const evenCount = recent.length - oddCount;

        if (oddCount / recent.length >= 0.65) {
            return {
                type: 'odd',
                confidence: oddCount / recent.length,
                description: `${oddCount} odd digits in last 20 ticks`
            };
        }

        if (evenCount / recent.length >= 0.65) {
            return {
                type: 'even',
                confidence: evenCount / recent.length,
                description: `${evenCount} even digits in last 20 ticks`
            };
        }

        return null;
    }

    /**
     * Generate trading signal for a symbol
     */
    generateSignal(symbol, prices, symbolInfo = {}) {
        if (prices.length < this.minTicks) {
            return {
                symbol,
                signal: 'WAIT',
                confidence: 0,
                reason: 'Insufficient data'
            };
        }

        const rsi = this.calculateRSI(prices);
        const emaShort = this.calculateEMA(prices, 5);
        const emaLong = this.calculateEMA(prices, 20);
        const volatility = this.calculateVolatility(prices);
        const trend = this.detectTrend(prices);
        const patterns = this.detectPatterns(prices);
        const currentPrice = prices[prices.length - 1];

        let signal = 'WAIT';
        let confidence = 0;
        let contractType = null;
        let reason = '';

        // RSI-based signals
        if (rsi < 30 && trend === 'up') {
            signal = 'BUY';
            confidence = 0.7;
            contractType = 'CALL';
            reason = `RSI oversold (${rsi.toFixed(1)}) with upward trend`;
        } else if (rsi > 70 && trend === 'down') {
            signal = 'SELL';
            confidence = 0.7;
            contractType = 'PUT';
            reason = `RSI overbought (${rsi.toFixed(1)}) with downward trend`;
        }

        // EMA crossover signals
        if (signal === 'WAIT') {
            if (emaShort > emaLong && trend === 'up') {
                signal = 'BUY';
                confidence = 0.65;
                contractType = 'CALL';
                reason = `EMA crossover bullish: ${emaShort.toFixed(4)} > ${emaLong.toFixed(4)}`;
            } else if (emaShort < emaLong && trend === 'down') {
                signal = 'SELL';
                confidence = 0.65;
                contractType = 'PUT';
                reason = `EMA crossover bearish: ${emaShort.toFixed(4)} < ${emaLong.toFixed(4)}`;
            }
        }

        // Pattern-based signals
        if (signal === 'WAIT' && patterns.pattern !== 'none') {
            if (patterns.pattern === 'higher_highs') {
                signal = 'BUY';
                confidence = patterns.strength;
                contractType = 'CALL';
                reason = 'Higher highs pattern detected';
            } else if (patterns.pattern === 'lower_lows') {
                signal = 'SELL';
                confidence = patterns.strength;
                contractType = 'PUT';
                reason = 'Lower lows pattern detected';
            }
        }

        // Volatility filter
        if (volatility > 0.01) {
            confidence *= 0.8; // Reduce confidence in high volatility
            reason += ' (high volatility)';
        }

        // Digit trading for digit markets
        if (symbol.includes('DIGIT') || symbolInfo.market === 'synthetic_index') {
            const digitSignal = this.analyzeDigitPatterns(prices);
            if (digitSignal && digitSignal.confidence >= 0.6) {
                signal = digitSignal.type === 'matches' ? 'MATCH' : 
                         digitSignal.type === 'odd' ? 'ODD' : 'EVEN';
                confidence = digitSignal.confidence;
                contractType = signal;
                reason = digitSignal.description;
            }
        }

        // Only trade if confidence is high enough
        if (confidence < this.minConfidence) {
            signal = 'WAIT';
            confidence = 0;
        }

        return {
            symbol,
            signal,
            contractType,
            confidence,
            reason,
            indicators: {
                rsi,
                emaShort,
                emaLong,
                volatility,
                trend,
                currentPrice
            }
        };
    }

    /**
     * Analyze multiple symbols and return best opportunities
     */
    async analyzeMultiple(engine, symbols) {
        const signals = [];

        for (const symbol of symbols) {
            try {
                const history = await engine.getTickHistory(symbol, 100);
                const prices = history.prices.map(p => parseFloat(p));
                
                if (prices.length >= this.minTicks) {
                    const signal = this.generateSignal(symbol, prices);
                    if (signal.signal !== 'WAIT') {
                        signals.push(signal);
                    }
                }
            } catch (error) {
                console.error(`Error analyzing ${symbol}:`, error);
            }
        }

        // Sort by confidence
        signals.sort((a, b) => b.confidence - a.confidence);

        return signals.slice(0, 5); // Top 5 opportunities
    }
}

export const marketAnalyzer = new MarketAnalyzer();
