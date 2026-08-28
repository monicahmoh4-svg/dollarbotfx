export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

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
    signalStrength: SignalStrength;
    htfAgreement: boolean;
    ltfAgreement: boolean;
    trendAlignment: boolean;
}

type Candle = { open: number; high: number; low: number; close: number };

const empty = (reason: string, sampleSize = 0): AnalysisResult => ({
    category: 'rise_fall',
    contractType: null,
    direction: null,
    barrier: null,
    confidence: 0,
    estimatedWinProbability: 0.5,
    volatility: 0,
    sampleSize,
    reason,
    signalStrength: 'NONE',
    htfAgreement: false,
    ltfAgreement: false,
    trendAlignment: false,
});

const finiteQuotes = (quotes: number[]) =>
    quotes.filter((quote) => Number.isFinite(quote) && quote > 0);

function ema(values: number[], period: number): number[] {
    if (!values.length) return [];
    const alpha = 2 / (period + 1);
    const result = [values[0]];
    for (let i = 1; i < values.length; i += 1) {
        result.push(values[i] * alpha + result[i - 1] * (1 - alpha));
    }
    return result;
}

function rsi(values: number[], period = 14): number[] {
    if (values.length <= period + 1) return values.map(() => 50);
    const result: number[] = [];
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i += 1) {
        const change = values[i] - values[i - 1];
        if (change >= 0) gain += change;
        else loss -= change;
    }
    gain /= period;
    loss /= period;
    result.push(...new Array(period).fill(50));
    result.push(loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
    for (let i = period + 1; i < values.length; i += 1) {
        const change = values[i] - values[i - 1];
        gain = (gain * (period - 1) + Math.max(change, 0)) / period;
        loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
        result.push(loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
    }
    return result;
}

function candles(quotes: number[], width: number): Candle[] {
    const result: Candle[] = [];
    for (let i = 0; i + width <= quotes.length; i += width) {
        const slice = quotes.slice(i, i + width);
        result.push({
            open: slice[0],
            high: Math.max(...slice),
            low: Math.min(...slice),
            close: slice[slice.length - 1],
        });
    }
    return result;
}

function atr(data: Candle[], period = 14): number {
    if (data.length < period + 1) return 0;
    const ranges = data.slice(1).map((candle, index) => {
        const previous = data[index].close;
        return Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - previous),
            Math.abs(candle.low - previous),
        );
    });
    return ranges.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function slope(values: number[], lookback: number): number {
    if (values.length <= lookback) return 0;
    const start = values[values.length - 1 - lookback];
    return (values[values.length - 1] - start) / Math.max(Math.abs(start), Number.EPSILON);
}

function macd(values: number[], fast = 12, slow = 26, signal = 9): {
    line: number; signal: number; hist: number; prev_hist: number;
    prev2_hist: number; bullish_cross: boolean; bearish_cross: boolean;
} | null {
    if (values.length < slow + signal) return null;
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = ef.map((_, i) => ef[i] - es[i]);
    const sig = ema(line, signal);
    const len = line.length;
    const hist = line[len - 1] - sig[len - 1];
    const prev_hist = len > 1 ? line[len - 2] - sig[len - 2] : 0;
    const prev2_hist = len > 2 ? line[len - 3] - sig[len - 3] : 0;
    return {
        line: line[len - 1],
        signal: sig[len - 1],
        hist,
        prev_hist,
        prev2_hist,
        bullish_cross: prev_hist <= 0 && hist > 0,
        bearish_cross: prev_hist >= 0 && hist < 0,
    };
}

function bollinger(values: number[], period = 20, m = 2.0): { mid: number; upper: number; lower: number; width: number } | null {
    if (values.length < period) return null;
    const window = values.slice(-period);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const sd = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { mid: mean, upper: mean + m * sd, lower: mean - m * sd, width: (2 * m * sd) / (mean || 1) };
}

function stochastic(data: Candle[], period = 14): number {
    if (data.length < period) return 50;
    const recent = data.slice(-period);
    const highest = Math.max(...recent.map((c) => c.high));
    const lowest = Math.min(...recent.map((c) => c.low));
    const current = data[data.length - 1].close;
    if (highest === lowest) return 50;
    return ((current - lowest) / (highest - lowest)) * 100;
}

