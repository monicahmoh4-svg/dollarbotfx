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
}

interface AIResponse {
  confidence: number;
  shouldTrade: boolean;
  reasoning: string;
  refinement: string;
}

const RISE_FALL_PROMPT = `You are a professional quantitative trading analyst for Deriv synthetic volatility indices. You calibrate trade confidence scores based on technical indicators.

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

const DIGIT_PROMPT = `You are a professional quantitative trading analyst for Deriv synthetic volatility indices. You calibrate trade confidence scores for DIGIT-BASED contracts.

These contracts are STATISTICAL, not directional. They depend on the distribution and patterns of the LAST DIGIT of price quotes.

CRITICAL RULES:

1. VETO (shouldTrade=false) if:
   - digitBias < 0.04 (distribution is too uniform - no exploitable pattern)
   - signalStrength is WEAK
   - consecutiveAbove < 2 (need at least 2 consecutive digits above threshold to confirm pattern)

2. REDUCE confidence by 10-15% if:
   - digitBias is between 0.04-0.07 (mild pattern, may not persist)
   - digitStreak > 8 (long streak may reverse soon)

3. INCREASE confidence by 5-10% ONLY if:
   - digitBias > 0.12 (strong statistical pattern)
   - signalStrength is STRONG
   - consecutiveAbove >= 3 (strong confirmation)

4. NEVER set confidence above 0.85.
5. Return ONLY valid JSON. No markdown wrapping.

