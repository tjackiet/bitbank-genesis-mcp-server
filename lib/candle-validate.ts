/**
 * lib/candle-validate.ts — ローソク足データの品質検証ロジック
 *
 * Vol.01（データ取得とクレンジング）のバリデーション手法をベースに、
 * OHLCV データの完全性・整合性・異常値を検出する純粋関数群。
 *
 * 【暗号資産ドメイン考慮】
 * - ファットテール分布: σ閾値は株式より広め（Vol.01 の教え）
 * - 出来高ゼロ: 「取引がなかった」= 正常（Vol.01 の補完戦略: 0埋め）
 * - ペアティア: major/mid/minor で流動性・スプレッドが大きく異なる
 *
 * 【共通仕様】
 * - 入力: CandleRow[]（古い順、isoTime 付き）
 * - 出力: 各検証結果オブジェクト
 * - 副作用なし
 */

import { dayjs } from './datetime.js';
import { avg, stddev } from './math.js';

/** 検証対象のローソク足行 */
export interface CandleRow {
	open: number;
	high: number;
	low: number;
	close: number;
	volume?: number;
	isoTime?: string | null;
}

// ── ペアティア分類 ──
// 参考: bitbank-cli-skills pair-classification.md
// 24h出来高シェア（JPY建て売買代金割合）に基づく分類

export type PairTier = 'major' | 'mid' | 'minor';

const MAJOR_PAIRS = new Set(['btc_jpy', 'xrp_jpy', 'eth_jpy']);

const MID_PAIRS = new Set([
	'doge_jpy',
	'sol_jpy',
	'ltc_jpy',
	'ada_jpy',
	'avax_jpy',
	'dot_jpy',
	'bnb_jpy',
	'sui_jpy',
	'link_jpy',
]);

/**
 * ペア名からティアを判定する。
 * major: 出来高シェア10%以上（板が厚く、スプレッド狭い）
 * mid:   出来高シェア1-10%（深夜帯は板が薄くなることがある）
 * minor: 出来高シェア1%未満（出来高ゼロが散発、スプレッド広い、ヒゲが出やすい）
 */
export function classifyPairTier(pair: string): PairTier {
	const normalized = pair.toLowerCase();
	if (MAJOR_PAIRS.has(normalized)) return 'major';
	if (MID_PAIRS.has(normalized)) return 'mid';
	return 'minor';
}

/**
 * ティアに応じたデフォルト閾値を返す。
 *
 * Vol.01 の教え:
 * - 暗号資産はファットテール → σ閾値は広めが妥当
 * - 出来高ゼロ = 取引がなかった（正常）
 *
 * ペア分類の教え:
 * - minor は出来高ゼロが日常的、スプレッド由来のヒゲも頻出
 * - major は板が厚く、異常値はより信号として意味がある
 */
export interface TierDefaults {
	priceSigma: number;
	volumeMultiplier: number;
	/** 出来高ゼロを品質スコアで減点する重み (0=減点なし, 1=フル減点) */
	zeroVolumePenaltyWeight: number;
}

export function getTierDefaults(tier: PairTier): TierDefaults {
	switch (tier) {
		case 'major':
			return { priceSigma: 4, volumeMultiplier: 15, zeroVolumePenaltyWeight: 1 };
		case 'mid':
			return { priceSigma: 4, volumeMultiplier: 25, zeroVolumePenaltyWeight: 0.5 };
		case 'minor':
			return { priceSigma: 5, volumeMultiplier: 50, zeroVolumePenaltyWeight: 0 };
	}
}

// ── 時間足ごとのインターバル（ミリ秒） ──

const INTERVAL_MS: Record<string, number> = {
	'1min': 60_000,
	'5min': 300_000,
	'15min': 900_000,
	'30min': 1_800_000,
	'1hour': 3_600_000,
	'4hour': 14_400_000,
	'8hour': 28_800_000,
	'12hour': 43_200_000,
	'1day': 86_400_000,
};

// ── 1. 完全性チェック ──

export interface CompletenessResult {
	expected: number;
	actual: number;
	missing: number;
	missingTimestamps: string[];
	ratio: number; // 0–1
}

/**
 * タイムスタンプの歯抜けを検出する。
 * Vol.01 の「expected_index との差分」パターン。
 *
 * 1week / 1month は間隔が不規則なのでスキップ（ratio: 1 を返す）。
 */
