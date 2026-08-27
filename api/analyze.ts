import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

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

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userMessage = `Analyze this market signal:\n\nSymbol: ${indicators.symbol}\nDirection: ${indicators.direction}\nTechnical Score: ${(indicators.technicalScore * 100).toFixed(1)}%\nRSI: ${indicators.rsi.toFixed(1)}\nMACD Histogram: ${indicators.macdHist.toFixed(6)}\nMACD Accelerating: ${indicators.macdAccel}\nHTF Trend: ${indicators.htfTrend.toFixed(6)}\nHTF Slope: ${indicators.htfSlope.toFixed(6)}\nMomentum (ROC 8): ${indicators.momentum.toFixed(6)}\nCandle Direction (up): ${indicators.candleUp}\nBollinger Width: ${indicators.bbWidth.toFixed(6)}\nLast Price: ${indicators.lastPrice.toFixed(4)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const text = completion.choices[0]?.message?.content || '{}';
    const result = JSON.parse(text);

    return res.status(200).json({
      confidence: Math.min(0.95, Math.max(0, result.confidence)),
      shouldTrade: result.shouldTrade,
      reasoning: result.reasoning,
      refinement: result.refinement,
    });
  } catch (error: any) {
    console.error('AI analysis error:', error);
    return res.status(200).json({
      confidence: indicators.technicalScore,
      shouldTrade: indicators.technicalScore >= 0.72,
      reasoning: 'AI unavailable, using technical score',
      refinement: 'AI call failed, falling back to technical analysis',
    });
  }
}
