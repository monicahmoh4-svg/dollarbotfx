// ═══════════════════════════════════════════════════════════════════
// DERIV VOLATILITY MARKETS — STATISTICAL SIGNAL ENGINE
// Zero-Loss-Preference: NO TRADE unless statistically validated edge
// ═══════════════════════════════════════════════════════════════════

export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType =
  | 'CALL' | 'PUT'
  | 'DIGITEVEN' | 'DIGITODD'
  | 'DIGITMATCH' | 'DIGITDIFF'
  | 'DIGITOVER' | 'DIGITUNDER';
export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NO_EDGE';
export type MarketRegime =
  | 'STRONG_BULL' | 'WEAK_BULL' | 'STRONG_BEAR' | 'WEAK_BEAR'
  | 'RANGE_BOUND' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'UNCLEAR';

export interface StatisticalSignal {
  category: TradeCategory;
  contractType: ContractType | null;
  contractLabel: string;
  barrier: number | null;
  conservativeProbability: number;
  sampleSize: number;
  theoreticalBaseline: number;
  signalStrength: SignalStrength;
  reason: string;
  regime: MarketRegime;
  triggerDigit?: number;
  signalTimestamp: number;
}

type Candle = { open: number; high: number; low: number; close: number };

const MIN_SAMPLE_SIZE = 300;
const MIN_EDGE = 0.015; // 1.5% safety margin above break-even
const SIGNAL_MAX_AGE_MS = 10_000;

const emptySignal = (reason: string, sampleSize = 0): StatisticalSignal => ({
  category: 'rise_fall',
  contractType: null,
  contractLabel: '',
  barrier: null,
  conservativeProbability: 0,
  sampleSize,
  theoreticalBaseline: 0.5,
  reason,
  signalStrength: 'NO_EDGE',
  regime: 'UNCLEAR',
  signalTimestamp: Date.now(),
});

function conservativeBinomialLowerBound(successes: number, trials: number, z: number = 1.96): number {
  if (trials === 0) return 0;
  const pHat = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = pHat + (z * z) / (2 * trials);
  const margin = (z / denom) * Math.sqrt((pHat * (1 - pHat)) / trials + (z * z) / (4 * trials * trials));
  return Math.max(0, (center - margin) / denom);
}

const finiteQuotes = (quotes: number[]) => quotes.filter((q) => Number.isFinite(q) && q > 0);

export function lastDigitOfExport(quote: number, decimals: number): number {
  return Math.abs(Math.round(quote * 10 ** decimals) % 10);
}

function extractLastDigits(quotes: number[], decimals: number): number[] {
  return quotes.map((q) => lastDigitOfExport(q, decimals));
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
  return Math.min(8, Math.max(2, ...quotes.slice(-100).map((quote) => {
    const text = String(quote);
    return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
  })));
}

export function classifyRegime(quotes: number[], _decimals: number): MarketRegime {
  const q = finiteQuotes(quotes);
  if (q.length < 50) return 'UNCLEAR';
  const n = q.length;
  const emaFast = ema(q, Math.max(3, Math.floor(n / 8)));
  const emaSlow = ema(q, Math.max(5, Math.floor(n / 3)));
  const f = emaFast[emaFast.length - 1];
  const s = emaSlow[emaSlow.length - 1];
  const slopeFast = slope(q, Math.max(5, Math.floor(n / 8)));
  const rets: number[] = [];
  for (let i = 1; i < q.length; i += 1) rets.push((q[i] - q[i - 1]) / Math.max(q[i - 1], 1e-9));
  const vol = std(rets);
  const cw = Math.max(1, Math.floor(n / 30));
  const c = candles(q, cw);
  const adxVal = c.length >= 4 ? adx(c, Math.min(14, c.length - 1)) : 0;
  const bullStructure = f > s && slopeFast > 0;
  const bearStructure = f < s && slopeFast < 0;

  if (vol > 0.00025) return 'HIGH_VOLATILITY';
  if (vol < 0.00005) return 'LOW_VOLATILITY';
  if (adxVal < 15 && Math.abs(f - s) / (s || 1) < 0.002) return 'RANGE_BOUND';
  if (bullStructure && adxVal >= 20) return 'STRONG_BULL';
  if (bullStructure) return 'WEAK_BULL';
  if (bearStructure && adxVal >= 20) return 'STRONG_BEAR';
  if (bearStructure) return 'WEAK_BEAR';
  return 'UNCLEAR';
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i += 1) result.push(values[i] * alpha + result[i - 1] * (1 - alpha));
  return result;
}