export function checkCompleteness(candles: CandleRow[], candleType: string): CompletenessResult {
	const intervalMs = INTERVAL_MS[candleType];

	// 不規則間隔の時間足はスキップ
	if (!intervalMs || candles.length < 2) {
		return { expected: candles.length, actual: candles.length, missing: 0, missingTimestamps: [], ratio: 1 };
	}

	const timestamps = candles.map((c) => (c.isoTime ? dayjs(c.isoTime).valueOf() : NaN)).filter((t) => !Number.isNaN(t));
	const uniqueTimestamps = [...new Set(timestamps)];

	if (uniqueTimestamps.length < 2) {
		return { expected: candles.length, actual: candles.length, missing: 0, missingTimestamps: [], ratio: 1 };
	}

	const first = uniqueTimestamps[0];
	const last = uniqueTimestamps[uniqueTimestamps.length - 1];
	const expected = Math.floor((last - first) / intervalMs) + 1;
	const tsSet = new Set(uniqueTimestamps);

	const missingTimestamps: string[] = [];
	for (let t = first; t <= last; t += intervalMs) {
		if (!tsSet.has(t)) {
			missingTimestamps.push(dayjs(t).toISOString());
		}
	}

	return {
		expected,
		actual: uniqueTimestamps.length,
		missing: missingTimestamps.length,
		missingTimestamps: missingTimestamps.slice(0, 50), // 上限50件
		ratio: expected > 0 ? Math.min(uniqueTimestamps.length / expected, 1) : 1,
	};
}

// ── 2. 重複チェック ──

export interface DuplicatesResult {
	count: number;
	timestamps: string[];
}

export function checkDuplicates(candles: CandleRow[]): DuplicatesResult {
	const seen = new Set<string>();
	const duplicates: string[] = [];

	for (const c of candles) {
		const key = c.isoTime ?? '';
		if (!key) continue;
		if (seen.has(key)) {
			duplicates.push(key);
		} else {
			seen.add(key);
		}
	}

	return { count: duplicates.length, timestamps: duplicates.slice(0, 50) };
}

// ── 3. OHLCV 整合性チェック ──

export interface IntegrityIssue {
	index: number;
	isoTime: string | null;
	issues: string[];
}

export interface IntegrityResult {
	totalChecked: number;
	invalidCount: number;
	issues: IntegrityIssue[];
}

/**
 * OHLCV の論理整合性を検証。
 * - high >= low
 * - high >= max(open, close)
 * - low <= min(open, close)
 * - volume >= 0
 */
export function checkIntegrity(candles: CandleRow[]): IntegrityResult {
	const issues: IntegrityIssue[] = [];

	for (let i = 0; i < candles.length; i++) {
		const c = candles[i];
		const rowIssues: string[] = [];

		if (c.high < c.low) {
			rowIssues.push(`high(${c.high}) < low(${c.low})`);
		}
		if (c.high < Math.max(c.open, c.close)) {
			rowIssues.push(`high(${c.high}) < max(open,close)(${Math.max(c.open, c.close)})`);
		}
		if (c.low > Math.min(c.open, c.close)) {
			rowIssues.push(`low(${c.low}) > min(open,close)(${Math.min(c.open, c.close)})`);
		}
		if (c.volume != null && c.volume < 0) {
			rowIssues.push(`volume(${c.volume}) < 0`);
		}

		if (rowIssues.length > 0) {
			issues.push({ index: i, isoTime: c.isoTime ?? null, issues: rowIssues });
		}
	}

	return {
		totalChecked: candles.length,
		invalidCount: issues.length,
		issues: issues.slice(0, 50),
	};
}

// ── 4. 価格異常値検出 ──

export interface PriceAnomaly {
	index: number;
	isoTime: string | null;
	returnPct: number;
	sigma: number;
}

export interface PriceAnomalyResult {
	totalBars: number;
	anomalyCount: number;
	anomalies: PriceAnomaly[];
	stats: { mean: number; stddev: number; threshold: number } | null;
}

/**
 * 前足比の変化率（pct_change）が ±N σ を超えるバーを検出。
 * Vol.01 の `ret.describe()` + 外れ値検出パターン。
 */
export function checkPriceAnomalies(candles: CandleRow[], sigmaThreshold: number): PriceAnomalyResult {
	if (candles.length < 3) {
		return { totalBars: candles.length, anomalyCount: 0, anomalies: [], stats: null };
	}

	// リターン（変化率）を計算
	const returns: number[] = [];
	for (let i = 1; i < candles.length; i++) {
		const prev = candles[i - 1].close;
		if (prev === 0) {
			returns.push(0);
		} else {
			returns.push((candles[i].close - prev) / prev);
		}
	}

	const mean = avg(returns) ?? 0;
	const sd = stddev(returns);

	if (sd === 0) {
		return {
			totalBars: candles.length,
			anomalyCount: 0,
			anomalies: [],
			stats: { mean, stddev: sd, threshold: sigmaThreshold },
		};
	}

	const anomalies: PriceAnomaly[] = [];
	for (let i = 0; i < returns.length; i++) {
		const sigma = Math.abs((returns[i] - mean) / sd);
		if (sigma >= sigmaThreshold) {
			anomalies.push({
				index: i + 1, // candles のインデックス（returns は1個ずれる）
				isoTime: candles[i + 1].isoTime ?? null,
				returnPct: Number((returns[i] * 100).toFixed(4)),
				sigma: Number(sigma.toFixed(2)),
			});
		}
	}

	return {
		totalBars: candles.length,
		anomalyCount: anomalies.length,
		anomalies: anomalies.slice(0, 50),
		stats: { mean: Number((mean * 100).toFixed(6)), stddev: Number((sd * 100).toFixed(6)), threshold: sigmaThreshold },
	};
}

