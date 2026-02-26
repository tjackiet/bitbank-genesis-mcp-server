import { z } from 'zod';

export const CandleTypeEnum = z.enum([
  '1min',
  '5min',
  '15min',
  '30min',
  '1hour',
  '4hour',
  '8hour',
  '12hour',
  '1day',
  '1week',
  '1month',
]);

// ── Shared base schemas ──

/** pair + fetchedAt: 全 Meta スキーマの共通ベース */
export const BaseMetaSchema = z.object({ pair: z.string(), fetchedAt: z.string() });

/** pair デフォルト入力: z.string().optional().default('btc_jpy') */
export const BasePairInputSchema = z.object({ pair: z.string().optional().default('btc_jpy') });

/** 全ツール共通のエラー分岐 */
export const FailResultSchema = z.object({
  ok: z.literal(false),
  summary: z.string(),
  data: z.object({}).passthrough(),
  meta: z.object({ errorType: z.string() }).passthrough(),
});

/** ok/fail Result union を生成するヘルパー */
export function toolResultSchema<D extends z.ZodTypeAny, M extends z.ZodTypeAny>(data: D, meta: M) {
  return z.union([
    z.object({ ok: z.literal(true), summary: z.string(), data, meta }),
    FailResultSchema,
  ]);
}

export const RenderChartSvgInputSchema = z
  .object({
    pair: z.string().optional().default('btc_jpy'),
    type: CandleTypeEnum.optional().default('1day'),
    // impl default is 60; align contract to tool behavior
    limit: z.number().int().min(5).max(365).optional().default(60),
    // main series style: candles (default) or line (close-only)
    style: z.enum(['candles', 'line', 'depth']).optional().default('candles'),
    depth: z.object({ levels: z.number().int().min(10).max(500).optional().default(200) }).optional(),
    // デフォルトは描画しない（明示時のみ描画）
    withSMA: z.array(z.number().int()).optional().default([]),
    // 既定でBBはオフ（必要時のみ指定）
    withBB: z.boolean().optional().default(false),
    // backward-compat: accept legacy values and normalize in implementation
    bbMode: z.enum(['default', 'extended', 'light', 'full']).optional().default('default'),
    withIchimoku: z.boolean().optional().default(false),
    ichimoku: z
      .object({
        // mode: default=転換線/基準線/雲, extended=+遅行スパン
        mode: z.enum(['default', 'extended']).optional().default('default'),
        // implementation optionally respects this when true
        withChikou: z.boolean().optional(),
      })
      .optional(),
    // 軽量化のため凡例は既定でオフ
    withLegend: z.boolean().optional().default(false),
    // 軽量化オプション
    svgPrecision: z.number().int().min(0).max(3).optional().default(1).describe('Coordinate rounding decimals (0-3).'),
    svgMinify: z.boolean().optional().default(true).describe('Minify SVG text by stripping whitespace where safe.'),
    simplifyTolerance: z.number().min(0).optional().default(0.5).describe('Line simplification tolerance in pixels (0 disables).'),
    viewBoxTight: z.boolean().optional().default(true).describe('Use tighter paddings to reduce empty margins.'),
    barWidthRatio: z.number().min(0.1).max(0.9).optional().describe('Width ratio of each candle body (slot fraction).'),
    yPaddingPct: z.number().min(0).max(0.2).optional().describe('Vertical padding ratio to expand y-range.'),
    // 自動保存（LLM利便性のため）
    autoSave: z.boolean().optional().default(false).describe('If true, also save SVG to /mnt/user-data/outputs and return filePath/url.'),
    // 自動保存時のファイル名（拡張子は自動で .svg を付与）
    outputPath: z.string().optional().describe('File name (without extension) under /mnt/user-data/outputs when autoSave=true.'),
    // サイズ制御（超過時は data.svg を省略し filePath のみ返却）
    maxSvgBytes: z.number().int().min(1024).optional().default(100_000).describe('If set and svg exceeds this size (bytes), omit data.svg and return filePath only.'),
    // 返却方針: true の場合は保存を最優先し、失敗時はエラーにする（inline返却にフォールバックしない）
    preferFile: z.boolean().optional().default(false).describe('If true, prefer saving SVG to file and return error on save failure (no inline fallback).'),
    // 出力フォーマット: 'svg'(デフォルト), 'base64'(Base64文字列), 'dataUri'(data:image/svg+xml;base64,...形式)
    // Claude.ai等でpresent_filesがうまく動作しない場合の回避策として使用
    outputFormat: z.enum(['svg', 'base64', 'dataUri']).optional().default('svg').describe('Output format: svg (default), base64, or dataUri (for embedding in HTML/Markdown).'),
    // X軸ラベルのタイムゾーン
    tz: z.string().optional().default('Asia/Tokyo').describe('X軸ラベルのタイムゾーン（例: Asia/Tokyo, UTC）'),
    // Optional pattern overlays (ranges/annotations)
    overlays: z
      .object({
        ranges: z
          .array(
            z.object({
              start: z.string(),
              end: z.string(),
              color: z.string().optional(),
              label: z.string().optional(),
            })
          )
          .optional(),
        annotations: z
          .array(
            z.object({ isoTime: z.string(), text: z.string() })
          )
          .optional(),
        depth_zones: z
          .array(
            z.object({ low: z.number(), high: z.number(), color: z.string().optional(), label: z.string().optional() })
          )
          .optional(),
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.withIchimoku) {
      if (Array.isArray(val.withSMA) && val.withSMA.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['withSMA'],
          message: 'withIchimoku=true の場合、withSMA は空配列でなければなりません',
        });
      }
      if (val.withBB === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['withBB'],
          message: 'withIchimoku=true の場合、withBB は false でなければなりません',
        });
      }
    }
  });

// Optional: output contract (not enforced by SDK at runtime, but useful for validation/tests)
export const RenderChartSvgOutputSchema = z.object({
  ok: z.literal(true).or(z.literal(false)),
  summary: z.string(),
  data: z.object({
    svg: z.string().optional(),
    base64: z.string().optional(),
    filePath: z.string().optional(),
    url: z.string().optional(),
    legend: z.record(z.string()).optional(),
  }).or(z.object({})),
  meta: z
    .object({
      pair: z.string(),
      type: CandleTypeEnum.or(z.string()),
      limit: z.number().optional(),
      indicators: z.array(z.string()).optional(),
      bbMode: z.enum(['default', 'extended']).optional(),
      range: z.object({ start: z.string(), end: z.string() }).optional(),
      sizeBytes: z.number().optional(),
      layerCount: z.number().optional(),
      truncated: z.boolean().optional(),
      fallback: z.string().optional(),
      warnings: z.array(z.string()).optional(),
    })
    .optional(),
});

// === Shared output schemas (partial) ===
export const NumericSeriesSchema = z
  .array(z.union([z.number(), z.null()]))
  .transform((arr) => arr.map((v) => (v == null ? null : Number(Number(v).toFixed(2)))));

/**
 * ローソク足スキーマ
 * volume: base 通貨建ての合算取引量（買い+売り区別なし）。
 *   例: btc_jpy → BTC 単位、eth_jpy → ETH 単位。
 *   bitbank /candlestick API の OHLCV[4] をそのまま使用。
 *   公式アプリの Volume バー（買い/売り色分け）とは集計方法が異なる。
 */