RESPONSE FORMAT:
{
  "confidence": <0.0 to 0.90>,
  "shouldTrade": <true only if confidence >= 0.72>,
  "reasoning": "<1 sentence assessment>",
  "refinement": "<1 sentence what you changed>"
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const indicators: IndicatorSet = req.body;

    if (!indicators || typeof indicators !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const isDigitCategory = indicators.category !== 'rise_fall';

    // === PRE-VALIDATION: Hard rules before calling AI ===
    if (isDigitCategory) {
      if (indicators.digitBias != null && indicators.digitBias < 0.03) {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.40),
          shouldTrade: false,
          reasoning: `Digit bias too weak (${((indicators.digitBias || 0) * 100).toFixed(1)}%) - uniform distribution`,
          refinement: 'Pre-AI filter: no exploitable digit pattern',
        });
      }
      if (indicators.signalStrength === 'WEAK') {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.50),
          shouldTrade: false,
          reasoning: 'Weak signal strength for digit contract',
          refinement: 'Pre-AI filter: weak signal',
        });
      }
      if (indicators.digitStreak != null && indicators.digitStreak > 10) {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.50),
          shouldTrade: false,
          reasoning: `Digit streak of ${indicators.digitStreak} - high reversal risk`,
          refinement: 'Pre-AI filter: excessive streak',
        });
      }
      if (indicators.consecutiveAbove != null && indicators.consecutiveAbove < 2) {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.45),
          shouldTrade: false,
          reasoning: `Only ${indicators.consecutiveAbove} consecutive digits above threshold - need 2+`,
          refinement: 'Pre-AI filter: insufficient consecutive confirmation',
        });
      }
    } else {
      if (indicators.htfRsi > 75 || indicators.htfRsi < 25) {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.45),
          shouldTrade: false,
          reasoning: `HTF RSI extreme (${indicators.htfRsi.toFixed(1)}) - hard veto`,
          refinement: 'Pre-AI filter: RSI overbought/oversold',
        });
      }
      if (indicators.adx < 15) {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.40),
          shouldTrade: false,
          reasoning: `ADX too low (${indicators.adx.toFixed(1)}) - no trend`,
          refinement: 'Pre-AI filter: choppy non-trending market',
        });
      }
      if (!indicators.trendAlignment) {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.50),
          shouldTrade: false,
          reasoning: 'HTF and LTF do not agree - timeframe conflict',
          refinement: 'Pre-AI filter: multi-timeframe disagreement',
        });
      }
      if (indicators.signalStrength === 'WEAK') {
        return res.status(200).json({
          confidence: Math.min(indicators.technicalScore || 0, 0.55),
          shouldTrade: false,
          reasoning: 'Signal strength too weak for trade',
          refinement: 'Pre-AI filter: weak signal classification',
        });
      }
    }

    // If GEMINI_API_KEY is not set, skip AI and use technical score directly
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const fallbackConfidence = Math.min(indicators.technicalScore * 0.90, 0.75);
      return res.status(200).json({
        confidence: fallbackConfidence,
        shouldTrade: fallbackConfidence >= 0.72,
        reasoning: 'AI unavailable (no API key) - using technical score with safety margin',
        refinement: `Technical score ${(indicators.technicalScore * 100).toFixed(1)}% adjusted to ${(fallbackConfidence * 100).toFixed(1)}%`,
      });
    }

    const systemPrompt = isDigitCategory ? DIGIT_PROMPT : RISE_FALL_PROMPT;

    const userMessage = isDigitCategory
      ? `CALIBRATE this DIGIT-BASED trade signal.

Symbol: ${indicators.symbol}
Category: ${indicators.category}
Contract Type: ${indicators.direction || 'DIGIT'}
Signal Strength: ${indicators.signalStrength}
Technical Score: ${((indicators.technicalScore || 0) * 100).toFixed(1)}%

=== Digit Statistics ===
Digit Bias: ${((indicators.digitBias || 0) * 100).toFixed(1)}% deviation from uniform
Digit Streak: ${indicators.digitStreak || 0} repetitions of last digit
Consecutive Above Threshold: ${indicators.consecutiveAbove || 0}
Digit Above Threshold %: ${((indicators.digitAboveThreshold || 0) * 100).toFixed(1)}%

=== Market Context ===
Bollinger Width: ${(indicators.bbWidth || 0).toFixed(6)}
Last Price: ${(indicators.lastPrice || 0).toFixed(4)}
ADX: ${(indicators.adx || 0).toFixed(1)}
Stochastic: ${(indicators.stochK || 0).toFixed(1)}`
      : `CALIBRATE this trade signal.

Symbol: ${indicators.symbol}
Direction: ${indicators.direction}
Signal Strength: ${indicators.signalStrength}
Technical Score: ${((indicators.technicalScore || 0) * 100).toFixed(1)}%

=== HTF (20-tick) Indicators ===
HTF Trend: ${(indicators.htfTrend || 0).toFixed(6)} (${(indicators.htfTrend || 0) > 0 ? 'BULLISH' : 'BEARISH'})
HTF Slope: ${(indicators.htfSlope || 0).toFixed(6)}
HTF RSI(14): ${(indicators.htfRsi || 0).toFixed(1)}
ADX(14): ${(indicators.adx || 0).toFixed(1)} (${(indicators.adx || 0) >= 30 ? 'STRONG' : (indicators.adx || 0) >= 20 ? 'MODERATE' : 'WEAK'})
Stochastic(14): ${(indicators.stochK || 0).toFixed(1)}

=== LTF (5-tick) Indicators ===
MACD Line: ${(indicators.macdLine || 0).toFixed(6)}
MACD Signal: ${(indicators.macdSignal || 0).toFixed(6)}
MACD Histogram: ${(indicators.macdHist || 0).toFixed(6)}
MACD Accelerating: ${indicators.macdAccel}
Momentum (ROC 12): ${((indicators.momentum || 0) * 10000).toFixed(2)} bps
Candle Up: ${indicators.candleUp}
RSI(14): ${(indicators.rsi || 0).toFixed(1)}

=== Volatility ===
Bollinger Width: ${(indicators.bbWidth || 0).toFixed(6)}
Last Price: ${(indicators.lastPrice || 0).toFixed(4)}

=== Multi-TF Status ===
HTF Agreement: ${indicators.htfAgreement}
LTF Agreement: ${indicators.ltfAgreement}
Trend Alignment: ${indicators.trendAlignment}`;

    let parsed: AIResponse;
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { temperature: 0.15, maxOutputTokens: 250 },
      });

      const result = await model.generateContent(systemPrompt + '\n\n' + userMessage);
      const text = result.response.text();

      const jsonMatch = text.match(/\{[^]*\}/);
      parsed = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { confidence: 0, shouldTrade: false, reasoning: 'AI parse failure', refinement: 'Could not parse AI response' };
    } catch (aiError: any) {
      console.error('Gemini AI error:', aiError?.message || aiError);
      // AI failed - use technical score with safety reduction
      const fallbackConfidence = Math.min((indicators.technicalScore || 0) * 0.85, 0.70);
      return res.status(200).json({
        confidence: fallbackConfidence,
        shouldTrade: fallbackConfidence >= 0.72,
        reasoning: 'AI call failed - using technical score with penalty',
        refinement: `Error: ${aiError?.message || 'unknown'}`,
      });
    }

    // POST-AI VALIDATION
    let finalConfidence = Math.min(isDigitCategory ? 0.90 : 0.92, Math.max(0, parsed.confidence || 0));

    if (finalConfidence > (indicators.technicalScore || 0) + 0.05) {
      finalConfidence = (indicators.technicalScore || 0) + 0.05;
    }

    if (indicators.signalStrength === 'STRONG') {
      finalConfidence = Math.min(finalConfidence, 0.88);
    } else if (indicators.signalStrength === 'MODERATE') {
      finalConfidence = Math.min(finalConfidence, 0.82);
    }

    const shouldTrade = finalConfidence >= 0.72;

    return res.status(200).json({
      confidence: finalConfidence,
      shouldTrade,
      reasoning: parsed.reasoning || 'AI analysis complete',
      refinement: parsed.refinement || 'No refinement',
    });
  } catch (error: any) {
    console.error('Handler error:', error?.message || error);
    return res.status(200).json({
      confidence: 0,
      shouldTrade: false,
      reasoning: `Server error: ${error?.message || 'unknown'}`,
      refinement: 'Handler exception caught',
    });
  }
}
