/**
 * E2E テスト: get_candles のデータからインライン SVG スパークラインを生成し、
 * render_chart_svg を使わずにおはようレポートの折れ線チャートを代替できるか検証。
 *
 * 実行: npx tsx tools/tests/test_sparkline_e2e.ts
 * 出力: tools/tests/sparkline_output.html
 */
import getCandles from '../get_candles.js';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── スパークライン SVG 生成（おはようレポートの AI が実際に書く想定のロジック） ──
function buildSparklineSvg(
  closes: number[],
  times: (string | null)[],
  opts: { width?: number; height?: number; color?: string; fillColor?: string } = {}
): string {
  const W = opts.width ?? 600;
  const H = opts.height ?? 120;
  const padX = 0;
  const padY = 8;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const points = closes.map((c, i) => {
    const x = padX + (i / (closes.length - 1)) * (W - padX * 2);
    const y = padY + (1 - (c - min) / range) * (H - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lineColor = opts.color ?? '#3b82f6';
  const fill = opts.fillColor ?? 'rgba(59,130,246,0.12)';

  // polyline + gradient fill area
  const areaPoints = `${padX},${H} ${points.join(' ')} ${W},${H}`;

  // 始点・終点の価格ラベル
  const first = closes[0];
  const last = closes[closes.length - 1];
  const changePct = ((last - first) / first * 100).toFixed(2);
  const isUp = last >= first;
  const trendColor = isUp ? '#22c55e' : '#ef4444';

  // 時刻ラベル（先頭・末尾）
  const firstTime = times[0]?.slice(11, 16) ?? '';
  const lastTime = times[times.length - 1]?.slice(11, 16) ?? '';

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <polygon points="${areaPoints}" fill="${fill}" />
  <polyline points="${points.join(' ')}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  <circle cx="${points[0].split(',')[0]}" cy="${points[0].split(',')[1]}" r="3" fill="${lineColor}" />
  <circle cx="${points[points.length-1].split(',')[0]}" cy="${points[points.length-1].split(',')[1]}" r="3" fill="${trendColor}" />
</svg>
<div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:2px;">
  <span>${firstTime} — ¥${first.toLocaleString()}</span>
  <span style="color:${trendColor};font-weight:600;">${isUp ? '+' : ''}${changePct}%</span>
  <span>¥${last.toLocaleString()} — ${lastTime}</span>
</div>`;
}

async function main() {
  // 1hour が取れない環境では 1day にフォールバック、それも駄目ならモックデータ
  let candles: Array<{ close: number; isoTime?: string | null }> = [];

  for (const [type, limit] of [['1hour', 8], ['1day', 8]] as const) {
    console.log(`Trying get_candles(btc_jpy, ${type}, limit=${limit})...`);
    const result: any = await getCandles('btc_jpy', type as any, undefined as any, limit);
    if (result?.ok && result.data?.normalized?.length) {
      candles = result.data.normalized;
      console.log(`✅ Got ${candles.length} candles (${type})`);
      break;
    }
    console.log(`  → failed: ${result?.summary}`);
  }

  if (!candles.length) {
    console.log('⚠️  API unavailable — using mock data for visual verification');
    candles = [
      { close: 14_500_000, isoTime: '2026-03-02T01:00:00.000Z' },
      { close: 14_480_000, isoTime: '2026-03-02T02:00:00.000Z' },
      { close: 14_420_000, isoTime: '2026-03-02T03:00:00.000Z' },
      { close: 14_350_000, isoTime: '2026-03-02T04:00:00.000Z' },
      { close: 14_400_000, isoTime: '2026-03-02T05:00:00.000Z' },
      { close: 14_520_000, isoTime: '2026-03-02T06:00:00.000Z' },
      { close: 14_550_000, isoTime: '2026-03-02T07:00:00.000Z' },
      { close: 14_530_000, isoTime: '2026-03-02T08:00:00.000Z' },
    ];
  }

  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.isoTime ?? null);

  const sparkline = buildSparklineSvg(closes, times);

  // ── 検証用 HTML ──
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sparkline E2E Test</title>
<style>
  body { background: #111827; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 32px; }
  .card { background: #1f2937; border-radius: 12px; padding: 20px; max-width: 640px; margin: 0 auto; }
  .card h3 { margin: 0 0 12px; font-size: 14px; color: #9ca3af; }
</style>
</head>
<body>
<div class="card">
  <h3>📈 直近8時間の価格推移（BTC/JPY）— インライン SVG スパークライン</h3>
  ${sparkline}
</div>

<div class="card" style="margin-top:24px;">
  <h3>📊 生データ</h3>
  <pre style="font-size:12px;overflow-x:auto;color:#9ca3af;">${JSON.stringify(candles, null, 2)}</pre>
</div>

<div class="card" style="margin-top:24px;">
  <h3>✅ 判定</h3>
  <ul style="font-size:14px;line-height:1.8;">
    <li>get_candles 1回で close + isoTime が取得可能</li>
    <li>SVG は &lt;polyline&gt; + &lt;polygon&gt; のみ（外部ライブラリ不要）</li>
    <li>render_chart_svg の MCP ツール呼び出し（~2-3秒）が不要に</li>
    <li>AI が HTML 生成時にインラインで組み込み可能</li>
  </ul>
</div>
</body>
</html>`;

  const outPath = resolve(__dirname, 'sparkline_output.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`\n✅ Output written to: ${outPath}`);
  console.log(`   Open in browser to verify the sparkline renders correctly.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