export const CandleSchema = z.object({
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
  isoTime: z.string().nullable().optional(),
  isoTimeLocal: z.string().nullable().optional().describe('tz パラメータ指定時のローカル時刻（例: 2026-02-20T09:00:00）'),
  time: z.union([z.string(), z.number()]).optional(),
  timestamp: z.number().optional(),
});

// ChartIndicators shape
export const IchimokuSeriesSchema = z.object({
  ICHI_tenkan: NumericSeriesSchema,
  ICHI_kijun: NumericSeriesSchema,
  ICHI_spanA: NumericSeriesSchema,
  ICHI_spanB: NumericSeriesSchema,
  ICHI_chikou: NumericSeriesSchema,
});

export const BollingerBandsSeriesSchema = z.object({
  BB_upper: NumericSeriesSchema,
  BB_middle: NumericSeriesSchema,
  BB_lower: NumericSeriesSchema,
  BB1_upper: NumericSeriesSchema,
  BB1_middle: NumericSeriesSchema,
  BB1_lower: NumericSeriesSchema,
  BB2_upper: NumericSeriesSchema,
  BB2_middle: NumericSeriesSchema,
  BB2_lower: NumericSeriesSchema,
  BB3_upper: NumericSeriesSchema,
  BB3_middle: NumericSeriesSchema,
  BB3_lower: NumericSeriesSchema,
});

export const SmaSeriesFixedSchema = z.object({
  SMA_5: NumericSeriesSchema,
  SMA_20: NumericSeriesSchema,
  SMA_25: NumericSeriesSchema,
  SMA_50: NumericSeriesSchema,
  SMA_75: NumericSeriesSchema,
  SMA_200: NumericSeriesSchema,
});

export const ChartIndicatorsSchema = IchimokuSeriesSchema.merge(BollingerBandsSeriesSchema).merge(SmaSeriesFixedSchema).extend({
  RSI_14: z.number().nullable().optional(),
});

export const ChartMetaSchema = z.object({
  pastBuffer: z.number().optional(),
  shift: z.number().optional(),
});

export const ChartStatsSchema = z.object({
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  volume_avg: z.number(),
});

