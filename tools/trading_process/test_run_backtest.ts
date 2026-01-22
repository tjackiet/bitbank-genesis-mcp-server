/**
 * test_run_backtest.ts - 汎用バックテストのテスト
 * 
 * 使用法:
 *   npx tsx tools/trading_process/test_run_backtest.ts [strategy_type]
 * 
 * 例:
 *   npx tsx tools/trading_process/test_run_backtest.ts sma_cross
 *   npx tsx tools/trading_process/test_run_backtest.ts rsi
 *   npx tsx tools/trading_process/test_run_backtest.ts macd_cross
 *   npx tsx tools/trading_process/test_run_backtest.ts bb_breakout
 */

import runBacktest from './run_backtest.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const strategyType = process.argv[2] || 'sma_cross';
  
  // 戦略ごとのデフォルトパラメータ
  const strategyConfigs: Record<string, { type: string; params: Record<string, number> }> = {
    sma_cross: { type: 'sma_cross', params: { short: 5, long: 20 } },
    rsi: { type: 'rsi', params: { period: 14, overbought: 70, oversold: 30 } },
    macd_cross: { type: 'macd_cross', params: { fast: 12, slow: 26, signal: 9 } },
    bb_breakout: { type: 'bb_breakout', params: { period: 20, stddev: 2 } },
  };

  const config = strategyConfigs[strategyType];
  if (!config) {
    console.error(`Unknown strategy: ${strategyType}`);
    console.error(`Available: ${Object.keys(strategyConfigs).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n=== Testing ${strategyType} strategy ===\n`);
  console.log('Input:', JSON.stringify({
    pair: 'btc_jpy',
    period: '3M',
    strategy: config,
  }, null, 2));

  const result = await runBacktest({
    pair: 'btc_jpy',
    period: '3M',
    strategy: config as any,
    savePng: false,   // ローカルテストでは PNG 不要
    includeSvg: true, // SVG を返す
  });

  if (!result.ok) {
    console.error('\nError:', result.error);
    if ('availableStrategies' in result) {
      console.error('Available strategies:', result.availableStrategies);
    }
    process.exit(1);
  }

  console.log('\n' + result.summary);

  // SVGをファイルに保存
  if (result.svg) {
    const outputPath = join(__dirname, '..', '..', 'assets', `backtest_${strategyType}_test.svg`);
    writeFileSync(outputPath, result.svg);
    console.log(`\nSVG saved to: ${outputPath}`);
    console.log(`\nOpen with: open ${outputPath}`);
  }
}

main().catch(console.error);