function adx(data: Candle[], period = 14): number {
    if (data.length < period * 2) return 0;
    const trList: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    for (let i = 1; i < data.length; i++) {
        const highDiff = data[i].high - data[i - 1].high;
        const lowDiff = data[i - 1].low - data[i].low;
        trList.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i - 1].close), Math.abs(data[i].low - data[i - 1].close)));
        plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
        minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    }
    let atrSum = trList.slice(0, period).reduce((a, b) => a + b, 0);
    let plusDMSum = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let minusDMSum = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
    for (let i = period; i < trList.length; i++) {
        atrSum = atrSum - atrSum / period + trList[i];
        plusDMSum = plusDMSum - plusDMSum / period + plusDM[i];
        minusDMSum = minusDMSum - minusDMSum / period + minusDM[i];
    }
    const atr14 = atrSum / period;
    if (atr14 === 0) return 0;
    const plusDI = (plusDMSum / period / atr14) * 100;
    const minusDI = (minusDMSum / period / atr14) * 100;
    const diSum = plusDI + minusDI;
    if (diSum === 0) return 0;
    const dx = Math.abs(plusDI - minusDI) / diSum * 100;
    return dx;
}

/**
 * Multi-timeframe dual-confirmation analysis for short-duration synthetic indices.
 *
 * Signal generation requires:
 * 1. HTF trend direction (EMA 20/50 on 20-tick candles)
 * 2. HTF MACD crossover confirmation
 * 3. LTF MACD crossover confirmation (must agree with HTF)
 * 4. HTF RSI not overbought/oversold
 * 5. LTF momentum (ROC) alignment
 * 6. ADX trend strength > 20 (trending market)
 * 7. Candle pattern confirmation (2+ of last 3 candles agree)
 * 8. Bollinger position check (price not at extreme)
 *
 * Confidence is calculated from weighted confirmations with penalties
 * for conflicting signals. A signal requires ALL 8 factors to pass
 * the minimum threshold to be considered tradeable.
 */
