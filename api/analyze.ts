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
}

interface AIResponse {
  confidence: number;
  shouldTrade: boolean;
  reasoning: string;
  refinement: string;
}

const SYSTEM_PROMPT = `You are a professional quantitative trading analyst for Deriv synthetic volatility indices. You calibrate trade confidence scores based on technical indicators.

CRITICAL RULES - YOU MUST FOLLOW THESE EXACTLY:

1. VETO (shouldTrade=false) and REDUCE confidence if ANY of these are true:
   - RSI > 72 or RSI < 28 (overbought/oversold extreme)
   - ADX < 18 (no trend, choppy market)
   - HTF trend disagrees with LTF signal (htfAgreement=false or trendAlignment=false)
   - Bollinger width is very narrow (<0.0003) AND momentum is near zero
   - MACD histogram is flat (macdHist near zero relative to price)
   - Stochastic > 85 or < 15 (extreme zone)

2. REDUCE confidence by 10-15% if:
   - Signal strength is WEAK
   - Only 1 timeframe agrees (htfAgreement XOR ltfAgreement)
   - RSI is between 65-72 or 28-35 (approaching extreme)
   - Momentum is positive but declining (not accelerating)

3. INCREASE confidence by 5-10% ONLY if ALL of these are true:
   - Signal strength is STRONG
   - Both timeframes agree (trendAlignment=true)
   - ADX > 28 (strong trend)
   - RSI is between 45-60 (ideal zone for CALL) or 40-55 (ideal zone for PUT)
   - MACD histogram is accelerating AND growing

4. NEVER set confidence above 0.85. The theoretical max is 0.92.
5. The confidence you return REPLACES the technical score. Do not just copy it.
6. Return ONLY valid JSON. No markdown wrapping.

RESPONSE FORMAT:
{
  "confidence": <0.0 to 0.92>,
  "shouldTrade": <true only if confidence >= 0.72>,
  "reasoning": "<1 sentence assessment>",
  "refinement": "<1 sentence what you changed>"
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const indicators: IndicatorSet = req.body;

  // === PRE-AI VALIDATION: Hard veto rules before calling AI ===
  // These are deterministic and should never be overridden by AI.
  if (indicators.htfRsi > 75 || indicators.htfRsi < 25) {
    return res.status(200).json({
      confidence: Math.min(indicators.technicalScore, 0.45),
      shouldTrade: false,
      reasoning: `HTF RSI extreme (${indicators.htfRsi.toFixed(1)}) - hard veto`,
      refinement: 'Pre-AI filter: RSI overbought/oversold',
    });
  }

  if (indicators.adx < 15) {
    return res.status(200).json({
      confidence: Math.min(indicators.technicalScore, 0.40),
      shouldTrade: false,
      reasoning: `ADX too low (${indicators.adx.toFixed(1)}) - no trend`,
      refinement: 'Pre-AI filter: choppy non-trending market',
    });
  }

  if (!indicators.trendAlignment) {
    return res.status(200).json({
      confidence: Math.min(indicators.technicalScore, 0.50),
      shouldTrade: false,
      reasoning: 'HTF and LTF do not agree - timeframe conflict',
      refinement: 'Pre-AI filter: multi-timeframe disagreement',
    });
  }

  if (indicators.signalStrength === 'WEAK') {
    return res.status(200).json({
      confidence: Math.min(indicators.technicalScore, 0.55),
      shouldTrade: false,
      reasoning: 'Signal strength too weak for trade',
      refinement: 'Pre-AI filter: weak signal classification',
    });
  }

  const userMessage = `CALIBRATE this trade signal. Apply the rules strictly.

Symbol: ${indicators.symbol}
Direction: ${indicators.direction}
Signal Strength: ${indicators.signalStrength}
Technical Score: ${(indicators.technicalScore * 100).toFixed(1)}%

=== HTF (20-tick) Indicators ===
HTF Trend: ${indicators.htfTrend.toFixed(6)} (${indicators.htfTrend > 0 ? 'BULLISH' : 'BEARISH'})
HTF Slope: ${indicators.htfSlope.toFixed(6)}
HTF RSI(14): ${indicators.htfRsi.toFixed(1)}
ADX(14): ${indicators.adx.toFixed(1)} (${indicators.adx >= 30 ? 'STRONG' : indicators.adx >= 20 ? 'MODERATE' : 'WEAK'})
Stochastic(14): ${indicators.stochK.toFixed(1)}

=== LTF (5-tick) Indicators ===
MACD Line: ${indicators.macdLine.toFixed(6)}
MACD Signal: ${indicators.macdSignal.toFixed(6)}
MACD Histogram: ${indicators.macdHist.toFixed(6)}
MACD Accelerating: ${indicators.macdAccel}
Momentum (ROC 12): ${(indicators.momentum * 10000).toFixed(2)} bps
Candle Up: ${indicators.candleUp}
RSI(14): ${indicators.rsi.toFixed(1)}

=== Volatility ===
Bollinger Width: ${indicators.bbWidth.toFixed(6)}
Last Price: ${indicators.lastPrice.toFixed(4)}

=== Multi-TF Status ===
HTF Agreement: ${indicators.htfAgreement}
LTF Agreement: ${indicators.ltfAgreement}
Trend Alignment: ${indicators.trendAlignment}`;

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.15, maxOutputTokens: 250 },
    });

    const result = await model.generateContent(SYSTEM_PROMPT + '\n\n' + userMessage);
    const text = result.response.text();

    const jsonMatch = text.match(/\{[^]*\}/);
    const parsed: AIResponse = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : { confidence: 0, shouldTrade: false, reasoning: 'AI parse failure', refinement: 'Could not parse AI response' };

    // === POST-AI VALIDATION: Clamp and verify AI output ===
    let finalConfidence = Math.min(0.92, Math.max(0, parsed.confidence));

    // AI should never increase confidence above the technical score by more than 5%
    if (finalConfidence > indicators.technicalScore + 0.05) {
      finalConfidence = indicators.technicalScore + 0.05;
    }

    // Hard ceiling: STRONG signals cap at 0.88, MODERATE at 0.82
    if (indicators.signalStrength === 'STRONG') {
      finalConfidence = Math.min(finalConfidence, 0.88);
    } else if (indicators.signalStrength === 'MODERATE') {
      finalConfidence = Math.min(finalConfidence, 0.82);
    }

    const shouldTrade = finalConfidence >= 0.72;

    return res.status(200).json({
      confidence: finalConfidence,
      shouldTrade,
      reasoning: parsed.reasoning,
      refinement: parsed.refinement,
    });
  } catch (error: any) {
    console.error('Gemini AI analysis error:', error.message);
    // FALLBACK: When AI is unavailable, REDUCE confidence by 15% as penalty
    // This ensures the bot is more conservative when AI cannot validate
    const fallbackConfidence = Math.min(indicators.technicalScore * 0.85, 0.70);
    return res.status(200).json({
      confidence: fallbackConfidence,
      shouldTrade: fallbackConfidence >= 0.72,
      reasoning: 'AI unavailable - reduced confidence as safety margin',
      refinement: `Technical score reduced from ${(indicators.technicalScore * 100).toFixed(1)}% to ${(fallbackConfidence * 100).toFixed(1)}% (no AI validation)`,
    });
  }
}
