import { BingXService } from '../../services/BingXService';
import { InstitutionalMarketDossier } from './EngineConfluenceArbiter';
import { MicroVolumeAnalyzer, VolumeFlowReport } from './MicroVolumeAnalyzer';
import logger from '../../utils/logger';

export interface StalkingCandidate {
    symbol: string;         // e.g. NEAR
    fullSymbol: string;     // e.g. NEAR-USDT
    direction: 'LONG' | 'SHORT';
    targetEntry: number;
    targetZone: { min: number; max: number };
    tp: number;
    sl: number;
    confluenceScore: number;
    dossier: InstitutionalMarketDossier;
    createdAt: number;
    expiresAt: number;
    status: 'STALKING' | 'TRIGGERED' | 'EXPIRED' | 'CANCELLED';
    lastCheckedPrice?: number;
    lastCheckedTime?: number;
    lastFlowReport?: VolumeFlowReport;
}

export class OpportunityStalker {
    private candidates: Map<string, StalkingCandidate> = new Map();

    /**
     * Adds or updates a candidate in the stalking queue.
     */
    addCandidate(
        candidateData: {
            symbol: string;
            fullSymbol: string;
            direction: 'LONG' | 'SHORT';
            targetEntry: number;
            targetZone: { min: number; max: number };
            tp: number;
            sl: number;
            confluenceScore: number;
            dossier: InstitutionalMarketDossier;
        },
        timeoutMinutes: number = 30,
        maxCapacity: number = 3
    ): boolean {
        const cleanSym = candidateData.symbol.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '');
        const now = Date.now();

        // 1. Clean up expired candidates first
        this.cleanupExpired();

        // 2. Check capacity
        if (!this.candidates.has(cleanSym) && this.candidates.size >= maxCapacity) {
            // Find lowest score candidate to see if we should replace it
            let lowestScore = 999;
            let lowestKey = '';
            for (const [key, item] of this.candidates.entries()) {
                if (item.confluenceScore < lowestScore) {
                    lowestScore = item.confluenceScore;
                    lowestKey = key;
                }
            }
            if (candidateData.confluenceScore > lowestScore && lowestKey) {
                logger.info(`[OpportunityStalker] Replacing lower-score candidate ${lowestKey} (${lowestScore}%) with ${cleanSym} (${candidateData.confluenceScore}%)`);
                this.candidates.delete(lowestKey);
            } else {
                logger.info(`[OpportunityStalker] Stalking queue full (${maxCapacity}), skipping ${cleanSym}`);
                return false;
            }
        }

        const candidate: StalkingCandidate = {
            ...candidateData,
            symbol: cleanSym,
            createdAt: now,
            expiresAt: now + (timeoutMinutes * 60 * 1000),
            status: 'STALKING'
        };

        this.candidates.set(cleanSym, candidate);
        logger.info(`🎯 [OpportunityStalker] Added ${cleanSym} (${candidate.direction}) to stalking queue! Target: ${candidate.targetEntry}, Timeout: ${timeoutMinutes}m`);
        return true;
    }

    /**
     * Removes a candidate from the stalking queue
     */
    removeCandidate(symbol: string): void {
        const cleanSym = symbol.toUpperCase().replace('/USDT:USDT', '').replace('-USDT', '').replace('/USDT', '');
        this.candidates.delete(cleanSym);
    }

    /**
     * Clears all candidates
     */
    clear(): void {
        this.candidates.clear();
    }

    /**
     * Returns all active stalking candidates
     */
    getActiveCandidates(): StalkingCandidate[] {
        this.cleanupExpired();
        return Array.from(this.candidates.values()).filter(c => c.status === 'STALKING');
    }

    /**
     * Cleans up expired stalking opportunities
     */
    private cleanupExpired(): void {
        const now = Date.now();
        for (const [key, item] of this.candidates.entries()) {
            if (item.expiresAt <= now || item.status === 'EXPIRED') {
                logger.info(`⌛ [OpportunityStalker] Stalking timed out for ${key} after ${((now - item.createdAt) / 60000).toFixed(1)} mins`);
                this.candidates.delete(key);
            }
        }
    }

    /**
     * Evaluates a single candidate tick against current market price and 1m volume burst
     */
    async checkCandidateTick(
        bingx: BingXService,
        candidate: StalkingCandidate,
        volumeBurstThreshold: number = 2.0,
        minBuyVolumeRatio: number = 65
    ): Promise<{
        shouldExecute: boolean;
        currentPrice: number;
        reason: string;
        flowReport?: VolumeFlowReport;
    }> {
        const now = Date.now();
        if (now > candidate.expiresAt) {
            candidate.status = 'EXPIRED';
            return { shouldExecute: false, currentPrice: 0, reason: 'انتهت مدة التربص' };
        }

        try {
            // 1. Get live price
            const currentPrice = (await bingx.getMarketPrice(candidate.fullSymbol)) || candidate.targetEntry;
            candidate.lastCheckedPrice = currentPrice;
            candidate.lastCheckedTime = now;

            // 2. Check if price is within strike zone (distance <= 0.6% from target entry / zone)
            const zoneMin = Math.min(candidate.targetZone.min, candidate.targetEntry);
            const zoneMax = Math.max(candidate.targetZone.max, candidate.targetEntry);
            const tolerance = candidate.targetEntry * 0.006; // 0.6% tolerance

            const isInZone = (currentPrice >= (zoneMin - tolerance)) && (currentPrice <= (zoneMax + tolerance));

            if (!isInZone) {
                const distancePct = Math.abs(currentPrice - candidate.targetEntry) / candidate.targetEntry * 100;
                return {
                    shouldExecute: false,
                    currentPrice,
                    reason: `السعر (${currentPrice}) يبعد بنسبة ${distancePct.toFixed(2)}% عن منطقة الدخول (${candidate.targetEntry})`
                };
            }

            // 3. Price is in zone! Now verify 1-minute volume flow burst
            const flowReport = await MicroVolumeAnalyzer.analyze1mVolumeFlow(
                bingx,
                candidate.fullSymbol,
                candidate.direction,
                minBuyVolumeRatio,
                volumeBurstThreshold
            );

            candidate.lastFlowReport = flowReport;

            if (flowReport.isReady) {
                candidate.status = 'TRIGGERED';
                return {
                    shouldExecute: true,
                    currentPrice,
                    reason: `🎯 إشارة إطلاق قناص التربص: ${flowReport.reason}`,
                    flowReport
                };
            }

            return {
                shouldExecute: false,
                currentPrice,
                reason: flowReport.reason,
                flowReport
            };
        } catch (error: any) {
            return {
                shouldExecute: false,
                currentPrice: 0,
                reason: `خطأ أثناء فحص التربص: ${error.message}`
            };
        }
    }
}
