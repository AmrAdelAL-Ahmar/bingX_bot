import logger from '../utils/logger';
import { BingXService } from './BingXService';
import { CoreAnalysisService } from '../core/analysis/CoreAnalysisService';
import { AnalysisFormatter } from '../core/analysis/AnalysisFormatter';
import { TechnicalAnalyzer, MATRIX_TFS } from '../core/analysis/TechnicalAnalyzer';
import { 
    OHLCV, 
    CandleData, 
    IndicatorData, 
    TechnicalLevels, 
    IndicatorSentiment, 
    AnalysisDetails, 
    TradeRecommendation, 
    MatrixResult, 
    PredictionResult, 
    AnalysisResult 
} from '../core/shared/types';

// Re-export types for backward compatibility
export { 
    OHLCV, 
    CandleData, 
    IndicatorData, 
    TechnicalLevels, 
    IndicatorSentiment, 
    AnalysisDetails, 
    TradeRecommendation, 
    MatrixResult, 
    PredictionResult, 
    AnalysisResult 
};

export { AnalysisFormatter };

// --- Main Service Bridge ---

export class AnalysisService {
    constructor(private bingxService: BingXService) { }

    async analyze(
        symbolInput: string,
        version: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14' | 'V15' | 'V16' = 'V1',
        options: { quickTF?: string, longTF?: string, limit?: number, rsiThreshold?: number, antiRepainting?: boolean } = {}
    ): Promise<AnalysisResult> {
        let symbol = symbolInput.toUpperCase();
        if (!symbol.includes('/')) symbol = `${symbol}/USDT:USDT`;

        const quickTF = options.quickTF || '5m';
        const longTF = options.longTF || '1h';
        const limit = options.limit || 200;

        // Fetch Precision and OHLCV in parallel
        const [pricePrecision, ...fetchResults] = await Promise.all([
            this.bingxService.getPricePrecision(symbol),
            ...MATRIX_TFS.map(async tf => {
                const fetchLimit = (tf === quickTF || tf === longTF) ? Math.max(limit, 200) : 200;
                const ohlcv = await this.bingxService.fetchOHLCV(symbol, tf, fetchLimit);
                return { tf, ohlcv };
            })
        ]);
        
        const mtfOHLCV: Record<string, OHLCV[]> = {};
        fetchResults.forEach(res => mtfOHLCV[res.tf] = res.ohlcv);

        // Delegate computation to CoreAnalysisService in-memory processor
        return CoreAnalysisService.analyze(symbol, pricePrecision, mtfOHLCV, version, { quickTF, longTF, limit, antiRepainting: options.antiRepainting });
    }

    async generateCorrectionReport(res: AnalysisResult, direction: "LONG" | "SHORT"): Promise<string> {
        const symbol = res.symbol;
        const tfs = ['5m', '15m', '1h'];
        // Parallel fetching for correction report
        const results = await Promise.all(tfs.map(async tf => {
            const ohlcv = await this.bingxService.fetchOHLCV(symbol, tf, 50);
            const div = TechnicalAnalyzer.detectDivergence(ohlcv, direction);
            const fib = TechnicalAnalyzer.calculateCorrectionFibLevels(ohlcv, direction);
            return { tf, div, fib, price: ohlcv[ohlcv.length - 1].close };
        }));

        let r = `🔍 **رادار التصحيح المتعدد (MTF Correction) - ${symbol}** 🔍\n`;
        r += `━━━━━━━━━━━━━━\n`;
        r += `💵 السعر الحالي: **$${res.currentPrice.toFixed(res.pricePrecision)}**\n\n`;

        results.forEach(item => {
            const divEmoji = item.div.detected ? '⚠️' : '✅';
            r += `📊 **فريم [${item.tf}]**:\n`;
            r += `• الحالة: ${divEmoji} ${item.div.description}\n`;
            r += `• مستوى 0.382: \`$${item.fib.fib382.toFixed(res.pricePrecision)}\`\n`;
            r += `• مستوى 0.500: \`$${item.fib.fib500.toFixed(res.pricePrecision)}\`\n`;
            r += `• مستوى 0.618: \`$${item.fib.fib618.toFixed(res.pricePrecision)}\` 🔥\n`;
            r += `━━━━━━━━━━━━━━\n`;
        });

        r += `⚠️ **توصية الحماية الشاملة:**\n`;
        const detectedCount = results.filter(i => i.div.detected).length;
        const isLong = res.scalp.type !== 'SHORT';

        let warning = '';
        if (detectedCount >= 2) {
            warning = `🚨 **خطر انعكاس مؤكد (Confluence):** تصحيح مرصود على فريمات متعددة. اخرج الآن لحماية محفظتك!`;
        } else if (detectedCount === 1) {
            warning = `🟠 **تحذير: بداية ضعف:** هناك بوادر تصحيح على فريم واحد. ارفع الستوب لوز فوراً.`;
        } else {
            const f5 = results[0].fib;
            if (isLong && res.currentPrice < f5.fib500) {
                warning = `🟠 **تصحيح عميق (5m):** السعر كسر مستوى 0.500. راقب الهدف $${f5.fib618.toFixed(res.pricePrecision)}.`;
            } else {
                warning = `🟢 **وضع مستقر:** لا يوجد توافق على التصحيح حالياً. الاتجاه لا يزال يحافظ على قوته.`;
            }
        }

        return r + `${warning}\n━━━━━━━━━━━━━━\n💡 *هذا التقرير يجمع بين التحليل التكتيكي والاستراتيجي.*`;
    }

    isPivotBroken(cp: number, pivot: number, direction: 'LONG' | 'SHORT'): boolean {
        return direction === 'LONG' ? cp < pivot : cp > pivot;
    }

    // Proxy methods for backward compatibility
    formatReport(res: AnalysisResult, v: string): string {
        return AnalysisFormatter.formatReport(res, v);
    }
    
    formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25, pricePrecision: number = 4): string {
        return AnalysisFormatter.formatSignalText(symbol, type, entry, targets, sl, leverage, pricePrecision);
    }

    detectDivergence(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT' = 'LONG'): { detected: boolean, description: string } {
        return TechnicalAnalyzer.detectDivergence(ohlcv, direction);
    }

    calculateCorrectionFibLevels(ohlcv: OHLCV[], direction: 'LONG' | 'SHORT' = 'LONG') {
        return TechnicalAnalyzer.calculateCorrectionFibLevels(ohlcv, direction);
    }

    generateDetailedReport(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        return AnalysisFormatter.generateDetailedReport(res, type);
    }

    generateEducationalGuide(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        return AnalysisFormatter.generateEducationalGuide(res, type);
    }

    generateComprehensiveReport(res: AnalysisResult): string {
        return AnalysisFormatter.generateComprehensiveReport(res);
    }

    getAlgorithmExplanation(v: string): string {
        return AnalysisFormatter.getAlgorithmExplanation(v);
    }
}