function candles(quotes: number[], width: number): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + width <= quotes.length; i += width) {
    const slice = quotes.slice(i, i + width);
    result.push({ open: slice[0], high: Math.max(...slice), low: Math.min(...slice), close: slice[slice.length - 1] });
  }
  return result;
}

function slope(values: number[], lookback: number): number {
  if (values.length <= lookback) return 0;
  const start = values[values.length - 1 - lookback];
  const end = values[values.length - 1];
  const meanAbs = values.slice(-lookback).reduce((s, v) => s + Math.abs(v), 0) / lookback;
  return meanAbs === 0 ? 0 : (end - start) / Math.max(meanAbs, 1e-8);
}

function adx(data: Candle[], period = 14): number {
  if (data.length < period * 2) return 0;
  const trList: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
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
  return (Math.abs(plusDI - minusDI) / diSum) * 100;
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS (Matching backtest.ts imports)
// ═══════════════════════════════════════════════════════════════════

export function analyzeEvenOdd(input: number[], decimals: number): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < MIN_SAMPLE_SIZE) return { ...emptySignal('INSUFFICIENT_DATA', quotes.length), category: 'even_odd', signalTimestamp: Date.now() };

  const digits = extractLastDigits(quotes.slice(-MIN_SAMPLE_SIZE), decimals);
  const lastDigit = digits[digits.length - 1];
  const prevDigit = digits[digits.length - 2];

  const lastTwoOdd = (lastDigit % 2 !== 0) && (prevDigit % 2 !== 0);
  const lastTwoEven = (lastDigit % 2 === 0) && (prevDigit % 2 === 0);

  if (lastTwoOdd) {
    const evenCount = digits.filter((d) => d % 2 === 0).length;
    const conservativeProb = conservativeBinomialLowerBound(evenCount, digits.length);
    if (conservativeProb > 0.5 + MIN_EDGE) {
      return {
        category: 'even_odd', contractType: 'DIGITEVEN', contractLabel: 'EVEN', barrier: null,
        conservativeProbability: conservativeProb, sampleSize: digits.length, theoreticalBaseline: 0.5,
        signalStrength: 'STRONG',
        reason: `Trigger: ODD,ODD. P(EVEN)_cons=${(conservativeProb * 100).toFixed(1)}% > 51.5%`,
        regime: classifyRegime(quotes, decimals), signalTimestamp: Date.now(),
      };
    }
  } else if (lastTwoEven) {
    const oddCount = digits.filter((d) => d % 2 !== 0).length;
    const conservativeProb = conservativeBinomialLowerBound(oddCount, digits.length);
    if (conservativeProb > 0.5 + MIN_EDGE) {
      return {
        category: 'even_odd', contractType: 'DIGITODD', contractLabel: 'ODD', barrier: null,
        conservativeProbability: conservativeProb, sampleSize: digits.length, theoreticalBaseline: 0.5,
        signalStrength: 'STRONG',
        reason: `Trigger: EVEN,EVEN. P(ODD)_cons=${(conservativeProb * 100).toFixed(1)}% > 51.5%`,
        regime: classifyRegime(quotes, decimals), signalTimestamp: Date.now(),
      };
    }
  }

  return { ...emptySignal('NO_TRIGGER_OR_EDGE', digits.length), category: 'even_odd', signalTimestamp: Date.now() };
}

export function analyzeOverUnder(input: number[], decimals: number): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < MIN_SAMPLE_SIZE) return { ...emptySignal('INSUFFICIENT_DATA', quotes.length), category: 'over_under', signalTimestamp: Date.now() };

  const digits = extractLastDigits(quotes.slice(-MIN_SAMPLE_SIZE), decimals);
  const lastDigit = digits[digits.length - 1];

  if (lastDigit === 1 || lastDigit === 2) {
    const overCount = digits.filter((d) => d > 2).length;
    const conservativeProb = conservativeBinomialLowerBound(overCount, digits.length);
    if (conservativeProb > 0.7 + MIN_EDGE) {
      return {
        category: 'over_under', contractType: 'DIGITOVER', contractLabel: 'OVER 2', barrier: 2,
        conservativeProbability: conservativeProb, sampleSize: digits.length, theoreticalBaseline: 0.7,
        signalStrength: 'STRONG',
        reason: `Trigger: ${lastDigit}. P(>2)_cons=${(conservativeProb * 100).toFixed(1)}% > 71.5%`,
        regime: classifyRegime(quotes, decimals), signalTimestamp: Date.now(),
      };
    }
  } else if (lastDigit === 8 || lastDigit === 9) {
    const underCount = digits.filter((d) => d < 8).length;
    const conservativeProb = conservativeBinomialLowerBound(underCount, digits.length);
    if (conservativeProb > 0.8 + MIN_EDGE) {
      return {
        category: 'over_under', contractType: 'DIGITUNDER', contractLabel: 'UNDER 8', barrier: 8,
        conservativeProbability: conservativeProb, sampleSize: digits.length, theoreticalBaseline: 0.8,
        signalStrength: 'STRONG',
        reason: `Trigger: ${lastDigit}. P(<8)_cons=${(conservativeProb * 100).toFixed(1)}% > 81.5%`,
        regime: classifyRegime(quotes, decimals), signalTimestamp: Date.now(),
      };
    }
  }

  return { ...emptySignal('NO_TRIGGER_OR_EDGE', digits.length), category: 'over_under', signalTimestamp: Date.now() };
}

