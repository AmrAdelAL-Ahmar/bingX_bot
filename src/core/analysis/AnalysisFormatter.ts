import { 
    AnalysisResult, 
    AnalysisDetails, 
    MatrixResult, 
    IndicatorData, 
    TechnicalLevels, 
    IndicatorSentiment, 
    TradeRecommendation 
} from '../shared/types';

export class AnalysisFormatter {
    static formatReport(res: AnalysisResult, v: string): string {
        const { scalp, swing, matrix, options, prediction, sniper } = res;

        const p = res.pricePrecision;
        let r = `💎 **المحلل الاحتمالي V7 SNIPER | ${res.symbol}** 💎\n` +
            `💵 السعر الحالي: **$${res.currentPrice.toFixed(p)}** | **${v}**\n` +
            `━━━━━━━━━━━━━━\n`;

        if (sniper.isStochSynced) r += `🔥 **«إشارة قنص ذهبية: قاع مزدوج متزامن»** 🔥\n`;
        if (sniper.isFullBreakout) r += `🚀 **«انفجار سعري وشيك: المصفوفة مكتملة»** 🚀\n`;
        if (sniper.isAboveGolden) r += `✨ **«فوق المستوى الذهبي 0.618»** ✨\n`;
        if (sniper.isStochSynced || sniper.isFullBreakout) r += `━━━━━━━━━━━━━━\n`;

        // SCALP SECTION
        const sIcon = scalp.winRate >= 80 ? '🔥' : scalp.winRate >= 65 ? '✅' : '⚠️';
        r += `⚡ **«تحليل السكالبينج - ${options.quickTF}»**\n` +
            `• النتيجة: ${scalp.status} ${sIcon}\n`;
        if (scalp.rejectionReason) r += `• سبب الرفض: 🛡️ **${scalp.rejectionReason}**\n`;
        r += `• التوصية: **${scalp.type}** | Win: **${scalp.winRate.toFixed(0)}%**\n` +
            `• الأهداف: 🎯 **${scalp.tp.toFixed(p)}** | 🛑 **${scalp.sl.toFixed(p)}**\n` +
            `• المؤشرات: RSI:**${scalp.rsi.toFixed(1)}** | هيكل:**${scalp.structure}**\n` +
            `• المستويات: R1:${scalp.levels.r1.toFixed(p)} | S1:${scalp.levels.s1.toFixed(p)}\n\n`;

        // SWING SECTION
        const wIcon = swing.winRate >= 80 ? '🔥' : swing.winRate >= 65 ? '✅' : '⚠️';
        r += `🌊 **«تحليل السوينج - ${options.longTF}»**\n` +
            `• النتيجة: ${swing.status} ${wIcon}\n`;
        if (swing.rejectionReason) r += `• سبب الرفض: 🛡️ **${swing.rejectionReason}**\n`;
        r += `• التوصية: **${swing.type}** | Win: **${swing.winRate.toFixed(0)}%**\n` +
            `• الأهداف: 🎯 **${swing.tp.toFixed(p)}** | 🛑 **${swing.sl.toFixed(p)}**\n` +
            `• المؤشرات: RSI:**${swing.rsi.toFixed(1)}** | هيكل:**${swing.structure}**\n` +
            `• المستويات: R1:${swing.levels.r1.toFixed(p)} | S1:${swing.levels.s1.toFixed(p)}\n\n`;

        if (matrix) r += `📈 **المصفوفة (MTF):** **${matrix.percentage.toFixed(0)}%** | ${matrix.decision}\n${matrix.details}\n\n`;
        if (prediction) r += `🔮 **التوقع الإحصائي:** **$${prediction.predictedPrice.toFixed(p)}** (${prediction.trendDirection})\n`;

        r += `━━━━━━━━━━━━━━\n`;
        r += `💡 *استخدم التقرير التفصيلي لمعرفة مناطق الدخول الدقيقة.*`;

        return r;
    }

    static formatSignalText(symbol: string, type: 'LONG' | 'SHORT', entry: number, targets: number[], sl: number, leverage: number = 25, pricePrecision: number = 4): string {
        const p = pricePrecision;
        return `\`${symbol}\`\n\n` +
            `${type === 'LONG' ? '🔼LONG' : '🔽SHORT'}  X${leverage}  \n\n` +
            `▶️ENTER PRICE(سعر الدخول):\n${entry.toFixed(p)}\n\n` +
            `▶️TARGET  PRICES(الاهداف):\n${targets.map(t => t.toFixed(p)).join('\n')}\n\n` +
            `▶️STOP LOSE(الاستوب)\n${sl.toFixed(p)}`;
    }

