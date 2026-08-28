import { runBacktest, walkForward, monteCarlo, fetchDerivHistory } from '../src/autotrader/backtest';
import { analyzeRiseFall } from '../src/autotrader/analysis';

const args = process.argv.slice(2);
const getArg = (name: string, def: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
};

const SYMBOL = getArg('symbol', 'R_50');
const HOURS = Number(getArg('hours', '36'));
const DURATION = Number(getArg('duration', '5'));
const STAKE = Number(getArg('stake', '2'));
const LOOKBACK = Number(getArg('lookback', '1000'));
const STEP = Number(getArg('step', String(DURATION)));
const APP_ID = getArg('app_id', '1089');

function openWS(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws: any = new (globalThis as any).WebSocket(url);
        ws.onopen = () => resolve(ws);
        ws.onerror = (e: any) => reject(e?.error || new Error('WS error'));
        ws.binaryType = 'arraybuffer';
    });
}

async function main() {
    const url = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
    const ws = await openWS(url);
    console.log(`Connected to Deriv WS (app_id=${APP_ID})`);

    const sendFn = (req: Record<string, unknown>) =>
        new Promise<any>((resolve) => {
            const onMsg = (raw: any) => {
                let data: any;
                try { data = JSON.parse(raw.data?.toString?.() ?? raw.toString()); } catch { return; }
                if (data.error || data.history) {
                    ws.removeEventListener('message', onMsg);
                    resolve(data);
                }
            };
            ws.addEventListener('message', onMsg);
            ws.send(JSON.stringify(req));
        });

    const end = Math.floor(Date.now() / 1000);
    const start = end - HOURS * 3600;
    console.log(`Fetching ${SYMBOL} history: last ${HOURS}h (${start}..${end})...`);
    const hist = await fetchDerivHistory(sendFn, SYMBOL, start, end, 8000);
    ws.close();

    const prices = hist.map((h) => h.price);
    console.log(`Fetched ${prices.length} ticks.`);
    if (prices.length < 400) {
        console.log('NOT ENOUGH DATA — try a longer --hours window.');
        return;
    }

    // Diagnostic: why does rise_fall produce so few signals?
    const regimeCount: Record<string, number> = {};
    let rfSignal = 0;
    let rfAligned = 0;
    for (let i = LOOKBACK; i + DURATION < prices.length; i += STEP) {
        const w = prices.slice(i - LOOKBACK, i);
        const r = analyzeRiseFall(w);
        const reg = r.regime || 'UNCLEAR';
        regimeCount[reg] = (regimeCount[reg] || 0) + 1;
        if (r.contractType) rfSignal += 1;
        if (r.htfAgreement && r.ltfAgreement) rfAligned += 1;
    }
    console.log(`\n[DIAG] rise_fall signal windows=${rfSignal}, htf&ltf aligned windows=${rfAligned}`);
    console.log('[DIAG] regime distribution:', regimeCount);

    const rets: number[] = [];
    for (let i = 1; i < prices.length; i += 1) rets.push((prices[i] - prices[i - 1]) / (prices[i - 1] || 1));
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
    const sorted = [...rets].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.floor(sorted.length * p)].toFixed(6);
    console.log(`[DIAG] tick-return mean=${m.toFixed(6)} stdev=${sd.toFixed(6)} p05=${pct(0.05)} p50=${pct(0.5)} p95=${pct(0.95)}`);

    const report = runBacktest(prices, SYMBOL, {
        durationTicks: DURATION, stake: STAKE, lookback: LOOKBACK, step: STEP,
    });
    console.log('\n===== BACKTEST (per category) =====');
    (['rise_fall', 'even_odd', 'over_under', 'matches_differs'] as const).forEach((c) => {
        const cb = report.categories[c];
        console.log(
            `${c.padEnd(16)} trades=${String(cb.trades.length).padStart(5)} ` +
            `win%=${(cb.winRate * 100).toFixed(1).padStart(5)} ` +
            `EV=${cb.expectancy >= 0 ? '+' : ''}${cb.expectancy.toFixed(3)} ` +
            `PF=${cb.profitFactor === Infinity ? 'inf' : cb.profitFactor.toFixed(2)} ` +
            `maxDD=${cb.maxDrawdown.toFixed(2)} net=${cb.finalEquity.toFixed(2)}`,
        );
    });
    console.log(`Best category: ${report.bestCategory ?? 'NONE (all negative EV)'}`);

    const wf = walkForward(prices, SYMBOL, 5, { durationTicks: DURATION, stake: STAKE, lookback: LOOKBACK, step: STEP });
    console.log('\n===== WALK-FORWARD (expectancy per fold) =====');
    wf.folds.forEach((f, i) => {
        const row = (['rise_fall', 'even_odd', 'over_under', 'matches_differs'] as const)
            .map((c) => `${c}=${f.expectancy[c] >= 0 ? '+' : ''}${f.expectancy[c].toFixed(3)}`).join('  ');
        console.log(`Fold ${i + 1}: ${row}`);
    });
    console.log('Profitable folds:', (['rise_fall', 'even_odd', 'over_under', 'matches_differs'] as const)
        .map((c) => `${c} ${wf.profitableFoldCount[c]}/${wf.totalFolds}`).join('  '));

    const mc = monteCarlo(report, 2000);
    console.log('\n===== MONTE CARLO (2000 resamples) =====');
    mc.forEach((m) => {
        console.log(
            `${m.category.padEnd(16)} mean=${m.meanFinalEquity.toFixed(2).padStart(7)} ` +
            `P5=${m.p5.toFixed(2).padStart(7)} P95=${m.p95.toFixed(2).padStart(7)} ` +
            `P(profit)=${(m.probProfit * 100).toFixed(0)}% P(ruin)=${(m.probRuin * 100).toFixed(0)}%`,
        );
    });
}

main().catch((e) => {
    console.error('RUNNER ERROR:', e?.message || e);
    process.exit(1);
});
