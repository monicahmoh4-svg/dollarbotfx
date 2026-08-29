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

// ── Constants ──
const MIN_SAMPLE_SIZE = 300;
const MIN_EDGE = 0.015; // 1.5% safety margin above break-even
const SIGNAL_MAX_AGE_MS = 10_000; // Signal expires after 10 seconds

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

// ═══════════════════════════════════════════════════════════════════
// WILSON SCORE INTERVAL — Conservative Lower Bound
// This is the cornerstone of loss prevention. We NEVER use raw
// observed frequency. We use the lower bound of the 95% confidence
// interval, which means we are 95% confident the TRUE probability
// is at least this high.
// ═══════════════════════════════════════════════════════════════════
function conservativeBinomialLowerBound(
  successes: number,
  trials: number,
  z: number = 1.96,
): number {
  if (trials === 0) return 0;
  const pHat = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = pHat + (z * z) / (2 * trials);
  const margin =
    (z / denom) *
    Math.sqrt(
      (pHat * (1 - pHat)) / trials + (z * z) / (4 * trials * trials),
    );
  return Math.max(0, (center - margin) / denom);
}

// ═══════════════════════════════════════════════════════════════════
// DATA VALIDATION & DIGIT EXTRACTION
// ═══════════════════════════════════════════════════════════════════
const finiteQuotes = (quotes: number[]) =>
  quotes.filter((q) => Number.isFinite(q) && q > 0);

/**
 * CRITICAL: Correct final-digit extraction.
 * Uses the actual decimal precision from Deriv's quote representation.
 * Never uses int(price) % 10.
 *
 * Examples:
 *   lastDigitOfExport(1234.567, 3) → 7
 *   lastDigitOfExport(9876.54, 2)  → 4
 *   lastDigitOfExport(100.1, 1)    → 1
 */
export function lastDigitOfExport(quote: number, decimals: number): number {
  return Math.abs(Math.round(quote * 10 ** decimals) % 10);
}