export const ChartPayloadSchema = z
  .object({
    candles: z.array(CandleSchema),
    indicators: ChartIndicatorsSchema,
    meta: ChartMetaSchema.optional(),
    stats: ChartStatsSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const len = val.candles.length;
    const seriesKeys = [
      'SMA_5', 'SMA_20', 'SMA_25', 'SMA_50', 'SMA_75', 'SMA_200',
      'BB_upper', 'BB_middle', 'BB_lower', 'BB1_upper', 'BB1_middle', 'BB1_lower', 'BB2_upper', 'BB2_middle', 'BB2_lower', 'BB3_upper', 'BB3_middle', 'BB3_lower',
      'ICHI_tenkan', 'ICHI_kijun', 'ICHI_spanA', 'ICHI_spanB', 'ICHI_chikou',
    ];
    for (const key of seriesKeys) {
      const arr = (val as any).indicators[key];
      if (!Array.isArray(arr) || arr.length !== len) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Indicator series '${key}' must have length ${len}`,
          path: ['indicators', key],
        });
      }
    }
  });

export const TrendLabelEnum = z.enum([
  'strong_uptrend',
  'uptrend',
  'strong_downtrend',
  'downtrend',
  'overbought',
  'oversold',
  'sideways',
  'insufficient_data',
]);

export const IndicatorsInternalSchema = z.object({
  SMA_5: z.number().nullable().optional(),
  SMA_20: z.number().nullable().optional(),
  SMA_25: z.number().nullable().optional(),
  SMA_50: z.number().nullable().optional(),
  SMA_75: z.number().nullable().optional(),
  SMA_200: z.number().nullable().optional(),
  RSI_14: z.number().nullable().optional(),
  RSI_14_series: NumericSeriesSchema.optional(),
  BB_upper: z.number().nullable().optional(),
  BB_middle: z.number().nullable().optional(),
  BB_lower: z.number().nullable().optional(),
  BB1_upper: z.number().nullable().optional(),
  BB1_middle: z.number().nullable().optional(),
  BB1_lower: z.number().nullable().optional(),
  BB2_upper: z.number().nullable().optional(),
  BB2_middle: z.number().nullable().optional(),
  BB2_lower: z.number().nullable().optional(),
  BB3_upper: z.number().nullable().optional(),
  BB3_middle: z.number().nullable().optional(),
  BB3_lower: z.number().nullable().optional(),
  ICHIMOKU_conversion: z.number().nullable().optional(),
  ICHIMOKU_base: z.number().nullable().optional(),
  ICHIMOKU_spanA: z.number().nullable().optional(),
  ICHIMOKU_spanB: z.number().nullable().optional(),
  bb1_series: z
    .object({ upper: NumericSeriesSchema, middle: NumericSeriesSchema, lower: NumericSeriesSchema })
    .optional(),
  bb2_series: z
    .object({ upper: NumericSeriesSchema, middle: NumericSeriesSchema, lower: NumericSeriesSchema })
    .optional(),
  bb3_series: z
    .object({ upper: NumericSeriesSchema, middle: NumericSeriesSchema, lower: NumericSeriesSchema })
    .optional(),
  ichi_series: z
    .object({ tenkan: NumericSeriesSchema, kijun: NumericSeriesSchema, spanA: NumericSeriesSchema, spanB: NumericSeriesSchema, chikou: NumericSeriesSchema })
    .optional(),
  sma_5_series: NumericSeriesSchema.optional(),
  sma_20_series: NumericSeriesSchema.optional(),
  sma_25_series: NumericSeriesSchema.optional(),
  sma_50_series: NumericSeriesSchema.optional(),
  sma_75_series: NumericSeriesSchema.optional(),
  sma_200_series: NumericSeriesSchema.optional(),
  // MACD latest values
  MACD_line: z.number().nullable().optional(),
  MACD_signal: z.number().nullable().optional(),
  MACD_hist: z.number().nullable().optional(),
  // series (optional)
  macd_series: z
    .object({ line: NumericSeriesSchema, signal: NumericSeriesSchema, hist: NumericSeriesSchema })
    .optional(),
  // Stochastic RSI
  STOCH_RSI_K: z.number().nullable().optional(),
  STOCH_RSI_D: z.number().nullable().optional(),
  STOCH_RSI_prevK: z.number().nullable().optional(),
  STOCH_RSI_prevD: z.number().nullable().optional(),
  // OBV (On-Balance Volume)
  OBV: z.number().nullable().optional(),
  OBV_SMA20: z.number().nullable().optional(),
  OBV_prevObv: z.number().nullable().optional(),
  OBV_trend: z.enum(['rising', 'falling', 'flat']).nullable().optional(),
});

export const GetIndicatorsDataSchema = z.object({
  summary: z.string(),
  raw: z.unknown(),
  normalized: z.array(CandleSchema),
  indicators: IndicatorsInternalSchema,
  trend: TrendLabelEnum,
  chart: z.object({
    candles: z.array(CandleSchema),
    indicators: ChartIndicatorsSchema,
    meta: ChartMetaSchema,
    stats: ChartStatsSchema,
  }),
});

export const GetIndicatorsMetaSchema = BaseMetaSchema.extend({
  type: CandleTypeEnum.or(z.string()),
  count: z.number(),
  requiredCount: z.number(),
  warnings: z.array(z.string()).optional(),
});

// === Tool Output Schemas ===
// Ticker
export const TickerNormalizedSchema = z.object({
  pair: z.string(),
  last: z.number().nullable(),
  buy: z.number().nullable(),
  sell: z.number().nullable(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  volume: z.number().nullable(),
  timestamp: z.number().nullable(),
  isoTime: z.string().nullable(),
});

export const GetTickerDataSchemaOut = z.object({ raw: z.unknown(), normalized: TickerNormalizedSchema });
export const GetTickerMetaSchemaOut = BaseMetaSchema;
export const GetTickerOutputSchema = toolResultSchema(GetTickerDataSchemaOut, GetTickerMetaSchemaOut);

// Orderbook
export const OrderbookLevelSchema = z.object({ price: z.number(), size: z.number() });
export const OrderbookLevelWithCumSchema = OrderbookLevelSchema.extend({ cumSize: z.number() });
export const OrderbookNormalizedSchema = z.object({
  pair: z.string(),
  bestBid: z.number().nullable(),
  bestAsk: z.number().nullable(),
  spread: z.number().nullable(),
  mid: z.number().nullable(),
  bids: z.array(OrderbookLevelWithCumSchema),
  asks: z.array(OrderbookLevelWithCumSchema),
  timestamp: z.number().nullable(),
  isoTime: z.string().nullable(),
});
export const GetOrderbookDataSchemaOut = z.object({ raw: z.unknown(), normalized: OrderbookNormalizedSchema });
export const GetOrderbookMetaSchemaOut = BaseMetaSchema.extend({ topN: z.number(), count: z.number() });
export const GetOrderbookOutputSchema = toolResultSchema(GetOrderbookDataSchemaOut, GetOrderbookMetaSchemaOut);

// Candles
export const KeyPointSchema = z.object({
  index: z.number(),
  date: z.string().nullable(),
  close: z.number(),
  changePct: z.number().nullable().optional(),
});

export const KeyPointsSchema = z.object({
  today: KeyPointSchema.nullable(),
  sevenDaysAgo: KeyPointSchema.nullable(),
  thirtyDaysAgo: KeyPointSchema.nullable(),
  ninetyDaysAgo: KeyPointSchema.nullable(),
});

export const VolumeStatsSchema = z.object({
  recent7DaysAvg: z.number(),
  previous7DaysAvg: z.number(),
  last30DaysAvg: z.number().nullable(),
  changePct: z.number(),
  judgment: z.string(),
});

export const GetCandlesDataSchemaOut = z.object({
  raw: z.unknown(),
  normalized: z.array(CandleSchema),
  keyPoints: KeyPointsSchema.optional(),
  volumeStats: VolumeStatsSchema.nullable().optional(),
});
export const GetCandlesMetaSchemaOut = BaseMetaSchema.extend({ type: CandleTypeEnum.or(z.string()), count: z.number() });
export const GetCandlesOutputSchema = toolResultSchema(GetCandlesDataSchemaOut, GetCandlesMetaSchemaOut);

// Indicators
export const GetIndicatorsOutputSchema = toolResultSchema(GetIndicatorsDataSchema, GetIndicatorsMetaSchema);

// Depth (raw depth for analysis/visualization)
export const DepthLevelTupleSchema = z.tuple([z.string(), z.string()]);
export const GetDepthDataSchemaOut = z.object({
  asks: z.array(DepthLevelTupleSchema),
  bids: z.array(DepthLevelTupleSchema),
  asks_over: z.string().optional(),
  asks_under: z.string().optional(),
  bids_over: z.string().optional(),
  bids_under: z.string().optional(),
  ask_market: z.string().optional(),
  bid_market: z.string().optional(),
  timestamp: z.number().int(),
  sequenceId: z.number().int().optional(),
  overlays: z
    .object({
      depth_zones: z.array(z.object({ low: z.number(), high: z.number(), color: z.string().optional(), label: z.string().optional() }))
    })
    .optional(),
});
export const GetDepthMetaSchemaOut = BaseMetaSchema;
export const GetDepthOutputSchema = toolResultSchema(GetDepthDataSchemaOut, GetDepthMetaSchemaOut);

// Depth Diff / Orderbook Pressure schemas removed — consolidated into get_orderbook (mode=raw/pressure/statistics)

// === Transactions ===
export const TransactionItemSchema = z.object({
  price: z.number(),
  amount: z.number(),
  side: z.enum(['buy', 'sell']),
  timestampMs: z.number().int(),
  isoTime: z.string(),
});

export const GetTransactionsDataSchemaOut = z.object({ raw: z.unknown(), normalized: z.array(TransactionItemSchema) });
export const GetTransactionsMetaSchemaOut = BaseMetaSchema.extend({ count: z.number().int(), source: z.enum(['latest', 'by_date']) });
export const GetTransactionsOutputSchema = toolResultSchema(GetTransactionsDataSchemaOut, GetTransactionsMetaSchemaOut);

// === Flow Metrics (derived from recent transactions) ===
export const FlowBucketSchema = z.object({
  timestampMs: z.number().int(),
  isoTime: z.string(),
  isoTimeJST: z.string().optional(),
  displayTime: z.string().optional(),
  buyVolume: z.number(),
  sellVolume: z.number(),
  totalVolume: z.number(),
  cvd: z.number(),
  zscore: z.number().nullable().optional(),
  spike: z.enum(['notice', 'warning', 'strong']).nullable().optional(),
});

export const GetFlowMetricsDataSchemaOut = z.object({
  source: z.literal('transactions'),
  params: z.object({ bucketMs: z.number().int().min(1000) }),
  aggregates: z.object({
    totalTrades: z.number().int(),
    buyTrades: z.number().int(),
    sellTrades: z.number().int(),
    buyVolume: z.number(),
    sellVolume: z.number(),
    netVolume: z.number(),
    aggressorRatio: z.number().min(0).max(1),
    finalCvd: z.number(),
  }),
  series: z.object({ buckets: z.array(FlowBucketSchema) }),
});

export const GetFlowMetricsMetaSchemaOut = BaseMetaSchema.extend({
  count: z.number().int(),
  bucketMs: z.number().int(),
  timezone: z.string().optional(),
  timezoneOffset: z.string().optional(),
  serverTime: z.string().optional(),
});

export const GetFlowMetricsOutputSchema = toolResultSchema(GetFlowMetricsDataSchemaOut, GetFlowMetricsMetaSchemaOut);

export const GetTickerInputSchema = BasePairInputSchema;

export const GetOrderbookInputSchema = BasePairInputSchema.extend({
  mode: z.enum(['summary', 'pressure', 'statistics', 'raw']).optional().default('summary'),
  /** summary mode: 上位N層 (1-200) */
  topN: z.number().int().min(1).max(200).optional().default(10),
  /** pressure mode: 帯域幅 (例: [0.001, 0.005, 0.01]) */
  bandsPct: z.array(z.number().positive()).optional().default([0.001, 0.005, 0.01]),
  /** statistics mode: 範囲% (例: [0.5, 1.0, 2.0]) */
  ranges: z.array(z.number().positive()).optional().default([0.5, 1.0, 2.0]),
  /** statistics mode: 価格ゾーン分割数 */
  priceZones: z.number().int().min(2).max(50).optional().default(10),
});

export const GetTransactionsInputSchema = BasePairInputSchema.extend({
  limit: z.number().int().min(1).max(1000).optional().default(100),
  date: z.string().regex(/^\d{8}$/).optional().describe('YYYYMMDD; omit for latest'),
  minAmount: z.number().positive().optional(),
  maxAmount: z.number().positive().optional(),
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  view: z.enum(['summary', 'items']).optional().default('summary'),
});

export const GetFlowMetricsInputSchema = BasePairInputSchema.extend({
  limit: z.number().int().min(1).max(2000).optional().default(100).describe('取得する約定件数（バケット数ではない）。hours 指定時は無視されます'),
  hours: z.number().min(0.1).max(24).optional().describe('指定した時間数分の約定を取得して分析（例: 8 → 直近8時間）。limit より優先。複数日にまたがる場合も自動で取得します'),
  date: z.string().regex(/^\d{8}$/).optional().describe('YYYYMMDD; omit for latest'),
  bucketMs: z.number().int().min(1000).max(3600_000).optional().default(60_000).describe('バケットの時間幅（ミリ秒）。デフォルト60000=1分間隔'),
  view: z.enum(['summary', 'buckets', 'full']).optional().default('summary'),
  bucketsN: z.number().int().min(1).max(100).optional().default(10),
  tz: z.string().optional().default('Asia/Tokyo'),
});

// === /tickers_jpy (public REST) ===
export const TickerJpyItemSchema = z.object({
  pair: z.string(),
  sell: z.string().nullable(),
  buy: z.string().nullable(),
  high: z.string(),
  low: z.string(),
  open: z.string(),
  last: z.string(),
  vol: z.string(),
  timestamp: z.number(),
  // 追加: 24h変化率（%）。open/last から算出
  change24h: z.number().nullable().optional(),
  change24hPct: z.number().nullable().optional(),
});
export const GetTickersJpyOutputSchema = z.union([
  z.object({ ok: z.literal(true), summary: z.string(), data: z.array(TickerJpyItemSchema), meta: z.object({ cache: z.object({ hit: z.boolean(), key: z.string() }).optional(), ts: z.string() }).passthrough() }),
  FailResultSchema,
]);

export const GetCandlesInputSchema = z.object({
  pair: z.string(),
  type: CandleTypeEnum,
  date: z
    .string()
    .optional()
    .describe("YYYYMMDD format (e.g., 20251022). Fetches the {limit} most recent candles up to and including this date. For '1month' type use YYYY format. If omitted, returns latest candles."),
  limit: z.number().int().min(1).max(1000).optional().default(200),
  view: z.enum(['full', 'items']).optional().default('full'),
  tz: z.string().optional().default('').describe('タイムゾーン（例: Asia/Tokyo）。指定時は各ローソク足に isoTimeLocal フィールドを追加。未指定時はUTCのみ'),
});

export const GetIndicatorsInputSchema = BasePairInputSchema.extend({
  type: CandleTypeEnum.optional().default('1day'),
  limit: z.number().int().min(1).max(1000).optional(),
});

// === Pattern Detection ===
export const PatternTypeEnum = z.enum([
  'double_top',
  'double_bottom',
  'triple_top',
  'triple_bottom',
  'head_and_shoulders',
  'inverse_head_and_shoulders',
  // legacy umbrella key (kept for filter-compat)
  'triangle',
  // new explicit triangle variants
  'triangle_ascending',
  'triangle_descending',
  'triangle_symmetrical',
  // wedge patterns
  'falling_wedge',
  'rising_wedge',
  'pennant',
  'flag',
]);

export const DetectPatternsInputSchema = BasePairInputSchema.extend({
  type: CandleTypeEnum.optional().default('1day'),
  limit: z.number().int().min(20).max(365).optional().default(90),
  patterns: z.array(PatternTypeEnum).optional().describe(
    [
      'Patterns to detect. Recommended params (guideline):',
      '- double_top/double_bottom: default (swingDepth=7, tolerancePct=0.04, minBarsBetweenSwings=5)',
      '- triple_top/triple_bottom: tolerancePct≈0.05',
      '- triangle_*: tolerancePct≈0.06',
      '- pennant: swingDepth≈5, minBarsBetweenSwings≈3',
    ].join('\n')
  ),
  // Heuristics
  swingDepth: z.number().int().min(1).max(10).optional().default(7),
  tolerancePct: z.number().min(0).max(0.1).optional().default(0.04),
  minBarsBetweenSwings: z.number().int().min(1).max(30).optional().default(5),
  view: z.enum(['summary', 'detailed', 'full', 'debug']).optional().default('detailed'),
  // New: relevance filter for "current-involved" long-term patterns
  requireCurrentInPattern: z.boolean().optional().default(false),
  currentRelevanceDays: z.number().int().min(1).max(365).optional().default(7),

  // Unified pattern lifecycle options
  includeForming: z.boolean().optional().default(false).describe('形成中パターンを含める'),
  includeCompleted: z.boolean().optional().default(true).describe('完成済みパターンを含める'),
  includeInvalid: z.boolean().optional().default(false).describe('無効化済みパターンを含める'),
});

export const DetectedPatternSchema = z.object({
  type: PatternTypeEnum,
  confidence: z.number().min(0).max(1),
  /** 検出に使用した時間足（例: '1day', '4hour', '1week'） */
  timeframe: CandleTypeEnum.or(z.string()).optional(),
  /** 人間可読な時間足ラベル（例: '日足', '4時間足', '週足'） */
  timeframeLabel: z.string().optional(),
  range: z.object({ start: z.string(), end: z.string() }),
  pivots: z.array(z.object({ idx: z.number().int(), price: z.number() })).optional(),
  neckline: z.array(z.object({ x: z.number().int().optional(), y: z.number() })).length(2).optional(),
  // Optional: structure diagram (static SVG artifact to help beginners grok the pattern shape)
  structureDiagram: z.object({
    svg: z.string(),
    artifact: z.object({ identifier: z.string(), title: z.string() }),
  }).optional(),
  // 統合: パターンのステータス（形成中/完成度近し/完成済み/無効化）
  status: z.enum(['forming', 'near_completion', 'completed', 'invalid']).optional(),
  // 形成中パターン用フィールド
  apexDate: z.string().optional(),           // アペックス（頂点）到達予定日
  daysToApex: z.number().int().optional(),   // アペックスまでの日数
  completionPct: z.number().int().optional(), // 完成度（%）
  // 完成済みパターン用フィールド
  breakoutDate: z.string().optional(),       // ブレイクアウト日
  daysSinceBreakout: z.number().int().optional(), // ブレイクアウトからの経過日数
  // ブレイク方向と結果
  breakoutDirection: z.enum(['up', 'down']).optional(),  // ブレイク方向
  outcome: z.enum(['success', 'failure']).optional(),    // パターン結果（期待通り=success, 逆方向=failure）
  // ペナント用: フラッグポール（旗竿）情報
  poleDirection: z.enum(['up', 'down']).optional(),             // フラッグポールの方向
  priorTrendDirection: z.enum(['bullish', 'bearish']).optional(), // 先行トレンド方向
  isTrendContinuation: z.boolean().optional(),                  // ブレイク方向が先行トレンドと一致しているか
  flagpoleHeight: z.number().optional(),                        // フラッグポールの値幅
  retracementRatio: z.number().optional(),                      // フラッグポールに対する戻し比率（0.38未満ならペナント的）
  aftermath: z
    .object({
      breakoutDate: z.string().nullable().optional(),
      breakoutConfirmed: z.boolean(),
      priceMove: z
        .object({
          days3: z.object({ return: z.number(), high: z.number(), low: z.number() }).nullable().optional(),
          days7: z.object({ return: z.number(), high: z.number(), low: z.number() }).nullable().optional(),
          days14: z.object({ return: z.number(), high: z.number(), low: z.number() }).nullable().optional(),
        })
        .optional(),
      targetReached: z.boolean(),
      theoreticalTarget: z.number().nullable().optional(),
      outcome: z.string(),
      // New: number of bars (days for 1day, weeks for 1week, etc.) to reach theoretical target (if reached within evaluation window)
      daysToTarget: z.number().int().nullable().optional(),
    })
    .optional(),
});

export const DetectPatternsOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    summary: z.string(),
    data: z.object({
      patterns: z.array(DetectedPatternSchema),
      overlays: z
        .object({
          ranges: z
            .array(
              z.object({ start: z.string(), end: z.string(), color: z.string().optional(), label: z.string().optional() })
            )
            .optional(),
          annotations: z.array(z.object({ isoTime: z.string(), text: z.string() })).optional(),
        })
        .optional(),
      warnings: z.array(z.object({ type: z.string(), message: z.string(), suggestedParams: z.record(z.any()).optional() })).optional(),
      statistics: z.record(z.object({
        detected: z.number().int(),
        withAftermath: z.number().int(),
        successRate: z.number().nullable(),
        avgReturn7d: z.number().nullable(),
        avgReturn14d: z.number().nullable(),
        medianReturn7d: z.number().nullable(),
      })).optional(),
    }),
    meta: z.object({
      pair: z.string(),
      type: CandleTypeEnum.or(z.string()),
      count: z.number().int(),
      visualization_hints: z
        .object({ preferred_style: z.enum(['candles', 'line']).optional(), highlight_patterns: z.array(PatternTypeEnum).optional() })
        .optional(),
      debug: z
        .object({
          swings: z.array(z.object({ idx: z.number().int(), price: z.number(), kind: z.enum(['H', 'L']), isoTime: z.string().optional() })).optional(),
          candidates: z.array(z.object({
            type: PatternTypeEnum,
            accepted: z.boolean(),
            reason: z.string().optional(),
            indices: z.array(z.number().int()).optional(),
            points: z.array(z.object({ role: z.string(), idx: z.number().int(), price: z.number(), isoTime: z.string().optional() })).optional(),
            details: z.any().optional(),
          })).optional(),
        })
        .optional(),
    }),
  }),
  FailResultSchema,
]);

// === Volatility Metrics ===
export const GetVolMetricsInputSchema = z.object({
  pair: z.string(),
  type: CandleTypeEnum,
  limit: z.number().int().min(20).max(500).optional().default(200),
  windows: z.array(z.number().int().min(2)).optional().default([14, 20, 30]),
  useLogReturns: z.boolean().optional().default(true),
  annualize: z.boolean().optional().default(true),
  tz: z.string().optional().default('UTC'),
  cacheTtlMs: z.number().int().optional().default(60_000),
  view: z.enum(['summary', 'detailed', 'full', 'beginner']).optional().default('summary'),
});

export const GetVolMetricsDataSchemaOut = z.object({
  meta: z.object({
    pair: z.string(),
    type: z.string(),
    fetchedAt: z.string(),
    baseIntervalMs: z.number(),
    sampleSize: z.number(),
    windows: z.array(z.number()),
    annualize: z.boolean(),
    useLogReturns: z.boolean(),
    source: z.literal('bitbank:candlestick'),
  }),
  aggregates: z.object({
    rv_std: z.number(),
    rv_std_ann: z.number().optional(),
    parkinson: z.number(),
    garmanKlass: z.number(),
    rogersSatchell: z.number(),
    atr: z.number(),
    skewness: z.number().optional(),
    kurtosis: z.number().optional(),
    gap_ratio: z.number().optional(),
  }),
  rolling: z.array(z.object({
    window: z.number(),
    rv_std: z.number(),
    rv_std_ann: z.number().optional(),
    atr: z.number().optional(),
    parkinson: z.number().optional(),
    garmanKlass: z.number().optional(),
    rogersSatchell: z.number().optional(),
  })),
  series: z.object({
    ts: z.array(z.number()),
    close: z.array(z.number()),
    ret: z.array(z.number()),
    rv_inst: z.array(z.number()).optional(),
  }),
  tags: z.array(z.string()),
});

export const GetVolMetricsMetaSchemaOut = BaseMetaSchema.extend({
  type: CandleTypeEnum.or(z.string()),
  count: z.number().int(),
});

export const GetVolMetricsOutputSchema = toolResultSchema(GetVolMetricsDataSchemaOut, GetVolMetricsMetaSchemaOut);

// === Market Summary (tickers + volatility snapshot) ===
export const MarketSummaryItemSchema = z.object({
  pair: z.string(),
  last: z.number().nullable(),
  change24hPct: z.number().nullable().optional(),
  vol24h: z.number().nullable().optional(),
  rv_std_ann: z.number().nullable().optional(),
  vol_bucket: z.enum(['low', 'mid', 'high']).nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export const MarketSummaryRanksSchema = z.object({
  topGainers: z.array(z.object({ pair: z.string(), change24hPct: z.number().nullable() })).optional(),
  topLosers: z.array(z.object({ pair: z.string(), change24hPct: z.number().nullable() })).optional(),
  topVolatility: z.array(z.object({ pair: z.string(), rv_std_ann: z.number().nullable() })).optional(),
});

// removed: GetMarketSummary* schemas

// === Analyze Market Signal ===
export const AnalyzeMarketSignalDataSchemaOut = z.object({
  score: z.number(),
  recommendation: z.enum(['bullish', 'bearish', 'neutral']),
  tags: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  confidenceReason: z.string(),
  nextActions: z.array(z.object({
    priority: z.enum(['high', 'medium', 'low']),
    tool: z.string(),
    reason: z.string(),
    suggestedParams: z.record(z.any()).optional(),
  })),
  alerts: z.array(z.object({ level: z.enum(['info', 'warning', 'critical']), message: z.string() })).optional(),
  formula: z.string(),
  weights: z.object({
    buyPressure: z.number(),
    cvdTrend: z.number(),
    momentum: z.number(),
    volatility: z.number(),
    smaTrend: z.number(),
  }),
  contributions: z.object({
    buyPressure: z.number(),
    cvdTrend: z.number(),
    momentum: z.number(),
    volatility: z.number(),
    smaTrend: z.number(),
  }),
  breakdown: z.object({
    buyPressure: z.object({ rawValue: z.number(), weight: z.number(), contribution: z.number(), interpretation: z.enum(['weak', 'moderate', 'strong', 'neutral']) }),
    cvdTrend: z.object({ rawValue: z.number(), weight: z.number(), contribution: z.number(), interpretation: z.enum(['weak', 'moderate', 'strong', 'neutral']) }),
    momentum: z.object({ rawValue: z.number(), weight: z.number(), contribution: z.number(), interpretation: z.enum(['weak', 'moderate', 'strong', 'neutral']) }),
    volatility: z.object({ rawValue: z.number(), weight: z.number(), contribution: z.number(), interpretation: z.enum(['weak', 'moderate', 'strong', 'neutral']) }),
    smaTrend: z.object({ rawValue: z.number(), weight: z.number(), contribution: z.number(), interpretation: z.enum(['weak', 'moderate', 'strong', 'neutral']) }),
  }),
  topContributors: z.array(z.enum(['buyPressure', 'cvdTrend', 'momentum', 'volatility', 'smaTrend'])).min(1),
  thresholds: z.object({ bullish: z.number(), bearish: z.number() }),
  metrics: z.object({
    buyPressure: z.number(),
    cvdTrend: z.number(),
    momentumFactor: z.number(),
    volatilityFactor: z.number(),
    smaTrendFactor: z.number(),
    rsi: z.number().nullable(),
    rv_std_ann: z.number(),
    aggressorRatio: z.number(),
    cvdSlope: z.number(),
    horizon: z.number().int(),
  }),
  // Enriched SMA block for LLM-friendly grounding
  sma: z.object({
    current: z.number().nullable(),
    values: z.object({
      sma25: z.number().nullable(),
      sma75: z.number().nullable(),
      sma200: z.number().nullable(),
    }),
    deviations: z.object({
      vs25: z.number().nullable(),
      vs75: z.number().nullable(),
      vs200: z.number().nullable(),
    }),
    arrangement: z.enum(['bullish', 'bearish', 'mixed']),
    position: z.enum(['above_all', 'below_all', 'mixed']),
    distanceFromSma25Pct: z.number().nullable().optional(),
    recentCross: z.object({
      type: z.enum(['golden_cross', 'death_cross']),
      pair: z.literal('25/75'),
      barsAgo: z.number().int(),
    }).nullable().optional(),
  }).optional(),
  // Optional helper fields
  recommendedTimeframes: z.array(z.string()).optional(),
  refs: z.object({
    flow: z.object({ aggregates: z.unknown(), lastBuckets: z.array(z.unknown()) }),
    volatility: z.object({ aggregates: z.unknown() }),
    indicators: z.object({ latest: z.unknown(), trend: TrendLabelEnum }),
  }),
});
export const AnalyzeMarketSignalMetaSchemaOut = BaseMetaSchema.extend({ type: CandleTypeEnum.or(z.string()), windows: z.array(z.number()), bucketMs: z.number().int(), flowLimit: z.number().int() });
export const AnalyzeMarketSignalOutputSchema = toolResultSchema(AnalyzeMarketSignalDataSchemaOut, AnalyzeMarketSignalMetaSchemaOut);
export const AnalyzeMarketSignalInputSchema = BasePairInputSchema.extend({ type: CandleTypeEnum.optional().default('1day'), flowLimit: z.number().int().optional().default(300), bucketMs: z.number().int().optional().default(60_000), windows: z.array(z.number().int()).optional().default([14, 20, 30]) });

// === Ichimoku numeric snapshot (no visual assumptions) ===
export const AnalyzeIchimokuSnapshotInputSchema = BasePairInputSchema.extend({
  type: CandleTypeEnum.optional().default('1day'),
  limit: z.number().int().min(60).max(365).optional().default(120),
  lookback: z.number().int().min(2).max(120).optional().default(10),
});

export const AnalyzeIchimokuSnapshotDataSchemaOut = z.object({
  latest: z.object({
    close: z.number().nullable(),
    tenkan: z.number().nullable(),
    kijun: z.number().nullable(),
    spanA: z.number().nullable(),
    spanB: z.number().nullable(),
    chikou: z.number().nullable().optional(),
    cloudTop: z.number().nullable(),
    cloudBottom: z.number().nullable(),
  }),
  assessment: z.object({
    pricePosition: z.enum(['above_cloud', 'in_cloud', 'below_cloud', 'unknown']),
    tenkanKijun: z.enum(['bullish', 'bearish', 'neutral', 'unknown']),
    cloudSlope: z.enum(['rising', 'falling', 'flat', 'unknown']),
  }),
  cloud: z.object({
    thickness: z.number().nullable(),
    thicknessPct: z.number().nullable(),
    direction: z.enum(['rising', 'falling', 'flat']).nullable(),
    strength: z.enum(['strong', 'moderate', 'weak']).nullable(),
    upperBound: z.number().nullable(),
    lowerBound: z.number().nullable(),
  }).optional(),
  tenkanKijunDetail: z.object({
    relationship: z.enum(['bullish', 'bearish']).nullable(),
    distance: z.number().nullable(),
    distancePct: z.number().nullable(),
  }).optional(),
  chikouSpan: z.object({
    position: z.enum(['above', 'below']).nullable(),
    distance: z.number().nullable(),
    clearance: z.number().nullable(),
  }).optional(),
  trend: z.object({
    cloudHistory: z.array(z.object({ barsAgo: z.number().int(), position: z.enum(['above', 'in', 'below']) })),
    trendStrength: z.object({ shortTerm: z.number(), mediumTerm: z.number() }),
    momentum: z.enum(['accelerating', 'steady', 'decelerating']),
  }).optional(),
  signals: z.object({
    sanpuku: z.object({
      kouten: z.boolean(),
      gyakuten: z.boolean(),
      conditions: z.object({ priceAboveCloud: z.boolean(), tenkanAboveKijun: z.boolean(), chikouAbovePrice: z.boolean() })
    }),
    recentCrosses: z.array(z.object({ type: z.enum(['golden_cross', 'death_cross']), barsAgo: z.number().int(), description: z.string() })),
    kumoTwist: z.object({ detected: z.boolean(), barsAgo: z.number().int().optional(), direction: z.enum(['bullish', 'bearish']).optional() }),
    overallSignal: z.enum(['strong_bullish', 'bullish', 'neutral', 'bearish', 'strong_bearish']),
    confidence: z.enum(['high', 'medium', 'low']),
  }).optional(),
  scenarios: z.object({
    keyLevels: z.object({ resistance: z.array(z.number()), support: z.array(z.number()), cloudEntry: z.number(), cloudExit: z.number() }),
    scenarios: z.object({
      bullish: z.object({ condition: z.string(), target: z.number(), probability: z.enum(['high', 'medium', 'low']) }),
      bearish: z.object({ condition: z.string(), target: z.number(), probability: z.enum(['high', 'medium', 'low']) }),
    }),
    watchPoints: z.array(z.string()),
  }).optional(),
  tags: z.array(z.string()),
});

export const AnalyzeIchimokuSnapshotMetaSchemaOut = BaseMetaSchema.extend({
  type: CandleTypeEnum.or(z.string()),
  count: z.number().int(),
});

export const AnalyzeIchimokuSnapshotOutputSchema = toolResultSchema(AnalyzeIchimokuSnapshotDataSchemaOut, AnalyzeIchimokuSnapshotMetaSchemaOut);

// === BB snapshot ===
export const AnalyzeBbSnapshotInputSchema = BasePairInputSchema.extend({
  type: CandleTypeEnum.optional().default('1day'),
  limit: z.number().int().min(40).max(365).optional().default(120),
  mode: z.enum(['default', 'extended']).optional().default('default')
});

// analyze_bb_snapshot: support legacy (flat) and new (structured) data shapes
const AnalyzeBbSnapshotDataSchemaLegacy = z.object({
  latest: z.object({ close: z.number().nullable(), middle: z.number().nullable(), upper: z.number().nullable(), lower: z.number().nullable() }),
  zScore: z.number().nullable(),
  bandWidthPct: z.number().nullable(),
  tags: z.array(z.string()),
});

const AnalyzeBbSnapshotDataSchemaStructured = z.object({
  mode: z.enum(['default', 'extended']),
  price: z.number().nullable(),
  bb: z.union([
    // default: middle/upper/lower
    z.object({
      middle: z.number().nullable(),
      upper: z.number().nullable(),
      lower: z.number().nullable(),
      zScore: z.number().nullable(),
      bandWidthPct: z.number().nullable(),
    }),
    // extended: bands map and bandWidthPct per band
    z.object({
      middle: z.number().nullable(),
      bands: z.record(z.string(), z.number().nullable()).optional(),
      zScore: z.number().nullable(),
      bandWidthPct: z.union([z.number().nullable(), z.record(z.string(), z.number().nullable())]),
    }),
  ]),
  interpretation: z.unknown().optional(),
  position_analysis: z.unknown().optional(),
  extreme_events: z.unknown().optional(),
  context: z.unknown().optional(),
  signals: z.array(z.string()).optional(),
  next_steps: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
});

export const AnalyzeBbSnapshotDataSchemaOut = z.union([
  AnalyzeBbSnapshotDataSchemaLegacy,
  AnalyzeBbSnapshotDataSchemaStructured,
]);

export const AnalyzeBbSnapshotMetaSchemaOut = BaseMetaSchema.extend({
  type: CandleTypeEnum.or(z.string()),
  count: z.number().int(),
  mode: z.enum(['default', 'extended']),
  // allow additional meta injected by implementation
  extra: z.object({}).passthrough().optional(),
});

export const AnalyzeBbSnapshotOutputSchema = toolResultSchema(AnalyzeBbSnapshotDataSchemaOut, AnalyzeBbSnapshotMetaSchemaOut);

// === SMA snapshot ===
export const AnalyzeSmaSnapshotInputSchema = BasePairInputSchema.extend({
  type: CandleTypeEnum.optional().default('1day'),
  limit: z.number().int().min(200).max(365).optional().default(220),
  periods: z.array(z.number().int()).optional().default([25, 75, 200])
});

export const AnalyzeSmaSnapshotDataSchemaOut = z.object({
  latest: z.object({ close: z.number().nullable() }),
  sma: z.record(z.string(), z.number().nullable()),
  crosses: z.array(z.object({ a: z.string(), b: z.string(), type: z.enum(['golden', 'dead']), delta: z.number() })),
  alignment: z.enum(['bullish', 'bearish', 'mixed', 'unknown']),
  tags: z.array(z.string()),
  // Extended (optional): enriched summary and SMA analytics
  summary: z.object({
    close: z.number().nullable(),
    align: z.enum(['bullish', 'bearish', 'mixed', 'unknown']),
    position: z.enum(['above_all', 'below_all', 'between', 'unknown']),
  }).optional(),
  smas: z.record(z.string(), z.object({
    value: z.number().nullable(),
    distancePct: z.number().nullable(),
    distanceAbs: z.number().nullable(),
    slope: z.enum(['rising', 'falling', 'flat']),
    slopePctPerBar: z.number().nullable(),
    slopePctTotal: z.number().nullable(),
    barsWindow: z.number().nullable(),
    slopePctPerDay: z.number().nullable().optional(),
  })).optional(),
  recentCrosses: z.array(z.object({
    type: z.enum(['golden_cross', 'dead_cross']),
    pair: z.tuple([z.number(), z.number()]),
    barsAgo: z.number().int(),
    date: z.string(),
  })).optional(),
}).passthrough();

export const AnalyzeSmaSnapshotMetaSchemaOut = BaseMetaSchema.extend({ type: CandleTypeEnum.or(z.string()), count: z.number().int(), periods: z.array(z.number().int()) });

export const AnalyzeSmaSnapshotOutputSchema = toolResultSchema(AnalyzeSmaSnapshotDataSchemaOut, AnalyzeSmaSnapshotMetaSchemaOut);

// === Support Resistance Analysis ===
export const AnalyzeSupportResistanceInputSchema = BasePairInputSchema.extend({
  lookbackDays: z.number().int().min(30).max(200).optional().default(90),
  topN: z.number().int().min(1).max(5).optional().default(3),
  tolerance: z.number().min(0.001).max(0.05).optional().default(0.015),
});

const TouchEventSchema = z.object({
  date: z.string(),
  price: z.number(),
  bounceStrength: z.number(),
  type: z.enum(['support', 'resistance']),
});

const SupportResistanceLevelSchema = z.object({
  price: z.number(),
  pctFromCurrent: z.number(),
  strength: z.number().int().min(1).max(3),
  label: z.string(),
  touchCount: z.number().int(),
  touches: z.array(TouchEventSchema),
  recentBreak: z.object({
    date: z.string(),
    price: z.number(),
    breakPct: z.number(),
  }).optional(),
});

export const AnalyzeSupportResistanceDataSchemaOut = z.object({
  currentPrice: z.number(),
  analysisDate: z.string(),
  lookbackDays: z.number().int(),
  supports: z.array(SupportResistanceLevelSchema),
  resistances: z.array(SupportResistanceLevelSchema),
  detectionCriteria: z.object({
    swingDepth: z.number().int(),
    recentBreakWindow: z.number().int(),
    tolerance: z.number(),
  }),
}).passthrough();

export const AnalyzeSupportResistanceMetaSchemaOut = BaseMetaSchema.extend({
  lookbackDays: z.number().int(),
  topN: z.number().int(),
  supportCount: z.number().int(),
  resistanceCount: z.number().int(),
}).passthrough();

export const AnalyzeSupportResistanceOutputSchema = z.union([
  z.object({ ok: z.literal(true), summary: z.string(), content: z.array(z.object({ type: z.literal('text'), text: z.string() })).optional(), data: AnalyzeSupportResistanceDataSchemaOut, meta: AnalyzeSupportResistanceMetaSchemaOut }),
  FailResultSchema,
]);

// === Candle Patterns (2-bar patterns: engulfing, harami, etc.) ===

export const CandlePatternTypeEnum = z.enum([
  'bullish_engulfing',
  'bearish_engulfing',
  'bullish_harami',
  'bearish_harami',
  'tweezer_top',
  'tweezer_bottom',
  'dark_cloud_cover',
  'piercing_line',
]);

export const AnalyzeCandlePatternsInputSchema = z.object({
  pair: z.literal('btc_jpy').optional().default('btc_jpy'),
  timeframe: z.literal('1day').optional().default('1day'),
  // as_of: 主要パラメータ名（ISO形式 "2025-11-05" または YYYYMMDD "20251105" を受け付け）
  as_of: z.string().optional().describe('Date to analyze (ISO "2025-11-05" or YYYYMMDD "20251105"). If omitted, uses latest data.'),
  // date: 互換性のため残す（as_of が優先）
  date: z.string().regex(/^\d{8}$/).optional().describe('DEPRECATED: Use as_of instead. YYYYMMDD format.'),
  window_days: z.number().int().min(3).max(10).optional().default(5),
  focus_last_n: z.number().int().min(2).max(5).optional().default(5),
  patterns: z.array(CandlePatternTypeEnum).optional().describe('Patterns to detect. If omitted, all patterns are checked.'),
  history_lookback_days: z.number().int().min(30).max(365).optional().default(180),
  history_horizons: z.array(z.number().int().min(1).max(10)).optional().default([1, 3, 5]),
  allow_partial_patterns: z.boolean().optional().default(true),
});

const HistoryHorizonStatsSchema = z.object({
  avg_return: z.number(),
  win_rate: z.number(),
  sample: z.number().int(),
});

const HistoryStatsSchema = z.object({
  lookback_days: z.number().int(),
  occurrences: z.number().int(),
  horizons: z.record(z.string(), HistoryHorizonStatsSchema),
});

const LocalContextSchema = z.object({
  trend_before: z.enum(['up', 'down', 'neutral']),
  volatility_level: z.enum(['low', 'medium', 'high']),
});

const DetectedCandlePatternSchema = z.object({
  pattern: CandlePatternTypeEnum,
  pattern_jp: z.string(),
  direction: z.enum(['bullish', 'bearish']),
  strength: z.number().min(0).max(1),
  candle_range_index: z.tuple([z.number().int(), z.number().int()]),
  uses_partial_candle: z.boolean(),
  status: z.enum(['confirmed', 'forming']),
  local_context: LocalContextSchema,
  history_stats: HistoryStatsSchema.nullable(),
});

const WindowCandleSchema = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  is_partial: z.boolean(),
});

export const AnalyzeCandlePatternsDataSchemaOut = z.object({
  pair: z.string(),
  timeframe: z.string(),
  snapshot_time: z.string(),
  window: z.object({
    from: z.string(),
    to: z.string(),
    candles: z.array(WindowCandleSchema).describe(
      'CRITICAL: Array order is [oldest, ..., newest]. index 0 = most distant, index n-1 = latest (possibly partial).'
    ),
  }),
  recent_patterns: z.array(DetectedCandlePatternSchema),
  summary: z.string(),
});

export const AnalyzeCandlePatternsMetaSchemaOut = BaseMetaSchema.extend({
  timeframe: z.string(),
  as_of: z.string().nullable().describe('Original input value (ISO or YYYYMMDD)'),
  date: z.string().nullable().describe('YYYYMMDD normalized, null for latest'),
  window_days: z.number().int(),
  patterns_checked: z.array(CandlePatternTypeEnum),
  history_lookback_days: z.number().int(),
  history_horizons: z.array(z.number().int()),
});

export const AnalyzeCandlePatternsOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    summary: z.string(),
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })).optional(),
    data: AnalyzeCandlePatternsDataSchemaOut,
    meta: AnalyzeCandlePatternsMetaSchemaOut,
  }),
  FailResultSchema,
]);

// === Candle Pattern Diagram (2-bar pattern visualization) ===

const DiagramCandleSchema = z.object({
  date: z.string().describe('Display date e.g. "11/6(木)"'),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  type: z.enum(['bullish', 'bearish']),
  isPartial: z.boolean().optional(),
});

const DiagramPatternSchema = z.object({
  name: z.string().describe('Pattern name in Japanese e.g. "陽線包み線"'),
  nameEn: z.string().optional().describe('Pattern name in English e.g. "bullish_engulfing"'),
  confirmedDate: z.string().describe('Confirmed date e.g. "11/9(日)"'),
  involvedIndices: z.tuple([z.number().int(), z.number().int()]).describe('[prevIndex, confirmedIndex]'),
  direction: z.enum(['bullish', 'bearish']).optional(),
});

export const RenderCandlePatternDiagramInputSchema = z.object({
  candles: z.array(DiagramCandleSchema).min(2).max(10).describe('Candle data array (oldest first)'),
  pattern: DiagramPatternSchema.optional().describe('Pattern to highlight'),
  title: z.string().optional().describe('Chart title (default: pattern name or "ローソク足チャート")'),
  theme: z.enum(['dark', 'light']).optional().default('dark'),
});

export const RenderCandlePatternDiagramDataSchemaOut = z.object({
  svg: z.string().optional(),
  filePath: z.string().optional(),
  url: z.string().optional(),
});

export const RenderCandlePatternDiagramMetaSchemaOut = z.object({
  width: z.number().int(),
  height: z.number().int(),
  candleCount: z.number().int(),
  patternName: z.string().nullable(),
});

export const RenderCandlePatternDiagramOutputSchema = toolResultSchema(RenderCandlePatternDiagramDataSchemaOut, RenderCandlePatternDiagramMetaSchemaOut);

// === Trading Process: Backtest Schemas ===

export const BacktestTimeframeEnum = z.enum(['1D', '4H', '1H']);
export const BacktestPeriodEnum = z.enum(['1M', '3M', '6M']);


const BacktestTradeSchema = z.object({
  entry_time: z.string(),
  entry_price: z.number(),
  exit_time: z.string(),
  exit_price: z.number(),
  pnl_pct: z.number(),
  fee_pct: z.number(),
});

const EquityPointSchema = z.object({
  time: z.string(),
  equity_pct: z.number(),
});

const DrawdownPointSchema = z.object({
  time: z.string(),
  drawdown_pct: z.number(),
});

// === Generic Backtest Schema ===

export const StrategyTypeEnum = z.enum(['sma_cross', 'rsi', 'macd_cross', 'bb_breakout']);

export const StrategyConfigSchema = z.object({
  type: StrategyTypeEnum.describe('Strategy type'),
  params: z.record(z.number()).optional().default({}).describe('Strategy parameters (overrides defaults)'),
});

export const RunBacktestInputSchema = z.object({
  pair: z.string().optional().default('btc_jpy').describe('Trading pair (e.g., btc_jpy)'),
  timeframe: BacktestTimeframeEnum.optional().default('1D').describe('Candle timeframe: 1D (daily), 4H (4-hour), 1H (hourly)'),
  period: BacktestPeriodEnum.optional().default('3M').describe('Backtest period: 1M, 3M, or 6M'),
  strategy: StrategyConfigSchema.describe('Strategy configuration'),
  fee_bp: z.number().min(0).max(100).optional().default(12).describe('One-way fee in basis points'),
  execution: z.literal('t+1_open').optional().default('t+1_open').describe('Execution timing (fixed: t+1_open)'),
  outputDir: z.string().optional().default('/mnt/user-data/outputs').describe('Output directory for chart files'),
  savePng: z.boolean().optional().default(true).describe('Save chart as PNG file (default: true)'),
  includeSvg: z.boolean().optional().default(false).describe('Include SVG string in response (default: false, for token saving)'),
  chartDetail: z.enum(['default', 'full']).optional().default('default').describe('Chart detail level: default (equity+DD only) or full (price+indicator+equity+DD+position). Use full ONLY when user explicitly requests price chart or indicator visualization.'),
});

const GenericBacktestSummarySchema = z.object({
  total_pnl_pct: z.number(),
  trade_count: z.number(),
  win_rate: z.number(),
  max_drawdown_pct: z.number(),
  buy_hold_pnl_pct: z.number(),
  excess_return_pct: z.number(),
  profit_factor: z.number().nullable().describe('Profit Factor (gross profit / gross loss). null if no losing trades'),
  sharpe_ratio: z.number().nullable().describe('Annualized Sharpe Ratio (daily returns, sqrt(365))'),
  avg_pnl_pct: z.number().describe('Average P&L per trade [%]'),
});

export const RunBacktestOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    summary: z.string(),
    data: z.object({
      input: z.object({
        pair: z.string(),
        timeframe: z.string(),
        period: z.string(),
        strategy: StrategyConfigSchema,
        fee_bp: z.number(),
        execution: z.string(),
      }),
      summary: GenericBacktestSummarySchema,
      trades: z.array(BacktestTradeSchema),
      equity_curve: z.array(EquityPointSchema),
      drawdown_curve: z.array(DrawdownPointSchema),
      overlays: z.array(z.any()),
    }),
    chartPath: z.string().optional().describe('Path to saved PNG chart file'),
    svg: z.string().optional().describe('SVG string (only if includeSvg: true)'),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    availableStrategies: z.array(StrategyTypeEnum).optional(),
  }),
]);
