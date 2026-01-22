/**
 * strategies/index.ts - 戦略レジストリ
 */

import type { Strategy, StrategyType, StrategyRegistry } from './types.js';
import { smaCrossStrategy } from './sma_cross.js';
import { rsiStrategy } from './rsi.js';
import { macdCrossStrategy } from './macd_cross.js';
import { bbBreakoutStrategy } from './bb_breakout.js';

/**
 * 戦略レジストリ
 */
const registry: StrategyRegistry = new Map<StrategyType, Strategy>();

// 戦略を登録
registry.set('sma_cross', smaCrossStrategy);
registry.set('rsi', rsiStrategy);
registry.set('macd_cross', macdCrossStrategy);
registry.set('bb_breakout', bbBreakoutStrategy);

/**
 * 戦略を取得
 */
export function getStrategy(type: StrategyType): Strategy | undefined {
  return registry.get(type);
}

/**
 * 利用可能な戦略タイプを取得
 */
export function getAvailableStrategies(): StrategyType[] {
  return Array.from(registry.keys());
}

/**
 * 戦略を登録
 */
export function registerStrategy(strategy: Strategy): void {
  registry.set(strategy.type, strategy);
}

/**
 * 戦略のデフォルトパラメータを取得
 */
export function getStrategyDefaults(type: StrategyType): Record<string, number> | undefined {
  const strategy = registry.get(type);
  return strategy?.defaultParams;
}

export { smaCrossStrategy, rsiStrategy, macdCrossStrategy, bbBreakoutStrategy };
export * from './types.js';