    static generateDetailedReport(res: AnalysisResult, type: 'scalp' | 'swing', version?: string): string {
        const data = type === 'scalp' ? res.scalp : res.swing;
        const tf = type === 'scalp' ? res.options.quickTF : res.options.longTF;
        const v = version || 'V6';
        const sentiments = this.calculateSentiments(res.currentPrice, data.indicators, data.levels, res.matrix, data.structure, res.isAboveVWAP, tf, data.rsi);

        let report = `🔍 **التقرير التقني لـ ${res.symbol} (${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'}) - [${v}]**\n\n`;
        report += `💵 السعر الحالي: \`$${res.currentPrice.toFixed(res.pricePrecision)}\`\n`;
        report += `⚙️ الفريم المحلل: \`${tf}\`\n\n`;

        // Dedicated section for HARMONIC
        if (v === 'HARMONIC' || data.status?.includes('HARMONIC') || res.matrix?.decision?.includes('توافقي')) {
            report += `📐 **تفاصيل منظومة الهارمونيك:**\n`;
            report += `• حالة النموذج: **${(data.status || '').replace(/_/g, ' ')}**\n`;
            report += `• التقييم التوافقي: **${res.matrix.decision}**\n`;
            report += `• تفاصيل الـ PRZ: ${res.matrix.details}\n`;
            if (data.signalReason) report += `• سبب الإشارة: \`${data.signalReason}\`\n`;
            report += `━━━━━━━━━━━━━━\n\n`;
        }

        // Dedicated section for V17 (Market Regime)
        if (v === 'V17' || data.status?.includes('V17') || res.matrix?.details?.includes('Regime')) {
            report += `🌐 **تفاصيل نظام السوق (V17 Market Regime):**\n`;
            report += `• حالة السوق: **${(data.status || '').replace(/_/g, ' ')}**\n`;
            report += `• تقرير النظام: **${res.matrix.decision}**\n`;
            report += `• تفاصيل المحركات الموصى بها: ${res.matrix.details}\n`;
            report += `━━━━━━━━━━━━━━\n\n`;
        }

        // Dedicated section for V18 (Order Book & Flow)
        if (v === 'V18' || data.status?.includes('V18') || res.matrix?.details?.includes('Imbalance') || res.matrix?.details?.includes('L2')) {
            report += `📊 **تفاصيل تدفق السيولة وعمق الأوامر (V18 Order Book):**\n`;
            report += `• حالة التدفق: **${(data.status || '').replace(/_/g, ' ')}**\n`;
            report += `• ضغط السيولة: **${res.matrix.decision}**\n`;
            report += `• مؤشر التباين L2: ${res.matrix.details}\n`;
            report += `━━━━━━━━━━━━━━\n\n`;
        }

        report += `📊 **تحليل الزخم والمؤشرات:**\n`;
        sentiments.forEach(s => {
            if (s.name === 'Structure') return;
            const emoji = s.status === 'BULLISH' ? '🟢' : s.status === 'BEARISH' ? '🔴' : '⚪';
            report += `${emoji} **${s.name}**: \`${s.value}\` | ${s.description}\n`;
        });

        const p = res.pricePrecision;
        report += `\n🎯 **مستويات الدعم والمقاومة:**\n`;
        report += `🛑 **R2**: \`${data.levels.r2.toFixed(p)}\`\n`;
        report += `🔸 **R1**: \`${data.levels.r1.toFixed(p)}\`\n`;
        report += `📍 **Pivot**: \`${data.levels.pivot.toFixed(p)}\`\n`;
        report += `🔹 **S1**: \`${data.levels.s1.toFixed(p)}\`\n`;
        report += `🛑 **S2**: \`${data.levels.s2.toFixed(p)}\`\n`;

        report += `\n📐 **مستويات فيبوناتشي الاستراتيجية:**\n`;
        report += `🏁 الهدف (Extension): \`${data.levels.fibTarget.toFixed(p)}\`\n`;
        report += `🟡 الذهبي (0.618): \`${data.levels.fib618.toFixed(p)}\`\n`;
        report += `⚪ تصحيح (0.382): \`${data.levels.fib382.toFixed(p)}\`\n`;

        report += `\n🏛 **هيكل السوق:** ${data.structure || 'عرضي ↔️'}\n`;
        report += `📉 *تمت معالجة بيانات فريم ${tf} لتقديم هذه الأرقام.*`;

        return report;
    }

