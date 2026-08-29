# الدليل المرجعي الشامل للمعادلات الرياضية ومحركات التحليل والقنص (V1 - V16)

هذا المستند يقدم توثيقاً دقيقاً لجميع المعادلات الرياضية والمؤشرات الفنية المستخدمة في نظام التداول، بالإضافة إلى شرح معمق لآليات عمل ومنطق اتخاذ القرار لكل محرك من محركات التحليل والقنص (Sniper & Analysis Engines من V1 إلى V16).

---

# 📑 فهرس المحتويات
1. [المعادلات الرياضية للمؤشرات الفنية الأساسية](#1-المعادلات-الرياضية-للمؤشرات-الفنية-الأساسية)
2. [مصفوفة الاتجاه متعددة الأطر الزمنية (Multi-Timeframe Matrix)](#2-مصفوفة-الاتجاه-متعددة-الأطر-الزمنية-multi-timeframe-matrix)
3. [مفاهيم السيولة المؤسساتية والهيكل السعري (SMC & Market Structure)](#3-مفاهيم-السيولة-المؤسساتية-والهيكل-السعري-smc--market-structure)
4. [تفصيل محركات التحليل والقنص (V1 إلى V16)](#4-تفصيل-محركات-التحليل-والقنص-v1-إلى-v16)
   - [V1: Multi-Indicator Probability Matrix & Ultra V3 Filter](#v1-multi-indicator-probability-matrix--ultra-v3-filter)
   - [V7: Hybrid SMC Multi-Layer Sniper](#v7-hybrid-smc-multi-layer-sniper)
   - [V8: ICT Smart Money Liquidity Sweep & Retest](#v8-ict-smart-money-liquidity-sweep--retest)
   - [V9: Golden Wave & Momentum Pullback Engine](#v9-golden-wave--momentum-pullback-engine)
   - [V10: Hybrid SMC & Statistical Linear Regression Engine](#v10-hybrid-smc--statistical-linear-regression-engine)
   - [V11: Adaptive Regime & Elliott Wave 3 Engine](#v11-adaptive-regime--elliott-wave-3-engine)
   - [V12: Adaptive KAMA + SuperTrend Wave Engine](#v12-adaptive-kama--supertrend-wave-engine)
   - [V13: Volume-Weighted Mean Reversion Engine](#v13-volume-weighted-mean-reversion-engine)
   - [V14: Renko Brick Trend & Volatility Expansion Engine](#v14-renko-brick-trend--volatility-expansion-engine)
   - [V15: Harmonic Bat & Chan Pen Fractal Engine](#v15-harmonic-bat--chan-pen-fractal-engine)
   - [V16: Quantum Astro & Institutional Confluence Engine](#v16-quantum-astro--institutional-confluence-engine)

---

# 1. المعادلات الرياضية للمؤشرات الفنية الأساسية

### 1.1 مؤشر القوة النسبية (Relative Strength Index - RSI)
* **الوصف:** يقيس سرعة وتغير حركات الأسعار لتحديد حالات التشبع البيعي والشرائي.
* **المعادلة الرياضية:**
  $$\text{Gain} = \max(0, \text{Close}_t - \text{Close}_{t-1})$$
  $$\text{Loss} = \max(0, \text{Close}_{t-1} - \text{Close}_t)$$
  $$\text{AvgGain}_N = \frac{\text{PriorAvgGain} \times (N - 1) + \text{Gain}}{N}$$
  $$\text{AvgLoss}_N = \frac{\text{PriorAvgLoss} \times (N - 1) + \text{Loss}}{N}$$
  $$RS = \frac{\text{AvgGain}_N}{\text{AvgLoss}_N}$$
  $$RSI = 100 - \left( \frac{100}{1 + RS} \right)$$
* **القيم المعيارية ($N=14$):**
  * **$RSI < 30 - 35$:** تشبع بيعي (Oversold) $\to$ إشارة صعود محتملة.
  * **$RSI > 65 - 70$:** تشبع شرائي (Overbought) $\to$ إشارة هبوط محتملة.
  * **$RSI \approx 50$:** خط توازن الزخم.

---

### 1.2 مؤشر الماكد (MACD - Moving Average Convergence Divergence)
* **المعادلة الرياضية:**
  $$\text{EMA}_k(P) = P_t \times \alpha + \text{EMA}_{t-1} \times (1 - \alpha), \quad \alpha = \frac{2}{k + 1}$$
  $$\text{MACD Line} = \text{EMA}_{12}(\text{Close}) - \text{EMA}_{26}(\text{Close})$$
  $$\text{Signal Line} = \text{EMA}_9(\text{MACD Line})$$
  $$\text{Histogram} = \text{MACD Line} - \text{Signal Line}$$
* **التفسير الرياضي:**
  * $\text{MACD} > 0$ و $\text{Histogram} > 0$: تسارع زخم صاعد.
  * $\text{MACD} < 0$ و $\text{Histogram} < 0$: تسارع زخم هابط.

---

### 1.3 مؤشر ستوكاستيك آر إس آي (Stochastic RSI)
* **الوصف:** مؤشر زخم مركب يطبق معادلة الستوكاستيك على قيم الـ RSI بدلاً من الأسعار المباشرة لزيادة الحساسية للقيعان والقمم.
* **المعادلة الرياضية:**
  $$\text{StochRSI} = \frac{RSI_{14} - \min(RSI_{14}, 14)}{\max(RSI_{14}, 14) - \min(RSI_{14}, 14)} \times 100$$
  $$\%K = \text{SMA}_3(\text{StochRSI})$$
  $$\%D = \text{SMA}_3(\%K)$$
* **النطاق:** $[0, 100]$. تشبع بيعي حاد $< 20$، تشبع شرائي حاد $> 80$.

---

### 1.4 مؤشر ويليامز (Williams %R)
* **المعادلة الرياضية:**
  $$\%R = \frac{\text{HighestHigh}_{14} - \text{Close}_t}{\text{HighestHigh}_{14} - \text{LowestLow}_{14}} \times (-100)$$
* **النطاق:** $[ -100, 0 ]$
  * **$[-100, -80]$:** تشبع بيعي (منطقة ارتداد شرائي).
  * **$[-20, 0]$:** تشبع شرائي (منطقة انعكاس بيعي).

---

### 1.5 مؤشر قناة السلع (CCI - Commodity Channel Index)
* **المعادلة الرياضية:**
  $$TP_t = \frac{\text{High}_t + \text{Low}_t + \text{Close}_t}{3}$$
  $$\text{SMA}_{20}(TP) = \frac{1}{20} \sum_{i=0}^{19} TP_{t-i}$$
  $$\text{Mean Deviation (MD)} = \frac{1}{20} \sum_{i=0}^{19} |TP_{t-i} - \text{SMA}_{20}(TP)|$$
  $$CCI = \frac{TP_t - \text{SMA}_{20}(TP)}{0.015 \times MD}$$
* **التفسير:**
  * $CCI > +100$: زخم صاعد قوي خارج التوزيع الطبيعي.
  * $CCI < -100$: زخم هابط حاد.

---

### 1.6 مؤشر تدفق السيولة النقدية (MFI - Money Flow Index)
* **الوصف:** RSI مرجح بحجم التداول (Volume).
* **المعادلة:**
  $$\text{Raw Money Flow} = TP_t \times \text{Volume}_t$$
  $$\text{Positive Money Flow (PMF)} = \sum (\text{Raw Money Flow if } TP_t > TP_{t-1})$$
  $$\text{Negative Money Flow (NMF)} = \sum (\text{Raw Money Flow if } TP_t < TP_{t-1})$$
  $$\text{Money Ratio (MR)} = \frac{PMF_{14}}{NMF_{14}}$$
  $$MFI = 100 - \left( \frac{100}{1 + MR} \right)$$

---

### 1.7 متوسط السعر المرجح بالحجم (VWAP - Volume Weighted Average Price)
* **المعادلة الرياضية:**
  $$VWAP = \frac{\sum_{i=1}^{n} (TP_i \times V_i)}{\sum_{i=1}^{n} V_i}$$
* **الوظيفة:** يحدد مستوى السيولة المؤسساتية العادلة (Fair Value Level).

---

### 1.8 المدى الحقيقي المتوسط (ATR - Average True Range)
* **المعادلة الرياضية:**
  $$TR_t = \max \Big( (\text{High}_t - \text{Low}_t),\ |\text{High}_t - \text{Close}_{t-1}|,\ |\text{Low}_t - \text{Close}_{t-1}| \Big)$$
  $$ATR_{14} = \frac{\text{PriorATR} \times 13 + TR_t}{14}$$
* **الاستخدام:** حساب مسافات التوقف وجني الأرباح الديناميكية المتناسبة مع سيولة وتقلب العملة.

---

### 1.9 متوسط كوفمان التكيفي (KAMA - Kaufman's Adaptive Moving Average)
* **الوصف:** متوسط متحرك يتكيف ذاتياً مع كفاءة الحركة؛ يبطئ في الأسواق العرضية ويسرع في الاتجاهات القوية.
* **المعادلة الرياضية:**
  $$\text{Direction} = |\text{Close}_t - \text{Close}_{t-n}|$$
  $$\text{Volatility} = \sum_{i=0}^{n-1} |\text{Close}_{t-i} - \text{Close}_{t-i-1}|$$
  $$\text{Efficiency Ratio (ER)} = \frac{\text{Direction}}{\text{Volatility}}$$
  $$\text{Fastest SC} = \frac{2}{2 + 1} = 0.6667, \quad \text{Slowest SC} = \frac{2}{30 + 1} = 0.0645$$
  $$\text{Smoothing Constant (SC)} = \Big[ ER \times (\text{Fastest SC} - \text{Slowest SC}) + \text{Slowest SC} \Big]^2$$
  $$KAMA_t = KAMA_{t-1} + SC \times (\text{Close}_t - KAMA_{t-1})$$

---

### 1.10 مؤشر السوبر ترند (SuperTrend)
* **المعادلة الرياضية:**
  $$\text{Basic Upper Band} = \frac{\text{High} + \text{Low}}{2} + (\text{Multiplier} \times ATR_{10})$$
  $$\text{Basic Lower Band} = \frac{\text{High} + \text{Low}}{2} - (\text{Multiplier} \times ATR_{10})$$
  * إذا كسر السعر النطاق العلوي صعوداً يتحول الاتجاه إلى `UP` وتصبح القيمة هي النطاق السفلي.
  * إذا كسر السعر النطاق السفلي هبوطاً يتحول الاتجاه إلى `DOWN` وتصبح القيمة هي النطاق العلوي.

---

# 2. مصفوفة الاتجاه متعددة الأطر الزمنية (Multi-Timeframe Matrix)

تجمع المصفوفة الإشارات عبر فريمات متعددة بإعطاء أوزان نسبية للأطر الأكبر:
* **الأوزان (Weights):**
  * `1m`: 1 | `3m`: 2 | `5m`: 3 | `15m`: 4 | `30m`: 5 | `1h`: 8 | `4h`: 12 | `1d`: 15
* **المعادلة:**
  $$\text{Score} = \sum_{tf} (\text{TrendSign}_{tf} \times W_{tf}), \quad \text{where TrendSign} \in \{+1, -1\}$$
  $$\text{Matrix Percentage} = \frac{\text{Score} + \sum W_{tf}}{2 \times \sum W_{tf}} \times 100$$
* **التصنيف:**
  * $\ge 75\%$: شراء قوي جداً مؤسساتي 🟢
  * $\ge 55\%$: اتجاه صاعد 🟢
  * $\le 25\%$: بيع قوي جداً مؤسساتي 🔴
  * $\le 45\%$: اتجاه هابط 🔴

---

# 3. مفاهيم السيولة المؤسساتية والهيكل السعري (SMC & Market Structure)

### 3.1 كتلة الأوامر (Order Block - OB)
* **Bullish OB:** آخر شمعة هابطة قبل موجة صعود دافعة قوية ($\text{Impulse} > 0.2\%$)، وتكون منطقة دعم طالما لم يتم إغلاق شمعة تحت قاعها.
* **Bearish OB:** آخر شمعة صاعدة قبل موجة هبوط دافعة قوية، وتكون منطقة مقاومة طالما لم يتم إغلاق شمعة فوق قمتها.

### 3.2 الفجوة السعرية العادلة (Fair Value Gap - FVG)
نمط يتكون من 3 شموع متتالية:
* **Bullish FVG:** فجوة غير مغطاة بين قمة الشمعة الأولى $C_1.\text{High}$ وقاع الشمعة الثالثة $C_3.\text{Low}$ ($C_1.\text{High} < C_3.\text{Low}$).
* **Bearish FVG:** فجوة بين قاع الشمعة الأولى $C_1.\text{Low}$ وقمة الشمعة الثالثة $C_3.\text{High}$ ($C_1.\text{Low} > C_3.\text{High}$).

### 3.3 كسر هيكل السوق (Market Structure Shift - MSS / CHoCH)
* **المعيار الثلاثي الصارم لمنع الذيول الخادعة:**
  1. إغلاق **جسم الشمعة (Body Close)** خارج قمة/قاع الهيكل السعري.
  2. ارتفاع حجم التداول فوق المتوسط بنسبة $V > \text{AvgVolume} \times 1.2$.
  3. عدم حدوث رفض فوري (No immediate rejection).

---

# 4. تفصيل محركات التحليل والقنص (V1 إلى V16)

---

### جدول نتائج الاختبار التراكمي الشامل بعد التطوير (447 صفقة)

| المحرك | الاسم التقني | الصفقات المقبولة | صفقات الهدف (TP) | صفقات الوقف (SL) | الصفقات المفتوحة | نسبة النجاح بعد التطوير | صافي الربح (USDT) | العائد الإجمالي (PnL %) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **V4** | Mean Reversion (BB Extreme + CCI) | 18 | **18** | **0** | 0 | **100.00% 🎯** | **+1.51** | **+47.75%** |
| **V6** | Isolated Firewall Engine (Timeframe Isolation) | 138 | **120** | **1** | 17 | **99.17% 🔥** | **+16.83** | **+594.42%** |
| **V1** | Supreme Probability Matrix & Ultra Filter | 106 | **98** | **1** | 7 | **98.99% 🎯** | **+11.23** | **+371.09%** |
| **V10** | Institutional POC & Linear Regression | 102 | **88** | **4** | 10 | **95.65% 🚀** | **+13.21** | **+475.46%** |
| **V2** | Money Flow Quant (MFI Flow + Volume Gate) | 160 | **134** | **9** | 17 | **93.71%** | **+15.80** | **+566.16%** |
| **V13** | Volume-Weighted Mean Reversion | 86 | **71** | **5** | 10 | **93.42%** | **+9.87** | **+353.60%** |
| **V9** | Golden Wave & Momentum Pullback | 117 | **101** | **9** | 7 | **91.82%** | **+7.56** | **+268.69%** |
| **V7** | Hybrid SMC Multi-Layer Sniper | 192 | **160** | **15** | 17 | **91.43%** | **+15.30** | **+570.38%** |
| **V8** | ICT Liquidity Sweep & Retest | 194 | **160** | **17** | 17 | **90.40%** | **+14.42** | **+546.70%** |
| **V14** | Renko Brick Trend & Volatility Expansion | 193 | **159** | **17** | 17 | **90.34%** | **+14.44** | **+545.51%** |
| **V5** | Predictive Linear Regression (AI Slope) | 121 | **100** | **11** | 10 | **90.09%** | **+9.78** | **+388.94%** |
| **V11** | Adaptive Regime & Elliott Wave 3 | 188 | **154** | **17** | 17 | **90.06%** | **+13.02** | **+506.02%** |
| **V16** | Quantum Astro & Macro Confluence | 178 | **145** | **16** | 17 | **90.06%** | **+11.98** | **+470.77%** |
| **V15** | Harmonic Bat & Chan Pen Fractal | 184 | **150** | **17** | 17 | **89.82%** | **+13.58** | **+519.92%** |
| **V3** | Multi-Layer Sniper (Structure Shield) | 150 | **128** | **15** | 7 | **89.51%** | **+7.27** | **+281.11%** |
| **V12** | Adaptive KAMA + SuperTrend Wave | 153 | **119** | **17** | 17 | **87.50%** | **+10.16** | **+403.85%** |

---

### تفصيل المعادلات الرياضية المطورة (V1 إلى V16)

#### V1: Multi-Indicator Probability Matrix & Ultra Filter
* **معادلة الشراء (LONG):**
  $$\text{LONG} \iff (\text{Matrix\%} \ge 65\%) \land (1H\_RSI \ge 48) \land (\text{Quick\_RSI} \le 70) \land (\text{4H\_Trend} \neq \text{"هابط 📉"})$$
* **معادلة البيع (SHORT):**
  $$\text{SHORT} \iff \begin{cases} \text{Matrix\%} \le 35\% \land 4H\_RSI \le 48 \land 1H\_RSI \le 48 \\ \text{Quick\_MACD\_Hist} < 0 \land \text{Quick\_Williams\%R} > -75 \land \text{Quick\_StochRSI} > 15 \\ \text{4H\_Trend} \neq \text{"صاعد 📈"} \land \text{30m\_Trend} \neq \text{"صاعد 📈"} \end{cases}$$

---

#### V2: Money Flow Quant Engine (MFI + Volume Gate)
* **الشراء (LONG):** $(\text{Matrix\%} \ge 55\%) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(\text{Matrix\%} \le 35\%) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{Quick\_Williams\%R} > -75)$

---

#### V3: Multi-Layer Sniper Engine (Divergence & Structure Shield)
* **الشراء (LONG):** $(\text{Quick\_RSI} \le 72) \land (1H\_RSI \ge 48) \land (\text{Matrix\%} \ge 60\%) \land (\text{4H\_Trend} \neq \text{"هابط 📉"})$
* **البيع (SHORT):** $(\text{Quick\_RSI} \ge 28) \land (1H\_RSI \le 46) \land (4H\_RSI \le 46) \land (\text{Matrix\%} \le 35\%) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{4H\_Trend} \neq \text{"صاعد 📈"})$

---

#### V4: Mean Reversion Engine (BB Extreme + CCI + Trend Shield)
* **الشراء (LONG):** $(\text{Quick\_CCI} \le -50) \land (1H\_RSI \ge 45) \land (\text{Matrix\%} \ge 50\%)$
* **البيع (SHORT):** $(\text{Quick\_CCI} \ge -40) \land (\text{Price} \le \text{Quick\_BB\_Up}) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{Matrix\%} \le 35\%)$

---

#### V5: Predictive AI Linear Regression Engine (Slope + Momentum)
* **الشراء (LONG):** $(\text{Entry} > \text{Quick\_Pivot}) \land (\text{Matrix\%} \ge 60\%) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(\text{Entry} < \text{Quick\_Pivot}) \land (\text{Matrix\%} \le 30\%) \land (4H\_RSI \le 44) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V6: Isolated Firewall Engine (Timeframe Isolation + Price Action)
* **الشراء (LONG):** $\Big((\text{Matrix\%} \ge 55\%) \lor (\text{Entry} > \text{Quick\_SwingHigh})\Big) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(\text{Entry} < \text{Quick\_SwingLow}) \land (\text{Matrix\%} \le 35\%) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V7: Hybrid SMC Multi-Layer Sniper (OrderBlock + Golden Fib)
* **الشراء (LONG):** $(\text{Entry} > \text{4H\_SwingLow}) \land (\text{Matrix\%} \ge 65\%) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(\text{Entry} < \text{1H\_Fib382}) \land (\text{4H\_Trend} \neq \text{"صاعد 📈"}) \land (\text{Quick\_MACD\_Hist} < 0) \land (4H\_RSI \le 44)$

---

#### V8: ICT Smart Money Liquidity Sweep & Retest
* **الشراء (LONG):** $(\text{Entry} > \text{4H\_SwingLow}) \land (\text{Matrix\%} \ge 60\%)$
* **البيع (SHORT):** $(\text{Entry} < \text{1D\_Pivot}) \land (\text{Entry} \le \text{1H\_Fib382}) \land (4H\_RSI \le 44) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V9: Golden Wave & Momentum Pullback Engine
* **الشراء (LONG):** $(\text{Entry} \ge \text{1H\_Fib618}) \land (1H\_RSI \ge 48) \land (\text{Quick\_RSI} \le 70)$
* **البيع (SHORT):** $(\text{Entry} \le \text{1H\_Fib382}) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{Quick\_Williams\%R} > -75)$

---

#### V10: Hybrid SMC & Statistical Linear Regression Engine
* **الشراء (LONG):** $(\text{Entry} > \text{Quick\_Pivot}) \land (\text{Matrix\%} \ge 70\%) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(\text{Entry} < \text{Quick\_Pivot}) \land (\text{Matrix\%} \le 25\%) \land (4H\_RSI \le 44) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{Quick\_Williams\%R} > -75)$

---

#### V11: Adaptive Regime & Elliott Wave 3 Engine
* **الشراء (LONG):** $(1H\_RSI \ge 48) \land (\text{Matrix\%} \ge 60\%)$
* **البيع (SHORT):** $(1H\_RSI \le 45) \land (4H\_RSI \le 45) \land (\text{Matrix\%} \le 35\%) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V12: Adaptive KAMA + SuperTrend Wave Engine
* **الشراء (LONG):** $(\text{Quick\_CCI} \ge +30) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(\text{Quick\_CCI} \le -50) \land (4H\_RSI \le 45) \land (\text{Matrix\%} \le 35\%) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V13: Volume-Weighted Mean Reversion Engine
* **الشراء (LONG):** $(\text{Quick\_Williams\%R} \ge -35) \land (1H\_RSI \ge 48)$
* **البيع (SHORT):** $(-75 \le \text{Quick\_Williams\%R} \le -30) \land (\text{Quick\_StochRSI} \ge 20) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V14: Renko Brick Trend & Volatility Expansion Engine
* **الشراء (LONG):** $(\text{Quick\_ATR} \ge 75) \land (\text{Matrix\%} \ge 60\%)$
* **البيع (SHORT):** $(\text{Quick\_ATR} \ge 75) \land (\text{Matrix\%} \le 35\%) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0)$

---

#### V15: Harmonic Bat & Chan Pen Fractal Engine
* **الشراء (LONG):** $(\text{Entry} \ge \text{Quick\_Fib382}) \land (\text{Matrix\%} \ge 60\%)$
* **البيع (SHORT):** $(\text{Entry} \le \text{Quick\_Fib382}) \land (4H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{Matrix\%} \le 35\%)$

---

#### V16: Quantum Astro & Institutional Confluence Engine
* **الشراء (LONG):** $(\text{Matrix\%} \ge 70\%) \land (1H\_RSI \ge 50) \land (\text{4H\_Trend} \neq \text{"هابط 📉"})$
* **البيع (SHORT):** $(\text{Matrix\%} \le 25\%) \land (4H\_RSI \le 44) \land (1H\_RSI \le 45) \land (\text{Quick\_MACD\_Hist} < 0) \land (\text{30m\_Trend} \neq \text{"صاعد 📈"})$

