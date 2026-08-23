export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

export interface AnalysisResult {
    category: TradeCategory;
    contractType: ContractType | null;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidence: number;
    estimatedWinProbability: number;
    volatility: number;
    sampleSize: number;
    reason: string;
}

function emptyResult(category: TradeCategory, reason: string): AnalysisResult {
    return {
        category, contractType: null, direction: null, barrier: null,
        confidence: 0, estimatedWinProbability: 0.5, volatility: 0,
        sampleSize: 0, reason
    };
}

// ============================================================================
// CANDLE CONSTRUCTION
// ============================================================================

interface Candle {
    open: number;
    high: number;
    low: number;
    close: number;
}

function buildCandles(ticks: number[], period: number): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < ticks.length; i += period) {
        const slice = ticks.slice(i, i + period);
        if (slice.length === 0) continue;
        candles.push({
            open: slice[0],
            high: Math.max(...slice),
            low: Math.min(...slice),
            close: slice[slice.length - 1],
        });
    }
    return candles;
}

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

function ema(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    const k = 2 / (period + 1);
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
        result.push(values[i] * k + result[i - 1] * (1 - k));
    }
    return result;
}

function rsi(closes: number[], period = 14): number[] {
    if (closes.length < period + 1) return [50];
    const result: number[] = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;
    const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs0));
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
    }
    return result;
}

function macd(closes: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return { macd: macdLine, signal: signalLine, histogram };
}

function atr(candles: Candle[], period = 14): number[] {
    if (candles.length < 2) return [0];
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        );
        trs.push(tr);
    }
    return ema(trs, period);
}

// ============================================================================
// REAL MARKET STRATEGY — Multi-Timeframe Trend Pullback
// ============================================================================

