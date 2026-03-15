/**
 * patterns/index.ts - パターン検出モジュールの再エクスポート
 */

// config
export {
	getConvergenceFactorForTf,
	getDefaultParamsForTf,
	getDefaultToleranceForTf,
	getMinFitForTf,
	getTriangleCoeffForTf,
	getTriangleWindowSize,
	MIN_CONFIDENCE,
	resolveParams,
	SCHEMA_DEFAULTS,
} from './config.js';
// regression
export {
	clamp01,
	type LinearRegressionResult,
	type LinearRegressionWithR2Result,
	linearRegression,
	linearRegressionWithR2,
	marginFromRelDev,
	near,
	pct,
	type RegressionPoint,
	relDev,
	trendlineFit,
	type XYPoint,
} from './regression.js';
// swing
export {
	type Candle,
	type DetectSwingePointsOptions,
	detectSwingPoints,
	filterPeaks,
	filterValleys,
	type Pivot,
} from './swing.js';