    static generateEducationalGuide(res: AnalysisResult, type: 'scalp' | 'swing'): string {
        const data = type === 'scalp' ? res.scalp : res.swing;
        const tf = type === 'scalp' ? res.options.quickTF : res.options.longTF;
        const sentiments = this.calculateSentiments(res.currentPrice, data.indicators, data.levels, res.matrix, data.structure, res.isAboveVWAP, tf, data.rsi);

        const getIndicatorStatus = (name: string) => {
            const s = sentiments.find(item => item.name === name);
            if (!s) return '⚪ محايد';
            return s.status === 'BULLISH' ? '🟢 إيجابي' : s.status === 'BEARISH' ? '🔴 سلبي' : '⚪ محايد';
        };

        let r = `🎓 **الدليل التعليمي لمؤشرات (${type === 'scalp' ? 'Scalp ⚡' : 'Swing 🌊'})**\n`;
        r += `━━━━━━━━━━━━━━\n`;
        r += `🕒 تحليل فريم: **${tf}**\n\n`;

        r += `🔹 **RSI (قوة الزخم)**\n`;
        r += `• القيمة: \`${data.rsi.toFixed(1)}\` | **${getIndicatorStatus('RSI')}**\n`;
        r += `• 🟢 دخول LONG: إذا كانت القيمة \`< 30\` (تشبع بيعي)\n`;
        r += `• 🔴 دخول SHORT: إذا كانت القيمة \`> 70\` (تشبع شرائي)\n`;
        r += `• ⚪ توقف: إذا كانت القيمة بين \`45 - 55\` (منطقة حيرة)\n\n`;

        r += `🔹 **MACD (قوة الانفجار)**\n`;
        r += `• القيمة: \`${data.indicators.macd.histogram.toFixed(4)}\` | **${getIndicatorStatus('MACD')}**\n`;
        r += `• 🟢 دخول LONG: تقاطع للأعلى وقيمة موجبة \`> 0\`\n`;
        r += `• 🔴 دخول SHORT: تقاطع للأسفل وقيمة سالبة \`< 0\`\n\n`;

        r += `🔹 **Matrix (توافق السوق)**\n`;
        r += `• القيمة: \`${res.matrix.percentage.toFixed(0)}%\` | **${res.matrix.decision}**\n`;
        r += `• 🟢 دخول LONG: توافق الفريمات بنسبة \`> 55%\`\n`;
        r += `• 🔴 دخول SHORT: توافق الفريمات بنسبة \`< 45%\`\n\n`;

        r += `🔹 **MFI (تدفق السيولة)**\n`;
        r += `• القيمة: \`${data.indicators.mfi?.toFixed(1) || 'N/A'}\` | **${getIndicatorStatus('MFI')}**\n`;
        r += `• 🟢 دخول LONG: عندما يشتري الحيتان (قيمة \`< 20\`)\n`;
        r += `• 🔴 دخول SHORT: عندما يبيع الحيتان (قيمة \`> 80\`)\n\n`;

        r += `🔹 **CCI (قوة الترند)**\n`;
        r += `• القيمة: \`${data.indicators.cci.toFixed(0)}\` | **${getIndicatorStatus('CCI')}**\n`;
        r += `• 🟢 دخول LONG: بداية ترند صاعد قوي \`> 100\`\n`;
        r += `• 🔴 دخول SHORT: بداية ترند هابط قوي \`< -100\`\n\n`;

        r += `🔹 **Stoch RSI (التوقيت الدقيق)**\n`;
        r += `• القيمة: \`${data.indicators.stochRsi.toFixed(1)}\` | **${getIndicatorStatus('Stoch RSI')}**\n`;
        r += `• 🟢 دخول LONG: وصول السعر لقاع لحظي \`< 20\`\n`;
        r += `• 🔴 دخول SHORT: وصول السعر لقمة لحظية \`> 80\`\n\n`;

        r += `🔹 **VWAP (خط المؤسسات)**\n`;
        r += `• الحالة: **${res.isAboveVWAP ? '🟢 السعر فوق المتوسط المتوسط المؤسساتي' : '🔴 السعر تحت المتوسط المؤسساتي'}**\n`;
        r += `• 🟢 دخول LONG: عندما يكون السعر فوق الـ VWAP.\n`;
        r += `• 🔴 دخول SHORT: عندما يكون السعر تحت الـ VWAP.\n\n`;

        r += `🔹 **ATR (المخاطرة)**\n`;
        r += `• الوضع: **${data.atr > (res.currentPrice * 0.015) ? 'تذبذب عالي (خطير) ⚠️' : 'تذبذب مستقر (آمن) ✅'}**\n`;

        r += `━━━━━━━━━━━━━━\n`;
        r += `🏛 **هيكل السوق:** ${data.structure || 'عرضي ↔️'}\n`;
        r += `💡 *نصيحة: دائماً انتظر توافق 3 مؤشرات على الأقل قبل الدخول.*`;

        return r;
    }

