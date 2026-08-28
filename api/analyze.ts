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

function ok(res: VercelResponse, body: Record<string, unknown>) {
  return res.status(200).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
        return ok(res, { confidence: Math.min(ts, 0.40), shouldTrade: false, reasoning: 'Digit bias too weak', refinement: 'Pre-AI: uniform' });
      }
      if (ind.signalStrength === 'WEAK') {
        return ok(res, { confidence: Math.min(ts, 0.50), shouldTrade: false, reasoning: 'Weak signal', refinement: 'Pre-AI: weak' });
      }
      if (ind.digitStreak != null && ind.digitStreak > 10) {
        return ok(res, { confidence: Math.min(ts, 0.50), shouldTrade: false, reasoning: `Streak ${ind.digitStreak} reversal risk`, refinement: 'Pre-AI: streak' });
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
      return ok(res, { confidence: fc, shouldTrade: fc >= 0.72, reasoning: 'No AI key - technical score', refinement: `TS ${(ts * 100).toFixed(0)}%` });
    }

    // ── BUILD PROMPT ──
    const sysPrompt = isDigit
      ? `Deriv digit analyst. Calibrate confidence. Rules: VETO if bias<0.04 or WEAK. REDUCE 10-15% if bias 0.04-0.07 or streak>8. INCREASE 5-10% if bias>0.12 and STRONG. Max 0.85. JSON only: {"confidence":0-0.85,"shouldTrade":bool,"reasoning":"...","refinement":"..."}`
      : `Deriv index analyst. Calibrate confidence. Rules: VETO if RSI>72|<28 or ADX<18 or !trend. REDUCE 10-15% if WEAK or RSI near extreme. INCREASE 5-10% if STRONG, ADX>28, ideal RSI, MACD accel. Max 0.85. JSON only: {"confidence":0-0.85,"shouldTrade":bool,"reasoning":"...","refinement":"..."}`;

    const userMsg = `${ind.symbol}|${ind.category}|${ind.direction||'N/A'}|${ind.signalStrength}|TS:${(ts*100).toFixed(0)}%|RSI:${(Number(ind.rsi)||50).toFixed(0)}|ADX:${(Number(ind.adx)||0).toFixed(0)}|HTF_RSI:${(Number(ind.htfRsi)||50).toFixed(0)}|MACD:${(Number(ind.macdHist)||0).toFixed(4)}|MOM:${((Number(ind.momentum)||0)*10000).toFixed(0)}bps|BB:${(Number(ind.bbWidth)||0).toFixed(6)}|P:${(Number(ind.lastPrice)||0).toFixed(2)}${isDigit?`|Bias:${((Number(ind.digitBias)||0)*100).toFixed(0)}%|Str:${ind.digitStreak||0}|Con:${ind.consecutiveAbove||0}`:''}`;

    // ── CALL GEMINI VIA REST API (no dynamic import!) ──
    let parsed: { confidence: number; shouldTrade: boolean; reasoning: string; refinement: string };
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: sysPrompt + '\n\n' + userMsg }] }],
            generationConfig: { temperature: 0.15, maxOutputTokens: 150 },
          }),
          signal: AbortSignal.timeout(8000),
        }
      );

      if (!geminiRes.ok) {
        throw new Error(`Gemini HTTP ${geminiRes.status}`);
      }

      const geminiData = await geminiRes.json();
      const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[^}]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { confidence: 0, shouldTrade: false, reasoning: 'Parse fail', refinement: text.slice(0, 80) };
    } catch (e: any) {
      const fc = Math.min(ts * 0.88, 0.75);
      return ok(res, { confidence: fc, shouldTrade: fc >= 0.72, reasoning: `AI error: ${(e?.message||'').slice(0,50)}`, refinement: `Fallback ${(fc*100).toFixed(0)}%` });
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
    return ok(res, { confidence: 0, shouldTrade: false, reasoning: 'Fatal error', refinement: (err?.message||'unknown').slice(0,60) });
  }
}
