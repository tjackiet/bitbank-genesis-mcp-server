import analyzeIndicators from './analyze_indicators.js';
import { ok, fail, failFromError } from '../lib/result.js';
import { DetectPatternsInputSchema, DetectPatternsOutputSchema, PatternTypeEnum } from '../src/schemas.js';
import {
  resolveParams,
} from './patterns/config.js';
import { detectSwingPoints, filterPeaks, filterValleys, type Candle } from './patterns/swing.js';
import {
  linearRegressionWithR2,
  near as nearFn,
  pct as pctFn,
} from './patterns/regression.js';
import { type CandDebugEntry, type DetectContext } from './patterns/types.js';
import { buildStatistics } from './patterns/aftermath.js';
// --- 各パターン検出モジュール ---
import { detectDoubles } from './patterns/detect_doubles.js';
import { detectHeadAndShoulders } from './patterns/detect_hs.js';
import { detectTriangles } from './patterns/detect_triangles.js';
import { detectWedges } from './patterns/detect_wedges.js';
import { detectPennantsFlags } from './patterns/detect_pennants.js';
import { detectTriples } from './patterns/detect_triples.js';

/**
 * detect_patterns - チャートパターン検出（完成済み＋形成中）
 *
 * 設計思想:
 * - 目的: チャートパターンを検出し、統計的に信頼性の高いデータを提供
 * - 特徴: swingDepth パラメータによる厳密なスイング検出でパターン品質を重視
 * - ブレイク検出: ATR * 0.5 バッファ、最初の明確なブレイクで終点を確定
 * - 用途: 「過去の成功率は？」「典型的な期間は？」「aftermath は？」
 *
 * オプション:
 * - includeCompleted: true (デフォルト) → 完成済みパターンを検出
 * - includeForming: true → 形成中パターンも検出（早期警告向け）
 */

type DetectIn = typeof DetectPatternsInputSchema extends { _type: infer T } ? T : any;