function extractLastDigits(quotes: number[], decimals: number): number[] {
  return quotes.map((q) => lastDigitOfExport(q, decimals));
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
  return Math.min(
    8,
    Math.max(
      2,
      ...quotes.slice(-100).map((quote) => {
        const text = String(quote);
        return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
      }),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════
// MARKET REGIME CLASSIFIER
// ═══════════════════════════════════════════════════════════════════
export function classifyRegime(
  quotes: number[],
  _decimals: number,
): MarketRegime {
  const q = finiteQuotes(quotes);
  if (q.length < 50) return 'UNCLEAR';
  const n = q.length;
  const emaFast = ema(q, Math.max(3, Math.floor(n / 8)));
  const emaSlow = ema(q, Math.max(5, Math.floor(n / 3)));
  const f = emaFast[emaFast.length - 1];
  const s = emaSlow[emaSlow.length - 1];
  const slopeFast = slope(q, Math.max(5, Math.floor(n / 8)));
  const rets: number[] = [];
  for (let i = 1; i < q.length; i += 1) {
    rets.push((q[i] - q[i - 1]) / Math.max(q[i - 1], 1e-9));
  }
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

// ── Technical Indicator Primitives ──
function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    result.push(values[i] * alpha + result[i - 1] * (1 - alpha));
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

function slope(values: number[], lookback: number): number {
  if (values.length <= lookback) return 0;
  const start = values[values.length - 1 - lookback];
  const end = values[values.length - 1];
  const meanAbs =
    values.slice(-lookback).reduce((s, v) => s + Math.abs(v), 0) / lookback;
  return meanAbs === 0 ? 0 : (end - start) / Math.max(meanAbs, 1e-8);
}

function adx(data: Candle[], period = 14): number {
  if (data.length < period * 2) return 0;
  const trList: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const highDiff = data[i].high - data[i - 1].high;
    const lowDiff = data[i - 1].low - data[i].low;
    trList.push(
      Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close),
      ),
    );
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
// STRATEGY A/B: OVER 2 AFTER DIGIT 1 OR 2
// Hypothesis: After a low digit (1 or 2), the next digit is more
// likely to be > 2. This is a CANDIDATE, not a guarantee.
// Baseline: P(>2) = 7/10 = 0.70 under uniform distribution.
// ═══════════════════════════════════════════════════════════════════
function analyzeOver2(input: number[], decimals: number): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < MIN_SAMPLE_SIZE)
    return {
      ...emptySignal('INSUFFICIENT_DATA', quotes.length),
      category: 'over_under',
    };

  const digits = extractLastDigits(quotes.slice(-MIN_SAMPLE_SIZE), decimals);
  const lastDigit = digits[digits.length - 1];

  // TRIGGER: Last digit must be 1 or 2
  if (lastDigit !== 1 && lastDigit !== 2) {
    return {
      ...emptySignal('NO_TRIGGER: last digit not 1 or 2', digits.length),
      category: 'over_under',
    };
  }

  // Count how many of the 300 digits are > 2
  const overCount = digits.filter((d) => d > 2).length;
  const conservativeProb = conservativeBinomialLowerBound(
    overCount,
    digits.length,
  );
  const theoreticalBaseline = 0.7; // P(digit > 2) under uniform

  if (conservativeProb > theoreticalBaseline + MIN_EDGE) {
    return {
      category: 'over_under',
      contractType: 'DIGITOVER',
      contractLabel: 'OVER 2',
      barrier: 2,
      conservativeProbability: conservativeProb,
      sampleSize: digits.length,
      theoreticalBaseline,
      signalStrength: 'STRONG',
      reason: `Trigger: digit=${lastDigit}. P(>2)_conservative=${(conservativeProb * 100).toFixed(1)}% > baseline ${(theoreticalBaseline * 100).toFixed(0)}%+${(MIN_EDGE * 100).toFixed(1)}%`,
      regime: classifyRegime(quotes, decimals),
      triggerDigit: lastDigit,
      signalTimestamp: Date.now(),
    };
  }

  return {
    ...emptySignal(
      `NO_EDGE: P(>2)_cons=${(conservativeProb * 100).toFixed(1)}% <= ${(theoreticalBaseline * 100 + MIN_EDGE * 100).toFixed(1)}%`,
      digits.length,
    ),
    category: 'over_under',
    triggerDigit: lastDigit,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY C/D: UNDER 8 AFTER DIGIT 8 OR 9
// Hypothesis: After a high digit (8 or 9), the next digit is more
// likely to be < 8. CANDIDATE, not guaranteed.
// Baseline: P(<8) = 8/10 = 0.80 under uniform distribution.
// ═══════════════════════════════════════════════════════════════════
function analyzeUnder8(input: number[], decimals: number): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < MIN_SAMPLE_SIZE)
    return {
      ...emptySignal('INSUFFICIENT_DATA', quotes.length),
      category: 'over_under',
    };

  const digits = extractLastDigits(quotes.slice(-MIN_SAMPLE_SIZE), decimals);
  const lastDigit = digits[digits.length - 1];

  // TRIGGER: Last digit must be 8 or 9
  if (lastDigit !== 8 && lastDigit !== 9) {
    return {
      ...emptySignal('NO_TRIGGER: last digit not 8 or 9', digits.length),
      category: 'over_under',
    };
  }

  const underCount = digits.filter((d) => d < 8).length;
  const conservativeProb = conservativeBinomialLowerBound(
    underCount,
    digits.length,
  );
  const theoreticalBaseline = 0.8; // P(digit < 8) under uniform

  if (conservativeProb > theoreticalBaseline + MIN_EDGE) {
    return {
      category: 'over_under',
      contractType: 'DIGITUNDER',
      contractLabel: 'UNDER 8',
      barrier: 8,
      conservativeProbability: conservativeProb,
      sampleSize: digits.length,
      theoreticalBaseline,
      signalStrength: 'STRONG',
      reason: `Trigger: digit=${lastDigit}. P(<8)_conservative=${(conservativeProb * 100).toFixed(1)}% > baseline ${(theoreticalBaseline * 100).toFixed(0)}%+${(MIN_EDGE * 100).toFixed(1)}%`,
      regime: classifyRegime(quotes, decimals),
      triggerDigit: lastDigit,
      signalTimestamp: Date.now(),
    };
  }

  return {
    ...emptySignal(
      `NO_EDGE: P(<8)_cons=${(conservativeProb * 100).toFixed(1)}% <= ${(theoreticalBaseline * 100 + MIN_EDGE * 100).toFixed(1)}%`,
      digits.length,
    ),
    category: 'over_under',
    triggerDigit: lastDigit,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY E: EVEN AFTER TWO CONSECUTIVE ODDS
// Hypothesis: After ODD,ODD the next digit is more likely EVEN.
// This is the Gambler's Fallacy UNLESS data proves otherwise.
// Baseline: P(EVEN) = 0.50 under uniform distribution.
// ═══════════════════════════════════════════════════════════════════
function analyzeEvenAfterOdds(
  input: number[],
  decimals: number,
): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < MIN_SAMPLE_SIZE)
    return {
      ...emptySignal('INSUFFICIENT_DATA', quotes.length),
      category: 'even_odd',
    };

  const digits = extractLastDigits(quotes.slice(-MIN_SAMPLE_SIZE), decimals);
  const lastDigit = digits[digits.length - 1];
  const prevDigit = digits[digits.length - 2];

  // TRIGGER: Last two digits must both be ODD
  if (lastDigit % 2 === 0 || prevDigit % 2 === 0) {
    return {
      ...emptySignal('NO_TRIGGER: last two not both ODD', digits.length),
      category: 'even_odd',
    };
  }

  const evenCount = digits.filter((d) => d % 2 === 0).length;
  const conservativeProb = conservativeBinomialLowerBound(
    evenCount,
    digits.length,
  );
  const theoreticalBaseline = 0.5;

  if (conservativeProb > theoreticalBaseline + MIN_EDGE) {
    return {
      category: 'even_odd',
      contractType: 'DIGITEVEN',
      contractLabel: 'EVEN',
      barrier: null,
      conservativeProbability: conservativeProb,
      sampleSize: digits.length,
      theoreticalBaseline,
      signalStrength: 'STRONG',
      reason: `Trigger: ODD(${prevDigit}),ODD(${lastDigit}). P(EVEN)_conservative=${(conservativeProb * 100).toFixed(1)}% > ${(theoreticalBaseline * 100).toFixed(0)}%+${(MIN_EDGE * 100).toFixed(1)}%`,
      regime: classifyRegime(quotes, decimals),
      signalTimestamp: Date.now(),
    };
  }

  return {
    ...emptySignal(
      `NO_EDGE: P(EVEN)_cons=${(conservativeProb * 100).toFixed(1)}% <= ${(theoreticalBaseline * 100 + MIN_EDGE * 100).toFixed(1)}%`,
      digits.length,
    ),
    category: 'even_odd',
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY F: ODD AFTER TWO CONSECUTIVE EVENS
// Hypothesis: After EVEN,EVEN the next digit is more likely ODD.
// Baseline: P(ODD) = 0.50 under uniform distribution.
// ═══════════════════════════════════════════════════════════════════
function analyzeOddAfterEvens(
  input: number[],
  decimals: number,
): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < MIN_SAMPLE_SIZE)
    return {
      ...emptySignal('INSUFFICIENT_DATA', quotes.length),
      category: 'even_odd',
    };

  const digits = extractLastDigits(quotes.slice(-MIN_SAMPLE_SIZE), decimals);
  const lastDigit = digits[digits.length - 1];
  const prevDigit = digits[digits.length - 2];

  // TRIGGER: Last two digits must both be EVEN
  if (lastDigit % 2 !== 0 || prevDigit % 2 !== 0) {
    return {
      ...emptySignal('NO_TRIGGER: last two not both EVEN', digits.length),
      category: 'even_odd',
    };
  }

  const oddCount = digits.filter((d) => d % 2 !== 0).length;
  const conservativeProb = conservativeBinomialLowerBound(
    oddCount,
    digits.length,
  );
  const theoreticalBaseline = 0.5;

  if (conservativeProb > theoreticalBaseline + MIN_EDGE) {
    return {
      category: 'even_odd',
      contractType: 'DIGITODD',
      contractLabel: 'ODD',
      barrier: null,
      conservativeProbability: conservativeProb,
      sampleSize: digits.length,
      theoreticalBaseline,
      signalStrength: 'STRONG',
      reason: `Trigger: EVEN(${prevDigit}),EVEN(${lastDigit}). P(ODD)_conservative=${(conservativeProb * 100).toFixed(1)}% > ${(theoreticalBaseline * 100).toFixed(0)}%+${(MIN_EDGE * 100).toFixed(1)}%`,
      regime: classifyRegime(quotes, decimals),
      signalTimestamp: Date.now(),
    };
  }

  return {
    ...emptySignal(
      `NO_EDGE: P(ODD)_cons=${(conservativeProb * 100).toFixed(1)}% <= ${(theoreticalBaseline * 100 + MIN_EDGE * 100).toFixed(1)}%`,
      digits.length,
    ),
    category: 'even_odd',
  };
}

// ═══════════════════════════════════════════════════════════════════
// RISE/FALL: Separate price-direction model (NOT digit-based)
// ═══════════════════════════════════════════════════════════════════
export function analyzeRiseFall(input: number[]): StatisticalSignal {
  const quotes = finiteQuotes(input);
  if (quotes.length < 200)
    return {
      ...emptySignal('INSUFFICIENT_DATA', quotes.length),
      category: 'rise_fall',
    };

  const regime = classifyRegime(quotes, 2);
  if (regime === 'UNCLEAR' || regime === 'RANGE_BOUND') {
    return {
      ...emptySignal('UNFAVORABLE_REGIME', quotes.length),
      category: 'rise_fall',
      regime,
    };
  }

  const htf = candles(quotes, 20);
  const ltf = candles(quotes, 5);
  const htfClose = htf.map((c) => c.close);
  const ltfClose = ltf.map((c) => c.close);

  const htfFast = ema(htfClose, 20);
  const htfSlow = ema(htfClose, 50);
  const htfTrend = htfFast[htfFast.length - 1] - htfSlow[htfSlow.length - 1];

  const ltfFast = ema(ltfClose, 10);
  const ltfSlow = ema(ltfClose, 20);
  const ltfTrend = ltfFast[ltfFast.length - 1] - ltfSlow[ltfSlow.length - 1];

  const adxVal = adx(htf, 14);
  let direction: 'CALL' | 'PUT';
  let score = 0;

  if (htfTrend > 0 && ltfTrend > 0 && adxVal > 20) {
    direction = 'CALL';
    score = Math.min(
      100,
      50 + (adxVal - 20) * 2 + Math.abs(htfTrend) * 1000,
    );
  } else if (htfTrend < 0 && ltfTrend < 0 && adxVal > 20) {
    direction = 'PUT';
    score = Math.min(
      100,
      50 + (adxVal - 20) * 2 + Math.abs(htfTrend) * 1000,
    );
  } else {
    return {
      ...emptySignal('NO_TREND_ALIGNMENT', quotes.length),
      category: 'rise_fall',
      regime,
    };
  }

  const rawProb = 0.5 + (score / 100) * 0.3;
  const conservativeProbability = rawProb * 0.85; // 15% model uncertainty penalty

  if (conservativeProbability <= 0.55) {
    return {
      ...emptySignal('INSUFFICIENT_PROBABILITY', quotes.length),
      category: 'rise_fall',
      regime,
    };
  }

  return {
    category: 'rise_fall',
    contractType: direction,
    contractLabel: direction === 'CALL' ? 'RISE' : 'FALL',
    barrier: null,
    conservativeProbability,
    sampleSize: quotes.length,
    theoreticalBaseline: 0.5,
    signalStrength: conservativeProbability > 0.65 ? 'STRONG' : 'MODERATE',
    reason: `Trend: ${direction}, ADX: ${adxVal.toFixed(1)}, Score: ${score.toFixed(0)}`,
    regime,
    signalTimestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MASTER SIGNAL SELECTOR
// Evaluates ALL candidate strategies, returns the one with the
// highest conservative probability. If none pass, returns NO_EDGE.
// ═══════════════════════════════════════════════════════════════════
export function analyzeBestSignal(
  quotes: number[],
  decimals: number,
): StatisticalSignal {
  const results: StatisticalSignal[] = [
    analyzeRiseFall(quotes),
    analyzeEvenAfterOdds(quotes, decimals),
    analyzeOddAfterEvens(quotes, decimals),
    analyzeOver2(quotes, decimals),
    analyzeUnder8(quotes, decimals),
  ];

  // Filter: only signals with demonstrable edge
  const valid = results.filter(
    (r) => r.signalStrength !== 'NO_EDGE' && r.conservativeProbability > 0,
  );

  if (valid.length === 0) {
    return emptySignal('NO_VALIDATED_EDGE_IN_ANY_STRATEGY', quotes.length);
  }

  // Rank by conservative probability (highest first)
  return valid.sort(
    (a, b) => b.conservativeProbability - a.conservativeProbability,
  )[0];
}

/**
 * Check if a signal has expired.
 * Signals older than SIGNAL_MAX_AGE_MS must NOT be executed.
 */
export function isSignalFresh(signal: StatisticalSignal): boolean {
  return Date.now() - signal.signalTimestamp < SIGNAL_MAX_AGE_MS;
}