export function analyzeRiseFall(ticks: number[]): AnalysisResult {
    if (ticks.length < 300) {
        return emptyResult('rise_fall', `INSUFFICIENT_TICKS: ${ticks.length}`);
    }

    // Build multi-timeframe candles — calibrated for tick-based forex data
    const htfCandles = buildCandles(ticks, 20); // HTF ≈ 20 ticks (~10-20 seconds)
    const ltfCandles = buildCandles(ticks, 5);  // LTF ≈ 5 ticks (~2-5 seconds)

    if (htfCandles.length < 25) {
        return emptyResult('rise_fall', `INSUFFICIENT_HTF_CANDLES: ${htfCandles.length}`);
    }
    if (ltfCandles.length < 30) {
        return emptyResult('rise_fall', `INSUFFICIENT_LTF_CANDLES: ${ltfCandles.length}`);
    }

    const htfCloses = htfCandles.map(c => c.close);
    const ltfCloses = ltfCandles.map(c => c.close);

    // HTF indicators
    const htfEma20 = ema(htfCloses, 20);
    const htfEma50 = ema(htfCloses, Math.min(50, htfCloses.length));
    const htfAtr = atr(htfCandles, 14);

    // LTF indicators
    const ltfEma20 = ema(ltfCloses, 20);
    const ltfRsi = rsi(ltfCloses, 14);
    const ltfMacd = macd(ltfCloses);

    const lastHtfEma20 = htfEma20[htfEma20.length - 1];
    const lastHtfEma50 = htfEma50[htfEma50.length - 1];
    const lastHtfAtr = htfAtr[htfAtr.length - 1];
    const avgHtfAtr = htfAtr.reduce((a, b) => a + b, 0) / htfAtr.length;

    const lastLtfClose = ltfCloses[ltfCloses.length - 1];
    const prevLtfClose = ltfCloses[ltfCloses.length - 2];
    const lastLtfEma20 = ltfEma20[ltfEma20.length - 1];
    const lastLtfRsi = ltfRsi[ltfRsi.length - 1];
    const lastLtfHist = ltfMacd.histogram[ltfMacd.histogram.length - 1];
    const prevLtfHist = ltfMacd.histogram[ltfMacd.histogram.length - 2];

    // Volatility filter — skip dead/choppy markets
    if (avgHtfAtr === 0) {
        return emptyResult('rise_fall', 'ZERO_VOLATILITY');
    }
    if (lastHtfAtr < avgHtfAtr * 0.3) {
        return emptyResult('rise_fall', `LOW_VOLATILITY: ATR=${lastHtfAtr.toFixed(6)}`);
    }

    // Determine HTF trend direction — relaxed threshold for real forex
    const htfBullish = lastHtfEma20 > lastHtfEma50;
    const htfBearish = lastHtfEma20 < lastHtfEma50;

    if (!htfBullish && !htfBearish) {
        return emptyResult('rise_fall', 'NO_CLEAR_TREND: EMAs flat');
    }

    // LTF pullback/rejection detection — relaxed buffer for real forex volatility
    const recentLtfLows = ltfCandles.slice(-15).map(c => c.low);
    const recentLtfHighs = ltfCandles.slice(-15).map(c => c.high);

    let direction: 'CALL' | 'PUT' | null = null;
    let confidence = 0.50;
    const reasons: string[] = [];

    if (htfBullish) {
        // Relaxed EMA touch: within 0.15% of EMA20 (real forex needs this buffer)
        const touchedEma = recentLtfLows.some(low => low <= lastLtfEma20 * 1.0015);
        const bounced = lastLtfClose > prevLtfClose;
        const rsiOk = lastLtfRsi > 35 && lastLtfRsi < 75;
        const macdOk = lastLtfHist > 0 || lastLtfHist > prevLtfHist;

        if (touchedEma && bounced && rsiOk && macdOk) {
            direction = 'CALL';
            confidence = 0.50;
            reasons.push('HTF_Uptrend');
            if (touchedEma) { confidence += 0.10; reasons.push('Pullback'); }
            if (bounced) { confidence += 0.10; reasons.push('Bounce'); }
            if (rsiOk) { confidence += 0.08; reasons.push('RSI_OK'); }
            if (macdOk) { confidence += 0.10; reasons.push('MACD_OK'); }
            const trendStrength = (lastHtfEma20 - lastHtfEma50) / lastHtfEma50;
            if (trendStrength > 0.0005) { confidence += 0.07; reasons.push('StrongTrend'); }
        } else {
            // Diagnostic: why didn't this setup qualify?
            const missing: string[] = [];
            if (!touchedEma) missing.push('no_pullback');
            if (!bounced) missing.push('no_bounce');
            if (!rsiOk) missing.push(`rsi=${lastLtfRsi.toFixed(1)}`);
            if (!macdOk) missing.push('macd_negative');
            return emptyResult('rise_fall', `BULLISH_SETUP_MISSING: ${missing.join(',')}`);
        }
    } else if (htfBearish) {
        const touchedEma = recentLtfHighs.some(high => high >= lastLtfEma20 * 0.9985);
        const rejected = lastLtfClose < prevLtfClose;
        const rsiOk = lastLtfRsi < 65 && lastLtfRsi > 25;
        const macdOk = lastLtfHist < 0 || lastLtfHist < prevLtfHist;

        if (touchedEma && rejected && rsiOk && macdOk) {
            direction = 'PUT';
            confidence = 0.50;
            reasons.push('HTF_Downtrend');
            if (touchedEma) { confidence += 0.10; reasons.push('Pullback'); }
            if (rejected) { confidence += 0.10; reasons.push('Rejection'); }
            if (rsiOk) { confidence += 0.08; reasons.push('RSI_OK'); }
            if (macdOk) { confidence += 0.10; reasons.push('MACD_OK'); }
            const trendStrength = (lastHtfEma50 - lastHtfEma20) / lastHtfEma50;
            if (trendStrength > 0.0005) { confidence += 0.07; reasons.push('StrongTrend'); }
        } else {
            const missing: string[] = [];
            if (!touchedEma) missing.push('no_pullback');
            if (!rejected) missing.push('no_rejection');
            if (!rsiOk) missing.push(`rsi=${lastLtfRsi.toFixed(1)}`);
            if (!macdOk) missing.push('macd_positive');
            return emptyResult('rise_fall', `BEARISH_SETUP_MISSING: ${missing.join(',')}`);
        }
    }

    confidence = Math.min(0.92, confidence);
    const canTrade = direction !== null && confidence >= 0.60; // Relaxed to 0.60

    return {
        category: 'rise_fall',
        contractType: direction ? (direction === 'CALL' ? 'CALL' : 'PUT') as ContractType : null,
        direction,
        barrier: null,
        confidence,
        estimatedWinProbability: confidence,
        volatility: lastHtfAtr,
        sampleSize: ticks.length,
        reason: canTrade ? reasons.join(' + ') : `No setup (Conf: ${(confidence * 100).toFixed(1)}%)`
    };
}

export function analyzeEvenOdd(): AnalysisResult {
    return emptyResult('even_odd', 'NOT_APPLICABLE_REAL_MARKETS');
}
export function analyzeOverUnder(): AnalysisResult {
    return emptyResult('over_under', 'NOT_APPLICABLE_REAL_MARKETS');
}
export function analyzeMatchesDiffers(): AnalysisResult {
    return emptyResult('matches_differs', 'NOT_APPLICABLE_REAL_MARKETS');
}

export function analyzeMarket(category: TradeCategory, quotes: number[], decimals: number): AnalysisResult {
    if (category === 'rise_fall') return analyzeRiseFall(quotes);
    return emptyResult(category, 'ONLY_RISE_FALL_ON_REAL_MARKETS');
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
    let maxDecimals = 0;
    for (const quote of quotes) {
        const text = quote.toString();
        const dotIndex = text.indexOf('.');
        if (dotIndex >= 0) maxDecimals = Math.max(maxDecimals, text.length - dotIndex - 1);
    }
    return maxDecimals > 0 ? Math.min(maxDecimals, 6) : 2;
}

export function lastDigitOf(quote: number, decimals: number): number {
    const scaled = Math.round(quote * Math.pow(10, decimals));
    return Math.abs(scaled % 10);
}
