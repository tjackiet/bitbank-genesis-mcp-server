import analyzeSmaSnapshot from './analyze_sma_snapshot.js';
import { ok, failFromError, failFromValidation } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import { AnalyzeMtfSmaInputSchema, AnalyzeMtfSmaOutputSchema } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';

export default async function analyzeMtfSma(
  pair: string = 'btc_jpy',
  timeframes: string[] = ['1hour', '4hour', '1day'],
  periods: number[] = [25, 75, 200]
) {
  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk, AnalyzeMtfSmaOutputSchema) as any;

  try {
    // Run all timeframes in parallel — each triggers analyzeIndicators
    // which has a 30s TTL cache, so same pair+type won't re-fetch.
    const results = await Promise.all(
      timeframes.map(async (tf) => {
        const res = await analyzeSmaSnapshot(chk.pair, tf, 220, periods);
        return { timeframe: tf, result: res as any };
      })
    );

    // Build per-timeframe results (pick fields relevant to MTF view)
    const byTimeframe: Record<string, any> = {};
    const alignments: string[] = [];

    for (const { timeframe, result } of results) {
      if (result?.ok && result?.data) {
        const d = result.data;
        byTimeframe[timeframe] = {
          alignment: d.alignment,
          position: d.summary?.position ?? 'unknown',
          latest: d.latest,
          sma: d.sma,
          smas: d.smas,
          crosses: d.crosses,
          recentCrosses: d.recentCrosses,
          tags: d.tags,
        };
        alignments.push(d.alignment);
      } else {
        byTimeframe[timeframe] = { alignment: 'unknown', latest: { close: null } };
        alignments.push('unknown');
      }
    }

    // Confluence judgment
    const valid = alignments.filter((a) => a !== 'unknown');
    let direction: 'bullish' | 'bearish' | 'mixed' | 'unknown';
    let aligned: boolean;

    if (valid.length === 0) {
      direction = 'unknown';
      aligned = false;
    } else if (valid.every((a) => a === 'bullish')) {
      direction = 'bullish';
      aligned = true;
    } else if (valid.every((a) => a === 'bearish')) {
      direction = 'bearish';
      aligned = true;
    } else {
      direction = 'mixed';
      aligned = false;
    }

    const dirLabel = direction === 'bullish' ? '上昇' : direction === 'bearish' ? '下降' : '混合';
    const summary = aligned
      ? `全時間軸が${dirLabel}方向で一致`
      : `時間軸間で方向が分かれている（${timeframes.map((tf) => `${tf}:${byTimeframe[tf]?.alignment}`).join(', ')})`;

    const summaryText = timeframes.map((tf) => `${tf}: ${byTimeframe[tf]?.alignment}`).join(' / ') + ` → ${summary}`;

    const data = {
      timeframes: byTimeframe,
      confluence: { aligned, direction, summary },
    };

    const meta = createMeta(chk.pair, { timeframes, periods });
    return AnalyzeMtfSmaOutputSchema.parse(ok(summaryText, data as any, meta as any)) as any;
  } catch (e: unknown) {
    return failFromError(e, { schema: AnalyzeMtfSmaOutputSchema }) as any;
  }
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
  name: 'analyze_mtf_sma',
  description: '複数タイムフレームのSMAを一括分析し、整列方向とコンフルエンスを判定します。',
  inputSchema: AnalyzeMtfSmaInputSchema,
  handler: async ({ pair, timeframes, periods }: any) => analyzeMtfSma(pair, timeframes, periods),
};