    static generateComprehensiveReport(res: AnalysisResult): string {
        const p = res.pricePrecision;
        let r = `🌐 **التقرير الفني الشامل (Multi-Timeframe Analysis)** 🌐\n`;
        r += `━━━━━━━━━━━━━━\n`;
        r += `💵 السعر: **$${res.currentPrice.toFixed(p)}** | العملة: **${res.symbol}**\n\n`;

        const tfs = ['1m', '5m', '15m', '1h', '4h', '1d'];
        let bullishCount = 0;

        tfs.forEach(tf => {
            const data = res.allTimeframes[tf];
            if (!data) return;

            const isBullish = res.currentPrice > data.levels.ma20;
            if (isBullish) bullishCount++;

            const trendEmoji = isBullish ? '🟢' : '🔴';
            const rsiEmoji = data.rsi < 30 ? '🔵 (قاع)' : data.rsi > 70 ? '🟠 (قمة)' : '⚪';

            r += `📊 **فريم [${tf}]**: ${data.structure} | ${trendEmoji}\n`;
            r += `• RSI: \`${data.rsi.toFixed(1)}\`${rsiEmoji} | MFI: \`${data.indicators.mfi?.toFixed(0)}\`\n`;
            r += `• الدعم: \`${data.levels.s1.toFixed(p)}\` | المقاومة: \`${data.levels.r1.toFixed(p)}\`\n`;
            r += `━━━━━━━━━━━━━━\n`;
        });

        r += `\n💡 **خلاصة التوافق (Confluence):**\n`;
        r += `• عدد الفريمات الإيجابية (ترند): **${bullishCount} / ${tfs.length}**\n`;

        let conclusion = "محايد ⚪";
        if (bullishCount >= 5) conclusion = "صعود قوي 🔥 (توافق كامل)";
        else if (bullishCount >= 3) conclusion = "صعود متذبذب ✅";
        else if (bullishCount <= 1) conclusion = "هبوط مستمر 🔴";

        r += `• الاتجاه العام: **${conclusion}**\n`;

        return r;
    }

    private static calculateSentiments(cp: number, ind: IndicatorData, l: TechnicalLevels, m: MatrixResult, struct: string, isAboveVWAP: boolean, qTF: string, rsi: number): IndicatorSentiment[] {
        const s: IndicatorSentiment[] = [];

        s.push({
            name: 'RSI', value: rsi.toFixed(1),
            status: rsi < 35 ? 'BULLISH' : rsi > 65 ? 'BEARISH' : 'NEUTRAL',
            description: rsi < 35 ? 'تشبع بيعي - ارتداد صاعد محتمل' : rsi > 65 ? 'تشبع شرائي - جني أرباح محتمل' : 'زخم محايد',
            timeframe: qTF
        });

        const macdStatus = ind.macd.histogram > 0 ? 'BULLISH' : 'BEARISH';
        s.push({
            name: 'MACD', value: ind.macd.histogram.toFixed(4),
            status: macdStatus,
            description: macdStatus === 'BULLISH' ? 'زخم صاعد متزايد' : 'ضغط بيعي مستمر',
            timeframe: qTF
        });

        s.push({
            name: 'VWAP', value: isAboveVWAP ? 'Above' : 'Below',
            status: isAboveVWAP ? 'BULLISH' : 'BEARISH',
            description: isAboveVWAP ? 'السعر فوق المتوسط المؤسساتي' : 'السعر تحت المتوسط المؤسساتي',
            timeframe: '1d'
        });

        s.push({
            name: 'Matrix', value: `${m.percentage.toFixed(0)}%`,
            status: m.percentage >= 55 ? 'BULLISH' : m.percentage <= 45 ? 'BEARISH' : 'NEUTRAL',
            description: m.decision,
            timeframe: 'MTF'
        });

        s.push({
            name: 'Structure', value: struct,
            status: struct.includes('صاعد') ? 'BULLISH' : struct.includes('هابط') ? 'BEARISH' : 'NEUTRAL',
            description: 'هيكل السوق العام',
            timeframe: '1h'
        });

        if (ind.mfi !== undefined) {
            s.push({
                name: 'MFI', value: ind.mfi.toFixed(1),
                status: ind.mfi < 25 ? 'BULLISH' : ind.mfi > 75 ? 'BEARISH' : 'NEUTRAL',
                description: ind.mfi < 25 ? 'تدفق سيولة شرائية' : ind.mfi > 75 ? 'خروج سيولة' : 'تدفق مستقر',
                timeframe: qTF
            });
        }

        s.push({
            name: 'Stoch RSI', value: ind.stochRsi.toFixed(1),
            status: ind.stochRsi < 20 ? 'BULLISH' : ind.stochRsi > 80 ? 'BEARISH' : 'NEUTRAL',
            description: ind.stochRsi < 20 ? 'قاع لحظي - شراء' : ind.stochRsi > 80 ? 'قمة لحظية - بيع' : 'تذبذب عادي',
            timeframe: qTF
        });

        s.push({
            name: 'CCI', value: ind.cci.toFixed(0),
            status: ind.cci > 100 ? 'BULLISH' : ind.cci < -100 ? 'BEARISH' : 'NEUTRAL',
            description: ind.cci > 100 ? 'بداية ترند صاعد' : ind.cci < -100 ? 'بداية ترند هابط' : 'نطاق عرضي',
            timeframe: qTF
        });

        return s;
    }