export default async function detectPatterns(
  pair: string = 'btc_jpy',
  type: string = '1day',
  limit: number = 90,
  opts: Partial<{
    swingDepth: number;
    tolerancePct: number;
    minBarsBetweenSwings: number;
    strictPivots: boolean;
    patterns: Array<typeof PatternTypeEnum._type>;
    requireCurrentInPattern: boolean;
    currentRelevanceDays: number;
    // 統合オプション
    includeForming: boolean;
    includeCompleted: boolean;
    includeInvalid: boolean;
    view: 'summary' | 'detailed' | 'full' | 'debug';
  }> = {}
) {
  try {
    // --- パラメータ解決（patterns/config.ts から） ---
    const { swingDepth, tolerancePct, minBarsBetweenSwings: minDist, autoScaled } = resolveParams(type, opts);
    const strictPivots = (opts as any)?.strictPivots !== false; // 既定: 厳格
    // 統合オプション
    const includeForming = opts.includeForming ?? false;
    const includeCompleted = opts.includeCompleted ?? true;
    const includeInvalid = opts.includeInvalid ?? false;
    const want = new Set(opts.patterns || []);
    // 'triangle' が指定された場合は3種を含む互換挙動
    if (want.has('triangle')) {
      want.add('triangle_ascending' as any);
      want.add('triangle_descending' as any);
      want.add('triangle_symmetrical' as any);
    }

    const res = await analyzeIndicators(pair, type as any, limit);
    if (!res?.ok) return DetectPatternsOutputSchema.parse(fail(res.summary || 'failed', 'internal')) as any;

    const candles = res.data.chart.candles as Array<{ open: number; close: number; high: number; low: number; isoTime?: string }>;
    if (!Array.isArray(candles) || candles.length < 20) {
      return DetectPatternsOutputSchema.parse(ok('insufficient data', { patterns: [] }, { pair, type, count: 0 })) as any;
    }

    // 1) Swing points（patterns/swing.ts から）
    const pivots = detectSwingPoints(candles as Candle[], { swingDepth, strictPivots });

    // debug buffers
    const debugSwings = pivots.map(p => ({ idx: p.idx, price: p.price, kind: p.kind, isoTime: (candles[p.idx] as any)?.isoTime }));
    const debugCandidates: CandDebugEntry[] = [];

    // --- 共有コンテキスト構築 ---
    const ctx: DetectContext = {
      candles,
      pivots,
      allPeaks: filterPeaks(pivots),
      allValleys: filterValleys(pivots),
      tolerancePct,
      minDist,
      want,
      includeForming,
      debugCandidates,
      type,
      swingDepth,
      near: (a: number, b: number) => nearFn(a, b, tolerancePct),
      pct: pctFn,
      lrWithR2: linearRegressionWithR2,
    };

    // --- 各パターン検出を実行 ---
    let patterns: any[] = [];

    // 2) Double top/bottom
    const doubles = detectDoubles(ctx);
    patterns.push(...doubles.patterns);

    // 3) Head & Shoulders
    const hs = detectHeadAndShoulders(ctx);
    patterns.push(...hs.patterns);

    // 4) Triangles
    const triangles = detectTriangles(ctx);
    patterns.push(...triangles.patterns);

    // 4b-4d) Wedges
    const wedges = detectWedges(ctx);
    patterns.push(...wedges.patterns);

    // 5) Pennant & Flag + global dedup
    const pennants = detectPennantsFlags(ctx);
    patterns.push(...pennants.patterns);

    // 6) Triple Top / Triple Bottom
    const triples = detectTriples(ctx);
    patterns.push(...triples.patterns);

    // Optional filter: only patterns whose end is within N days from now (current relevance)
    {
      const requireCurrent = !!opts.requireCurrentInPattern;
      const defaultDaysByType = (tf: string): number => {
        if (tf === '1month') return 60; // ~2 months
        if (tf === '1week') return 21;  // ~3 weeks
        return 7; // default for daily and intraday
      };
      const maxAgeDays = Number.isFinite(opts.currentRelevanceDays as any)
        ? Number(opts.currentRelevanceDays)
        : defaultDaysByType(String(type));
      if (requireCurrent && patterns.length) {
        const nowMs = Date.now();
        const inDays = (iso?: string) => {
          if (!iso) return Infinity;
          const t = Date.parse(iso);
          if (!Number.isFinite(t)) return Infinity;
          return Math.abs(nowMs - t) / 86400000;
        };
        patterns = patterns.filter((p: any) => inDays(p?.range?.end) <= maxAgeDays);
      }
    }

    // Aftermath analysis + statistics（patterns/aftermath.ts へ抽出済み）
    const { statistics } = buildStatistics(patterns, candles);

    // includeForming / includeCompleted に基づくフィルタリング
    let filteredPatterns = patterns;
    if (!includeForming || !includeCompleted) {
      filteredPatterns = patterns.filter((p: any) => {
        const isForming = p.status === 'forming' || p.status === 'near_completion';
        const isCompleted = p.status === 'completed' || p.status === 'invalid' || !p.status;
        if (includeForming && isForming) return true;
        if (includeCompleted && isCompleted) return true;
        return false;
      });
    }
    // includeInvalid に基づくフィルタリング
    if (!includeInvalid) {
      filteredPatterns = filteredPatterns.filter((p: any) => p.status !== 'invalid');
    }
    patterns = filteredPatterns;

    // overlays: パターン範囲をそのまま帯描画できるように提供
    const ranges = patterns.map((p: any) => ({ start: p.range.start, end: p.range.end, label: p.type }));
    const warnings: any[] = [];
    if (patterns.length <= 1) {
      warnings.push({ type: 'low_detection_count', message: '検出数が少ないです。tolerancePct や minBarsBetweenSwings の調整を推奨します', suggestedParams: { tolerancePct: 0.03, minBarsBetweenSwings: 2 } });
    }
    // --- サイズ抑制: debug 配列を上限でトリム（view未指定で返却が肥大化しやすいため） ---
    // ただし accepted を優先的に残す（accepted → rejected の順で cap まで）
    const cap = 200;
    const swingsTrimmed = Array.isArray(debugSwings) ? debugSwings.slice(0, cap) : [];
    let candidatesTrimmed: any[] = [];
    if (Array.isArray(debugCandidates)) {
      const acc = debugCandidates.filter((c: any) => !!c?.accepted);
      const rej = debugCandidates.filter((c: any) => !c?.accepted);
      candidatesTrimmed = [...acc, ...rej].slice(0, cap);
    }
    const debugTrimmed = {
      swings: swingsTrimmed,
      candidates: candidatesTrimmed,
    };

    // summary 生成: LLM が content から読み取れるように詳細を含める
    const patternSummaries = patterns.map((p: any, idx: number) => {
      const startDate = p.range?.start?.substring(0, 10) || '?';
      const endDate = p.range?.end?.substring(0, 10) || '?';
      let detail = `${idx + 1}. ${p.type} (パターン整合度: ${p.confidence})\n   - 期間: ${startDate} ~ ${endDate}`;

      // ウェッジパターンの場合、ブレイク情報を追加
      if ((p.type === 'falling_wedge' || p.type === 'rising_wedge') && p.breakoutDirection && p.outcome) {
        const directionJa = p.breakoutDirection === 'up' ? '上方' : '下方';
        const outcomeJa = p.outcome === 'success' ? '成功' : '失敗';
        const expectedDir = p.type === 'falling_wedge' ? '上方' : '下方';
        const meaning = p.type === 'falling_wedge'
          ? (p.outcome === 'success' ? '強気転換' : '弱気継続')
          : (p.outcome === 'success' ? '弱気転換' : '強気継続');

        detail += `\n   - ブレイク方向: ${directionJa}ブレイク（本来は${expectedDir}ブレイクが期待されるパターン）`;
        detail += `\n   - パターン結果: ${outcomeJa}（${meaning}）`;
      }

      // ネックラインがある場合
      if (p.neckline && Array.isArray(p.neckline) && p.neckline.length >= 2) {
        detail += `\n   - ネックライン: ${Math.round(p.neckline[0]?.y || 0).toLocaleString()}円 → ${Math.round(p.neckline[1]?.y || 0).toLocaleString()}円`;
      }

      return detail;
    }).join('\n\n');

    // aftermath 統計をテキストに含める（LLM が structuredContent.data を読めない対策）
    const statsText = statistics && Object.keys(statistics).length > 0
      ? '\n\n【統計情報】\n' + Object.entries(statistics).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
      : '';
    const summaryText = `${pair.toUpperCase()} [${type}] ${limit}本から${patterns.length}件を検出（${patterns.map((p: any) => p.type).join('×1、')}×1）\n\n【検出パターン（全件）】\n${patternSummaries || 'なし'}${statsText}\n\nチャート連携: data.overlays を render_chart_svg.overlays に渡すと注釈/範囲を描画できます。\n\nパターン整合度について（形状一致度・対称性・期間から算出）:\n  0.8以上 = 理想的な形状（教科書的パターン）\n  0.7-0.8 = 標準的な形状（他指標と併用推奨）\n  0.6-0.7 = やや不明瞭（慎重に判断）\n  0.6未満 = 形状不十分`;

    const out = ok(
      summaryText,
      { patterns, overlays: { ranges }, warnings, statistics },
      {
        pair,
        type,
        count: patterns.length,
        effective_params: { swingDepth, minBarsBetweenSwings: minDist, tolerancePct, autoScaled },
        visualization_hints: { preferred_style: 'line', highlight_patterns: patterns.map((p: any) => p.type).slice(0, 3) },
        debug: debugTrimmed
      }
    );
    return DetectPatternsOutputSchema.parse(out) as any;
  } catch (e: unknown) {
    return failFromError(e, { schema: DetectPatternsOutputSchema }) as any;
  }
}