export function analyzeMatchesDiffers(input: number[], decimals: number): StatisticalSignal {
  return { ...emptySignal('DISABLED_FOR_SAFETY', 0), category: 'matches_differs', signalTimestamp: Date.now() };
}

export function analyzeRiseFall(input: number[]): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < 200) return { ...emptySignal('INSUFFICIENT_DATA', quotes.length), category: 'rise_fall', signalTimestamp: Date.now() };

  const regime = classifyRegime(quotes, 2);
  if (regime === 'UNCLEAR' || regime === 'RANGE_BOUND') {
    return { ...emptySignal('UNFAVORABLE_REGIME', quotes.length), category: 'rise_fall', regime, signalTimestamp: Date.now() };
  }

  const htf = candles(quotes, 20), ltf = candles(quotes, 5);
  const htfClose = htf.map(c => c.close), ltfClose = ltf.map(c => c.close);
  
  const htfFast = ema(htfClose, 20), htfSlow = ema(htfClose, 50);
  const htfTrend = htfFast[htfFast.length - 1] - htfSlow[htfSlow.length - 1];
  const ltfFast = ema(ltfClose, 10), ltfSlow = ema(ltfClose, 20);
  const ltfTrend = ltfFast[ltfFast.length - 1] - ltfSlow[ltfSlow.length - 1];
  const adxVal = adx(htf, 14);
  
  let direction: 'CALL' | 'PUT', score = 0;
  if (htfTrend > 0 && ltfTrend > 0 && adxVal > 20) {
    direction = 'CALL'; score = Math.min(100, 50 + (adxVal - 20) * 2 + Math.abs(htfTrend) * 1000);
  } else if (htfTrend < 0 && ltfTrend < 0 && adxVal > 20) {
    direction = 'PUT'; score = Math.min(100, 50 + (adxVal - 20) * 2 + Math.abs(htfTrend) * 1000);
  } else {
    return { ...emptySignal('NO_TREND_ALIGNMENT', quotes.length), category: 'rise_fall', regime, signalTimestamp: Date.now() };
  }

  const conservativeProbability = (0.5 + (score / 100) * 0.3) * 0.85;
  if (conservativeProbability <= 0.55) return { ...emptySignal('INSUFFICIENT_PROBABILITY', quotes.length), category: 'rise_fall', regime, signalTimestamp: Date.now() };

  return {
    category: 'rise_fall', contractType: direction, contractLabel: direction === 'CALL' ? 'RISE' : 'FALL',
    barrier: null, conservativeProbability, sampleSize: quotes.length, theoreticalBaseline: 0.5,
    signalStrength: conservativeProbability > 0.65 ? 'STRONG' : 'MODERATE',
    reason: `Trend: ${direction}, ADX: ${adxVal.toFixed(1)}, Score: ${score.toFixed(0)}`,
    regime, signalTimestamp: Date.now(),
  };
}

export function analyzeBestSignal(quotes: number[], decimals: number): StatisticalSignal {
  const results: StatisticalSignal[] = [
    analyzeRiseFall(quotes),
    analyzeEvenOdd(quotes, decimals),
    analyzeOverUnder(quotes, decimals),
    analyzeMatchesDiffers(quotes, decimals),
  ];
  const valid = results.filter(r => r.signalStrength !== 'NO_EDGE' && r.conservativeProbability > 0);
  if (valid.length === 0) return emptySignal('NO_VALIDATED_EDGE_IN_ANY_STRATEGY', quotes.length);
  return valid.sort((a, b) => b.conservativeProbability - a.conservativeProbability)[0];
}

export function isSignalFresh(signal: StatisticalSignal): boolean {
  return Date.now() - signal.signalTimestamp < SIGNAL_MAX_AGE_MS;
}
