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
}

interface AIResponse {
  confidence: number;
  shouldTrade: boolean;
  reasoning: string;
  refinement: string;
}

const SYSTEM_PROMPT = `You are a trading analysis AI specialized in synthetic volatility indices (Deriv).
Your job: review a set of technical indicators and calibrate a confidence score.

Rules:
1. The technical score (0-1) is a starting point. You may adjust it up or down based on market regime.
2. Overbought/oversold extremes, conflicting indicators, and low volatility should reduce confidence.
3. Strong trend alignment across timeframes should increase confidence.
4. Return ONLY valid JSON with no markdown or explanation outside the JSON.
5. confidence must be between 0.0 and 0.95.
6. shouldTrade is true only if confidence >= 0.70.
7. reasoning is a short (1 sentence) plain-English assessment.
8. refinement is a short (1 sentence) explanation of what you changed and why.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const indicators: IndicatorSet = req.body;

  const userMessage = `Analyze this market signal:

Symbol: ${indicators.symbol}
Direction: ${indicators.direction}
Technical Score: ${(indicators.technicalScore * 100).toFixed(1)}%
RSI: ${indicators.rsi.toFixed(1)}
MACD Histogram: ${indicators.macdHist.toFixed(6)}
MACD Accelerating: ${indicators.macdAccel}
HTF Trend: ${indicators.htfTrend.toFixed(6)}
HTF Slope: ${indicators.htfSlope.toFixed(6)}
Momentum (ROC 8): ${indicators.momentum.toFixed(6)}
Candle Direction (up): ${indicators.candleUp}
Bollinger Width: ${indicators.bbWidth.toFixed(6)}
Last Price: ${indicators.lastPrice.toFixed(4)}`;

  try {
    // Use Google Generative AI SDK with GEMINI_API_KEY from Vercel env
    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
    });

    const prompt = `${SYSTEM_PROMPT}

${userMessage}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON from Gemini response (may have markdown wrapping)
    const jsonMatch = text.match(/\{[^]*\}/);
    const parsed: AIResponse = jsonMatch ? JSON.parse(jsonMatch[0]) : { confidence: indicators.technicalScore, shouldTrade: indicators.technicalScore >= 0.72, reasoning: 'AI parse error', refinement: 'Falling back to technical score' };

    return res.status(200).json({
      confidence: Math.min(0.95, Math.max(0, parsed.confidence)),
      shouldTrade: parsed.shouldTrade,
      reasoning: parsed.reasoning,
      refinement: parsed.refinement,
    });
  } catch (error: any) {
    console.error('Gemini AI analysis error:', error.message);
    return res.status(200).json({
      confidence: indicators.technicalScore,
      shouldTrade: indicators.technicalScore >= 0.72,
      reasoning: 'Gemini unavailable, using technical score',
      refinement: 'Gemini call failed, falling back to technical analysis',
    });
  }
}
