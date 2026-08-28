import type { VercelRequest, VercelResponse } from '@vercel/node';

interface IndicatorSet {
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
  category: string;
  digitBias?: number;
  digitStreak?: number;
  digitAboveThreshold?: number;
  consecutiveAbove?: number;
  consecutiveStreak?: number;
}

interface AIResponse {
  confidence: number;
  shouldTrade: boolean;
  reasoning: string;
  refinement: string;
}

function ok(res: VercelResponse, body: Record<string, unknown>) {
  return res.status(200).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ABSOLUTE SAFETY: any unhandled error returns 200 with shouldTrade:false
  try {
    const ind: IndicatorSet = req.body;
    if (!ind || typeof ind !== 'object') {
      return ok(res, { confidence: 0, shouldTrade: false, reasoning: 'Invalid body', refinement: 'N/A' });
    }

    const isDigit = ind.category !== 'rise_fall';
    const ts = Number(ind.technicalScore) || 0;

    // ── PRE-VALIDATION ──
    if (isDigit) {
      if (ind.digitBias != null && ind.digitBias < 0.03) {
        return ok(res, { confidence: Math.min(ts, 0.40), shouldTrade: false, reasoning: `Digit bias too weak (${((ind.digitBias || 0) * 100).toFixed(1)}%)`, refinement: 'Pre-AI: uniform distribution' });
      }
      if (ind.signalStrength === 'WEAK') {
        return ok(res, { confidence: Math.min(ts, 0.50), shouldTrade: false, reasoning: 'Weak signal', refinement: 'Pre-AI: weak' });
      }
      if (ind.digitStreak != null && ind.digitStreak > 10) {
        return ok(res, { confidence: Math.min(ts, 0.50), shouldTrade: false, reasoning: `Streak ${ind.digitStreak} - reversal risk`, refinement: 'Pre-AI: streak too long' });
      }
    } else {
      const htfRsi = Number(ind.htfRsi) || 50;
      const adxVal = Number(ind.adx) || 0;
      if (htfRsi > 75 || htfRsi < 25) {
        return ok(res, { confidence: Math.min(ts, 0.45), shouldTrade: false, reasoning: `RSI extreme ${htfRsi.toFixed(1)}`, refinement: 'Pre-AI: RSI' });
      }
      if (adxVal < 15) {
        return ok(res, { confidence: Math.min(ts, 0.40), shouldTrade: false, reasoning: `ADX low ${adxVal.toFixed(1)}`, refinement: 'Pre-AI: ADX' });
      }
      if (!ind.trendAlignment) {
        return ok(res, { confidence: Math.min(ts, 0.50), shouldTrade: false, reasoning: 'TF conflict', refinement: 'Pre-AI: timeframe' });
      }
      if (ind.signalStrength === 'WEAK') {
        return ok(res, { confidence: Math.min(ts, 0.55), shouldTrade: false, reasoning: 'Weak signal', refinement: 'Pre-AI: weak' });
      }
    }

    // ── CHECK API KEY ──
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const fc = Math.min(ts * 0.92, 0.78);
      return ok(res, { confidence: fc, shouldTrade: fc >= 0.72, reasoning: 'No AI key - using technical score', refinement: `TS ${(ts * 100).toFixed(0)}% → ${(fc * 100).toFixed(0)}%` });
    }

    // ── BUILD PROMPT ──
    const sysPrompt = isDigit
      ? `You are a Deriv digit trading analyst. Calibrate confidence for digit contracts.
RULES:
- VETO if digitBias < 0.04 or signalStrength WEAK
- REDUCE 10-15% if digitBias 0.04-0.07 or digitStreak > 8
- INCREASE 5-10% if digitBias > 0.12 and signalStrength STRONG
- Max confidence: 0.85
- Return ONLY valid JSON: {"confidence":0.0-0.85,"shouldTrade":true/false,"reasoning":"...","refinement":"..."}`
      : `You are a Deriv volatility index trading analyst. Calibrate confidence.
RULES:
- VETO if RSI>72 or RSI<28 or ADX<18 or !trendAlignment
- REDUCE 10-15% if signalStrength WEAK or RSI near extreme
- INCREASE 5-10% if STRONG signal, ADX>28, RSI ideal zone, MACD accelerating
- Max confidence: 0.85
- Return ONLY valid JSON: {"confidence":0.0-0.85,"shouldTrade":true/false,"reasoning":"...","refinement":"..."}`;

    const userMsg = `Symbol: ${ind.symbol} | Category: ${ind.category} | Direction: ${ind.direction || 'N/A'} | Signal: ${ind.signalStrength} | TS: ${(ts * 100).toFixed(1)}% | RSI: ${(Number(ind.rsi) || 50).toFixed(1)} | ADX: ${(Number(ind.adx) || 0).toFixed(1)} | HTF_RSI: ${(Number(ind.htfRsi) || 50).toFixed(1)} | MACD_H: ${(Number(ind.macdHist) || 0).toFixed(4)} | MOM: ${((Number(ind.momentum) || 0) * 10000).toFixed(1)}bps | BB_W: ${(Number(ind.bbWidth) || 0).toFixed(6)} | Price: ${(Number(ind.lastPrice) || 0).toFixed(4)}${isDigit ? ` | DigitBias: ${((Number(ind.digitBias) || 0) * 100).toFixed(1)}% | Streak: ${ind.digitStreak || 0} | ConsecAbove: ${ind.consecutiveAbove || 0}` : ''}`;

    // ── CALL GEMINI WITH TIMEOUT ──
    let parsed: AIResponse;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { temperature: 0.15, maxOutputTokens: 150 },
      });

      const result = await Promise.race([
        model.generateContent(sysPrompt + '\n\n' + userMsg),
        new Promise<never>((_, reject) => setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 10000)),
      ]);

      clearTimeout(timeout);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[^]*?\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { confidence: 0, shouldTrade: false, reasoning: 'Parse fail', refinement: text.slice(0, 100) };
    } catch (e: any) {
      // AI FAILED - return technical score with small penalty, shouldTrade based on TS
      const fc = Math.min(ts * 0.88, 0.75);
      return ok(res, { confidence: fc, shouldTrade: fc >= 0.72, reasoning: `AI error: ${(e?.message || 'unknown').slice(0, 60)}`, refinement: `Fallback TS ${(ts * 100).toFixed(0)}% → ${(fc * 100).toFixed(0)}%` });
    }

    // ── POST-AI VALIDATION ──
    let fc = Math.min(0.85, Math.max(0, Number(parsed.confidence) || 0));
    if (fc > ts + 0.05) fc = ts + 0.05;
    if (ind.signalStrength === 'STRONG') fc = Math.min(fc, 0.88);
    else if (ind.signalStrength === 'MODERATE') fc = Math.min(fc, 0.82);

    return ok(res, {
      confidence: fc,
      shouldTrade: fc >= 0.72,
      reasoning: parsed.reasoning || 'OK',
      refinement: parsed.refinement || 'N/A',
    });
  } catch (err: any) {
    // LAST RESORT: never return 500
    return ok(res, { confidence: 0, shouldTrade: false, reasoning: `Fatal: ${(err?.message || 'unknown').slice(0, 80)}`, refinement: 'Safety fallback' });
  }
}