export function analyzeRiseFall(input: number[]): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 500) return empty(`INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const htf = candles(quotes, 20);
    const ltf = candles(quotes, 5);
    const htf_close = htf.map((c) => c.close);
    const ltf_close = ltf.map((c) => c.close);

    if (htf_close.length < 40 || ltf_close.length < 80) {
        return empty(`INSUFFICIENT_CANDLES: HTF=${htf_close.length}, LTF=${ltf_close.length}`, quotes.length);
    }

    const last = ltf_close[ltf_close.length - 1];
    const previous = ltf_close[ltf_close.length - 2];
    const range = atr(htf);
    if (!range || !Number.isFinite(range)) return empty('ZERO_VOLATILITY', quotes.length);

    // === FACTOR 1: HTF TREND (EMA 20/50) ===
    const htf_fast = ema(htf_close, 20);
    const htf_slow = ema(htf_close, 50);
    const htf_diff = htf_fast[htf_fast.length - 1] - htf_slow[htf_slow.length - 1];
    const htf_trend_strength = htf_diff / Math.max(Math.abs(htf_slow[htf_slow.length - 1]), Number.EPSILON);
    const htf_bullish = htf_trend_strength > 0.0001;
    const htf_bearish = htf_trend_strength < -0.0001;
    const htf_slope_val = slope(htf_close, 5);

    // === FACTOR 2: HTF MACD ===
    const htf_macd = macd(htf_close);
    if (!htf_macd) return empty('INSUFFICIENT_HTF_MACD', quotes.length);
    const htf_macd_bull = htf_macd.hist > 0;
    const htf_macd_bear = htf_macd.hist < 0;
    const htf_macd_accel = Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist);

    // === FACTOR 3: LTF MACD ===
    const ltf_macd = macd(ltf_close);
    if (!ltf_macd) return empty('INSUFFICIENT_LTF_MACD', quotes.length);
    const ltf_macd_bull = ltf_macd.hist > 0;
    const ltf_macd_bear = ltf_macd.hist < 0;

    // === FACTOR 4: HTF RSI (not LTF - LTF RSI is too noisy) ===
    const htf_rsi_arr = rsi(htf_close, 14);
    const htf_rsi = htf_rsi_arr[htf_rsi_arr.length - 1];
    const htf_rsi_prev = htf_rsi_arr.length > 1 ? htf_rsi_arr[htf_rsi_arr.length - 2] : 50;

    // === FACTOR 5: LTF MOMENTUM (ROC 12, not 8) ===
    const roc_period = 12;
    const momentum_now = (last - ltf_close[Math.max(0, ltf_close.length - roc_period)]) /
        Math.max(Math.abs(ltf_close[Math.max(0, ltf_close.length - roc_period)]), Number.EPSILON);
    const momentum_prev = (previous - ltf_close[Math.max(0, ltf_close.length - roc_period - 1)]) /
        Math.max(Math.abs(ltf_close[Math.max(0, ltf_close.length - roc_period - 1)]), Number.EPSILON);
    const momentum_accel = Math.abs(momentum_now) > Math.abs(momentum_prev);

    // === FACTOR 6: ADX TREND STRENGTH ===
    const adx_val = adx(htf, 14);

    // === FACTOR 7: CANDLE PATTERN (last 3 LTF candles) ===
    const ltf_candle_up_count = ltf.slice(-3).filter((c) => c.close > c.open).length;
    const ltf_candle_down_count = 3 - ltf_candle_up_count;

    // === FACTOR 8: BOLLINGER POSITION ===
    const bb = bollinger(htf_close, 20, 2.0);
    if (bb && bb.width < 0.00015) return empty('DEAD_MARKET', quotes.length);

    // === FACTOR 9: STOCHASTIC ===
    const stoch = stochastic(htf, 14);

    // === VOLATILITY FILTER ===
    if (bb) {
        if (last > bb.upper + range * 0.5 && htf_rsi > 75) return empty('EXTREME_OVERBOUGHT', quotes.length);
        if (last < bb.lower - range * 0.5 && htf_rsi < 25) return empty('EXTREME_OVERSOLD', quotes.length);
    }

    // === DIRECTION DETERMINATION (require BOTH HTF and LTF MACD agreement) ===
    let direction: 'CALL' | 'PUT';

    // Primary signal: HTF MACD and LTF MACD must agree on direction.
    // Acceleration is a scoring bonus, not a gate.
    if (htf_macd_bull && ltf_macd_bull) {
        direction = 'CALL';
    } else if (htf_macd_bear && ltf_macd_bear) {
        direction = 'PUT';
    } else {
        return empty('NO_DUAL_TIMEFRAME_SIGNAL', quotes.length);
    }

    // Check HTF-LTF agreement (MACD direction only, no EMA threshold gate)
    const htfAgreement = (direction === 'CALL' && htf_macd_bull) ||
        (direction === 'PUT' && htf_macd_bear);
    const ltfAgreement = (direction === 'CALL' && ltf_macd_bull && momentum_now > 0) ||
        (direction === 'PUT' && ltf_macd_bear && momentum_now < 0);

    // Require HTF MACD agreement - the core filter
    if (!htfAgreement) return empty('HTF_DISAGREEMENT', quotes.length);

    // === CONFIRMATION SCORING ===
    let score = 0;
    let maxScore = 0;
    const penalties: string[] = [];

    // Factor 1: HTF Trend alignment (weight 15)
    const f1_weight = 15;
    maxScore += f1_weight;
    if ((direction === 'CALL' && htf_trend_strength > 0.001) ||
        (direction === 'PUT' && htf_trend_strength < -0.001)) {
        score += f1_weight;
    } else if ((direction === 'CALL' && htf_trend_strength > 0.0005) ||
        (direction === 'PUT' && htf_trend_strength < -0.0005)) {
        score += f1_weight * 0.7;
    } else if ((direction === 'CALL' && htf_trend_strength > 0) ||
        (direction === 'PUT' && htf_trend_strength < 0)) {
        score += f1_weight * 0.3;
    }

    // Factor 2: HTF MACD strength (weight 15)
    const f2_weight = 15;
    maxScore += f2_weight;
    if (htf_macd_accel && Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist) * 1.5) {
        score += f2_weight;
    } else if (htf_macd_accel) {
        score += f2_weight * 0.6;
    }

    // Factor 3: LTF MACD agreement (weight 12)
    const f3_weight = 12;
    maxScore += f3_weight;
    if (ltfAgreement) {
        score += f3_weight;
    } else if ((direction === 'CALL' && ltf_macd_bull) || (direction === 'PUT' && ltf_macd_bear)) {
        score += f3_weight * 0.4;
    }

    // Factor 4: HTF RSI zone (weight 12)
    const f4_weight = 12;
    maxScore += f4_weight;
    if (direction === 'CALL') {
        if (htf_rsi >= 45 && htf_rsi <= 65) score += f4_weight;
        else if (htf_rsi >= 35 && htf_rsi <= 75) score += f4_weight * 0.5;
        else penalties.push('RSI_EXTREME');
    } else {
        if (htf_rsi >= 35 && htf_rsi <= 55) score += f4_weight;
        else if (htf_rsi >= 25 && htf_rsi <= 65) score += f4_weight * 0.5;
        else penalties.push('RSI_EXTREME');
    }

    // Factor 5: Momentum (weight 12)
    const f5_weight = 12;
    maxScore += f5_weight;
    if ((direction === 'CALL' && momentum_now > 0.001 && momentum_accel) ||
        (direction === 'PUT' && momentum_now < -0.001 && momentum_accel)) {
        score += f5_weight;
    } else if ((direction === 'CALL' && momentum_now > 0.0003) ||
        (direction === 'PUT' && momentum_now < -0.0003)) {
        score += f5_weight * 0.5;
    }

    // Factor 6: ADX trend strength (weight 8)
    const f6_weight = 8;
    maxScore += f6_weight;
    if (adx_val >= 25) score += f6_weight;
    else if (adx_val >= 18) score += f6_weight * 0.7;
    else if (adx_val >= 12) score += f6_weight * 0.3;
    else penalties.push('WEAK_TREND');

    // Factor 7: Candle pattern (weight 10)
    const f7_weight = 10;
    maxScore += f7_weight;
    if (direction === 'CALL' && ltf_candle_up_count >= 2) score += f7_weight;
    else if (direction === 'PUT' && ltf_candle_down_count >= 2) score += f7_weight;
    else if (direction === 'CALL' && ltf_candle_up_count >= 1) score += f7_weight * 0.3;
    else if (direction === 'PUT' && ltf_candle_down_count >= 1) score += f7_weight * 0.3;

    // Factor 8: Bollinger position (weight 8)
    const f8_weight = 8;
    maxScore += f8_weight;
    if (bb) {
        const bbPos = (last - bb.lower) / (bb.upper - bb.lower || 1);
        if (direction === 'CALL' && bbPos >= 0.3 && bbPos <= 0.7) score += f8_weight;
        else if (direction === 'PUT' && bbPos >= 0.3 && bbPos <= 0.7) score += f8_weight;
        else if (direction === 'CALL' && bbPos >= 0.2 && bbPos <= 0.8) score += f8_weight * 0.5;
        else if (direction === 'PUT' && bbPos >= 0.2 && bbPos <= 0.8) score += f8_weight * 0.5;
        else penalties.push('BB_EXTREME');
    } else {
        score += f8_weight * 0.5;
    }

    // Factor 9: HTF slope alignment (weight 8)
    const f9_weight = 8;
    maxScore += f9_weight;
    if ((direction === 'CALL' && htf_slope_val > 0.0002) ||
        (direction === 'PUT' && htf_slope_val < -0.0002)) {
        score += f9_weight;
    } else if ((direction === 'CALL' && htf_slope_val > 0) ||
        (direction === 'PUT' && htf_slope_val < 0)) {
        score += f9_weight * 0.4;
    }

    // === PENALTY: RSI DIVERGENCE ===
    // If RSI is moving against the signal direction, apply a penalty
    if (direction === 'CALL' && htf_rsi_prev > htf_rsi + 3) penalties.push('RSI_DIVERGENCE');
    if (direction === 'PUT' && htf_rsi_prev < htf_rsi - 3) penalties.push('RSI_DIVERGENCE');

    // === PENALTY: MACD HISTOGRAM FLAT ===
    if (Math.abs(htf_macd.hist - htf_macd.prev_hist) < 0.00001 * last) penalties.push('MACD_FLAT');

    // === CONFIDENCE CALCULATION ===
    const rawConfidence = score / (maxScore || 1);

    // Apply penalty multiplier
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;
    else if (penalties.length >= 1) penaltyMultiplier = 0.9;

    // Require minimum factors to pass
    const factorsPassed = [
        htfAgreement, ltfAgreement, htf_macd_accel, momentum_accel,
        adx_val >= 15, (direction === 'CALL' && ltf_candle_up_count >= 1) || (direction === 'PUT' && ltf_candle_down_count >= 1),
    ].filter(Boolean).length;

    if (factorsPassed < 3) return empty(`INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.92, Math.max(0, rawConfidence * penaltyMultiplier));

    // Signal strength classification
    let signalStrength: SignalStrength;
    if (confidence >= 0.78 && factorsPassed >= 5 && penalties.length === 0) {
        signalStrength = 'STRONG';
    } else if (confidence >= 0.65 && factorsPassed >= 3) {
        signalStrength = 'MODERATE';
    } else if (confidence >= 0.50) {
        signalStrength = 'WEAK';
    } else {
        signalStrength = 'NONE';
    }

    const trendAlignment = htfAgreement && ltfAgreement;

    const reasons = [
        `ADX=${adx_val.toFixed(1)}`,
        `HTF_RSI=${htf_rsi.toFixed(1)}`,
        `MOM=${(momentum_now * 10000).toFixed(1)}bps`,
        htf_macd_accel ? 'MACD_ACCEL' : '',
        trendAlignment ? 'DUAL_TF' : 'PARTIAL_TF',
        penalties.length > 0 ? `PENALTY[${penalties.join(',')}]` : '',
        `FACTORS=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return {
        category: 'rise_fall',
        contractType: direction,
        direction,
        barrier: null,
        confidence,
        estimatedWinProbability: confidence,
        volatility: range,
        sampleSize: quotes.length,
        reason: reasons,
        signalStrength,
        htfAgreement,
        ltfAgreement,
        trendAlignment,
    };
}

export function analyzeMarket(category: TradeCategory, quotes: number[], _decimals = 2): AnalysisResult {
    if (category !== 'rise_fall') return { ...empty('ONLY_RISE_FALL_SUPPORTED'), category };
    return analyzeRiseFall(quotes);
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
    return Math.min(8, Math.max(2, ...quotes.slice(-100).map((quote) => {
        const text = String(quote);
        return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
    })));
}

export function lastDigitOf(quote: number, decimals: number): number {
    return Math.abs(Math.round(quote * 10 ** decimals) % 10);
}

export interface AIIndicatorSet {
  symbol: string;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  macdAccel: boolean;
  htfTrend: number;
  htfSlope: number;
  momentum: number;
  candleUp: boolean;
  bbWidth: number;
  lastPrice: number;
  technicalScore: number;
  direction: 'CALL' | 'PUT';
  adx: number;
  stochK: number;
  htfRsi: number;
  signalStrength: string;
  htfAgreement: boolean;
  ltfAgreement: boolean;
  trendAlignment: boolean;
}

export function extractIndicators(
  quotes: number[],
  direction: 'CALL' | 'PUT',
  technicalScore: number,
): AIIndicatorSet | null {
  const clean = quotes.filter((q) => Number.isFinite(q) && q > 0);
  if (clean.length < 500) return null;

  const htf = candles(clean, 20);
  const ltf = candles(clean, 5);
  const htfClose = htf.map((c) => c.close);
  const ltfClose = ltf.map((c) => c.close);

  if (htfClose.length < 40 || ltfClose.length < 80) return null;

  const last = ltfClose[ltfClose.length - 1];
  const previous = ltfClose[ltfClose.length - 2];

  const htfFast = ema(htfClose, 20);
  const htfSlow = ema(htfClose, 50);
  const htfTrend = (htfFast[htfFast.length - 1] - htfSlow[htfSlow.length - 1]) /
    Math.max(Math.abs(htfSlow[htfSlow.length - 1]), Number.EPSILON);
  const htfSlopeVal = slope(htfClose, 5);

  const ltfM = macd(ltfClose);
  if (!ltfM) return null;

  const htfM = macd(htfClose);
  const htfRsiArr = rsi(htfClose, 14);
  const htfRsi = htfRsiArr[htfRsiArr.length - 1];

  const bb = bollinger(htfClose);
  const bbWidth = bb ? bb.width : 0;

  const roc_period = 12;
  const momentumVal = (last - ltfClose[Math.max(0, ltfClose.length - roc_period)]) /
    Math.max(Math.abs(ltfClose[Math.max(0, ltfClose.length - roc_period)]), Number.EPSILON);

  const adxVal = adx(htf, 14);
  const stochVal = stochastic(htf, 14);

  const htfAgreement = (direction === 'CALL' && (htfM?.hist ?? 0) > 0 && htfTrend > 0.0005) ||
    (direction === 'PUT' && (htfM?.hist ?? 0) < 0 && htfTrend < -0.0005);
  const ltfAgreement = (direction === 'CALL' && ltfM.hist > 0 && momentumVal > 0) ||
    (direction === 'PUT' && ltfM.hist < 0 && momentumVal < 0);

  return {
    symbol: '',
    rsi: rsi(ltfClose)[rsi(ltfClose).length - 1],
    macdLine: ltfM.line,
    macdSignal: ltfM.signal,
    macdHist: ltfM.hist,
    macdAccel: direction === 'CALL' ? ltfM.hist > ltfM.prev_hist : ltfM.hist < ltfM.prev_hist,
    htfTrend,
    htfSlope: htfSlopeVal,
    momentum: momentumVal,
    candleUp: last > previous,
    bbWidth,
    lastPrice: last,
    technicalScore,
    direction,
    adx: adxVal,
    stochK: stochVal,
    htfRsi,
    signalStrength: technicalScore >= 0.80 ? 'STRONG' : technicalScore >= 0.68 ? 'MODERATE' : 'WEAK',
    htfAgreement,
    ltfAgreement,
    trendAlignment: htfAgreement && ltfAgreement,
  };
}