// ── 5. 出来高異常値検出 ──

export interface VolumeAnomaly {
	index: number;
	isoTime: string | null;
	volume: number;
	reason: 'zero' | 'spike';
	multiplier?: number;
}

export interface VolumeAnomalyResult {
	totalBars: number;
	anomalyCount: number;
	zeroCount: number;
	spikeCount: number;
	anomalies: VolumeAnomaly[];
	stats: { avgVolume: number; threshold: number } | null;
}

/**
 * 出来高ゼロ、または移動平均の N 倍超のスパイクを検出。
 */
export function checkVolumeAnomalies(candles: CandleRow[], multiplierThreshold: number): VolumeAnomalyResult {
	const volumes = candles.map((c) => c.volume ?? 0);

	if (volumes.length === 0) {
		return { totalBars: 0, anomalyCount: 0, zeroCount: 0, spikeCount: 0, anomalies: [], stats: null };
	}

	// スパイク検出のベースラインはゼロ出来高を除外して算出
	// Vol.01: 出来高ゼロ = 「取引がなかった」なのでベースラインに含めるべきではない
	const nonZeroVolumes = volumes.filter((v) => v > 0);
	const avgVol = avg(nonZeroVolumes) ?? 0;
	const anomalies: VolumeAnomaly[] = [];
	let zeroCount = 0;
	let spikeCount = 0;

	for (let i = 0; i < candles.length; i++) {
		const vol = volumes[i];

		if (vol === 0) {
			zeroCount++;
			anomalies.push({ index: i, isoTime: candles[i].isoTime ?? null, volume: vol, reason: 'zero' });
		} else if (avgVol > 0 && vol > avgVol * multiplierThreshold) {
			spikeCount++;
			anomalies.push({
				index: i,
				isoTime: candles[i].isoTime ?? null,
				volume: vol,
				reason: 'spike',
				multiplier: Number((vol / avgVol).toFixed(2)),
			});
		}
	}

	return {
		totalBars: candles.length,
		anomalyCount: anomalies.length,
		zeroCount,
		spikeCount,
		anomalies: anomalies.slice(0, 50),
		stats: { avgVolume: Number(avgVol.toFixed(6)), threshold: multiplierThreshold },
	};
}

// ── 6. 総合品質スコア ──

export interface QualityScore {
	score: number; // 0–100
	breakdown: {
		completeness: number; // 0–30
		integrity: number; // 0–25
		priceStability: number; // 0–25
		volumeHealth: number; // 0–20
	};
	grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

/**
 * 各チェック結果を総合して 0–100 の品質スコアを算出。
 *
 * @param zeroVolumePenaltyWeight 出来高ゼロの減点重み (0–1)。
 *   Vol.01: 出来高ゼロ = 「取引がなかった」= 正常な解釈。
 *   minor ペアでは日常的に発生するため 0（減点なし）、
 *   major ペアでは異常の可能性があるため 1（フル減点）。
 */
export function computeQualityScore(
	completeness: CompletenessResult,
	integrity: IntegrityResult,
	priceAnomalies: PriceAnomalyResult,
	volumeAnomalies: VolumeAnomalyResult,
	zeroVolumePenaltyWeight = 1,
): QualityScore {
	// 完全性（30点）: 欠損率に応じて減点
	const completenessScore = Math.round(completeness.ratio * 30);

	// 整合性（25点）: 不正レコード率に応じて減点
	const integrityRatio = integrity.totalChecked > 0 ? 1 - integrity.invalidCount / integrity.totalChecked : 1;
	const integrityScore = Math.round(integrityRatio * 25);

	// 価格安定性（25点）: 異常値率に応じて減点
	const priceRatio =
		priceAnomalies.totalBars > 1 ? 1 - Math.min(priceAnomalies.anomalyCount / (priceAnomalies.totalBars - 1), 1) : 1;
	const priceScore = Math.round(priceRatio * 25);

	// 出来高健全性（20点）: ゼロ率（重み付き）とスパイク率で減点
	const zeroRatio = volumeAnomalies.totalBars > 0 ? volumeAnomalies.zeroCount / volumeAnomalies.totalBars : 0;
	const spikeRatio = volumeAnomalies.totalBars > 0 ? volumeAnomalies.spikeCount / volumeAnomalies.totalBars : 0;
	const volumeScore = Math.round((1 - Math.min(zeroRatio * zeroVolumePenaltyWeight + spikeRatio, 1)) * 20);

	const score = completenessScore + integrityScore + priceScore + volumeScore;

	let grade: QualityScore['grade'];
	if (score >= 90) grade = 'A';
	else if (score >= 75) grade = 'B';
	else if (score >= 60) grade = 'C';
	else if (score >= 40) grade = 'D';
	else grade = 'F';

	return {
		score,
		breakdown: {
			completeness: completenessScore,
			integrity: integrityScore,
			priceStability: priceScore,
			volumeHealth: volumeScore,
		},
		grade,
	};
}