    static getAlgorithmExplanation(v: string): string {
        if (v === 'V18') return "📊 **V18 Order Book & Flow Imbalance Sniper:** محرك تدفق السيولة وعمق الأوامر L2. يحلل التباين بين أحجام طلبات الشراء والبيع (Bid/Ask Imbalance)، ويكشف الجدران السعرية الكبرى وضغط السيولة اللحظي للتمركز مع كبار صناع السوق.";
        if (v === 'V17') return "🌐 **V17 Dynamic Market Regime Sniper:** محرك نظام السوق الديناميكي والتكيفي. يقوم بتصنيف بيئة السوق إلى (اتجاه صاعد، اتجاه هابط، تذبذب أفقي، أو انكماش سيولة حاد Squeeze) ويرشح أفضل المحركات المتوافقة مع النظام السائد.";
        if (v === 'HARMONIC') return "📐 **منظومة الهارمونيك الكاملة (11 نموذجاً):** المحرك التوافقي الرقمي الشامل. يرصد نماذج الهارمونيك بدقة نسب فيبوناتشي (Gartley, Bat, Butterfly, Crab, Deep Crab, Shark, Cypher, Nen Star, 5-0, Three Drives, Alternate Bat) مع تحديد مناطق الانعكاس المحتملة (PRZ) والأهداف المتدرجة.";
        if (v === 'V16') return "🏹 **V16 Master Hybrid Matrix Sniper:** المحرك الهجين المتكامل والمطور إنتاجياً. يدمج بين مدارس وايكوف التجميعية (Wyckoff Accumulation) من خلال فحص فترات الانضغاط السعري واختراقات الصناديق بدعم من ميل سيولة OBV والانحدار الخطي، والتحقق الهيكلي من زوايا جان الهندسية (Gann Wheel 180°/360°)، وتوقيتات التلاقي الكوني والفلكي مع دورات هيرست الزمنية وأطوار القمر الكبرى (أقمار جديدة، كاملة، أو ربعية) لتحديد اللحظة والمنطقة المثالية لانفجار السعر بدقة متناهية.";
        if (v === 'V12') return "📊 **V12 Order Flow & CVD Sniper:** محرك تدفق السيولة المتقدم. يقوم بتحليل أحجام التداول التراكمية (CVD) ورصد الانحرافات في الدلتا لكشف نفاد قوى البائعين/المشترين، مما يتيح استباق الحركات السعرية الكبرى والتنفيذ بالتزامن مع دخول السيولة المؤسساتية الحقيقية.";
        if (v === 'V13') return "🪤 **V13 Wyckoff & Liquidity Sweep Sniper:** محرك تتبع مصائد السيولة وهيكلية وايكوف. يركز على رصد عمليات سحب السيولة بالذيول (Springs & Upthrusts) وتجاوز مناطق وقف الخسارة قبل انعكاس السعر، مع فحص مستويات SOS/SOW لتنفيذ صفقات آمنة ونسبة عائد لمخاطرة RRR مرتفعة جداً.";
        if (v === 'V14') return "☁️ **V14 Adaptive Renko Cloud Sniper:** محرك الرينكو السحابي التكيفي. يولد طوبات رينكو ديناميكية بناءً على ATR اليومي، ويقيد الدخول بنطاق سحابة إيشيموكو مع فلتر مكافحة اندفاع السعر (Anti-FOMO) ومعامل كفاءة كوفمان (Kaufman ER >= 0.60) لضمان متانة وجدارة الاتجاه.";
        if (v === 'V15') return "🌌 **V15 Quant Harmonic & Chan Pen Sniper:** المحرك الهجين الكمي الأقوى. يجمع بين نظرية تشان (Chan Theory) للكشف عن هياكل الأقلام (Pen) والتوازن المركزي (Central Hub)، مع قنص نموذج الخفاش التوافقي (Harmonic Bat Pattern) عند منطقة الارتداد المحتملة (PRZ) بنسبة تصحيح 88.6%، مؤكداً بـ RSI Divergence للزخم ومؤشر الدولار الكلي DXY.";
        if (v === 'V11') return "🏆 **V11 Adaptive Decision & Regime Sniper:** المحرك الأحدث والأكثر ذكاءً. يدمج مصفوفة المتوسطات التكيفية (KAMA) لفرز بيئة السوق وحالة الاتجاه بدقة متناهية، مع التبديل التلقائي (Rule-Based Switching) لتشغيل SMC في السوق الاتجاهي أو تفعيل مؤشرات الزخم والبولنجر في السوق العرضي. كما يحتوي على مصنف أنماط ذكي (Regime Classifier) للتعرف على موجات إليوت الثالثة وسحب السيولة بالذيول (Liquidity Run)، مع قنص متناهي الدقة عند تقاطع كتل الأوامر (OB) وفجوات القيمة العادلة (FVG) ومنطقة الخصم العميق للفيبوناتشي الذكي (Discount Zone: 0.618 - 0.786).";
        if (v === 'V10') return "🎯 **V10 Hybrid SMC & Statistical Sniper:** المحرك العشاري الأكثر واقعية وتطوراً. يدمج مفاهيم المال الذكي (SMC: OB + FVG) مع مستويات السيولة العميقة (Volume Profile/POC)، وفلترة الضوضاء السعرية بالكامل عبر شموع Heikin-Ashi لتأكيد كسر الهيكل الحقيقي (MSS)، ومقاطعة ذلك مع الاتجاه العام لمؤشر SuperTrend والتوقعات الإحصائية للانحدار الخطي (Linear Regression) لضمان دقة لا تقل عن 80%.";
        if (v === 'V9') return "🏛️ **V9 SMC Smart Order Block & FVG Sniper:** محرك قنص كتل الأوامر الذكية وفجوات السيولة. يقوم بتحليل هيكل السوق الكلي (BOS/CHOCH) على فريمات متعددة، وتحديد مناطق الاهتمام الدقيقة (Order Blocks & Fair Value Gaps)، مع تأكيدات إضافية للحجم والمصفوفة والـ RSI.";
        if (v === 'V8') return "🌊 **V8 Wave & Liquidity Sweep Sniper:** محرك قنص الموجات والسيولة. يركز على تتبع الاتجاهات الموجية الفعالة باستخدام EMA50/200، مع تحديد مناطق كشط السيولة (Liquidity Sweeps) وقيعان/قمم الذيول، وتأكيد الدخول عبر زخم مؤشر Stoch RSI وتأكيد الحجم (Volume Spike).";
        if (v === 'V7') return "🎯 **V7 Hybrid Sniper:** المحرك الأعلى دقة. معمارية ثلاثية الطبقات: Macro (تحيز يومي عبر SMA50/200) → Meso (POI: كتل أوامر SMC + فيبوناتشي 0.618-0.886) → Micro (زناد: RSI Divergence + كسر هيكل MSS). لا تُصدر إشارة دون ثقة ≥80%.";
        if (v === 'V6') return "🎯 **V6 Sniper:** يستخدم جدار حماية زمني لفصل السكالب عن السوينج، مع فلاتر هيكل السوق (Price Action) لمنع الدخول العكسي الخاطئ وربط رادار التصحيح كصمام أمان.";
        return "📘 **نظام التداول المتعدد الاستراتيجيات:** يضم 9 محركات تحليل مختلفة لتغطية كافة ظروف السوق.";
    }
}
