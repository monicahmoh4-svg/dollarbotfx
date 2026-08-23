export interface Candle {
    open: number;
    high: number;
    low: number;
    close: number;
    startTime: number;
    endTime: number;
    isComplete: boolean;
}

export class CandleEngine {
    private currentCandle: Candle | null = null;
    private completedCandles: Candle[] = [];
    private readonly timeframeMs: number;

    constructor(timeframeMs: number = 60000) { // Default 1 minute
        this.timeframeMs = timeframeMs;
    }

    processTick(price: number, epoch: number): Candle | null {
        const candleStartTime = Math.floor(epoch / this.timeframeMs) * this.timeframeMs;
        const candleEndTime = candleStartTime + this.timeframeMs;

        if (!this.currentCandle || this.currentCandle.startTime !== candleStartTime) {
            if (this.currentCandle) {
                this.currentCandle.isComplete = true;
                this.completedCandles.push(this.currentCandle);
                if (this.completedCandles.length > 500) this.completedCandles.shift();
            }
            this.currentCandle = {
                open: price,
                high: price,
                low: price,
                close: price,
                startTime: candleStartTime,
                endTime: candleEndTime,
                isComplete: false,
            };
            return null; // New candle started, not complete
        }

        this.currentCandle.high = Math.max(this.currentCandle.high, price);
        this.currentCandle.low = Math.min(this.currentCandle.low, price);
        this.currentCandle.close = price;
        
        return this.currentCandle; // Return updating candle, but strategy must check isComplete
    }

    getCompletedCandles(): Candle[] {
        return this.completedCandles;
    }
}
