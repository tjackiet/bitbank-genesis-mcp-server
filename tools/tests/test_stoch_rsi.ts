/**
 * Stochastic RSI unit test — fixed-value verification.
 *
 * Computation steps:
 * 1. Compute RSI(14) from closes
 * 2. Over last stochPeriod(14) RSI values, compute %K = (RSI - RSI_low) / (RSI_high - RSI_low) * 100
 * 3. Smooth rawK with SMA(smoothK=3) → %K
 * 4. Smooth %K with SMA(smoothD=3) → %D
 *
 * We verify:
 * - Null output when data is insufficient
 * - Non-null output with enough data
 * - %K and %D are in [0, 100] range
 * - Known edge case: flat RSI → %K = 50 (range = 0 fallback)
 */
import { computeStochRSI, rsi } from '../analyze_indicators.js';

function assertApprox(actual: number | null, expected: number, label: string, tolerance = 0.5) {
  if (actual == null) throw new Error(`${label}: expected ~${expected}, got null`);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected} ±${tolerance}, got ${actual}`);
  }
}

function assertNull(actual: number | null, label: string) {
  if (actual != null) throw new Error(`${label}: expected null, got ${actual}`);
}

function assertInRange(actual: number | null, min: number, max: number, label: string) {
  if (actual == null) throw new Error(`${label}: expected a number, got null`);
  if (actual < min || actual > max) throw new Error(`${label}: expected [${min}, ${max}], got ${actual}`);
}

// Test 1: Insufficient data → null
function testInsufficientData() {
  const closes = [100, 101, 102, 103, 104]; // only 5 bars
  const result = computeStochRSI(closes);
  assertNull(result.k, 'insufficient_k');
  assertNull(result.d, 'insufficient_d');
  console.log('  PASS: insufficient data returns null');
}

// Test 2: Flat prices → RSI stays around 50 → %K should be 50 (range = 0 fallback)
function testFlatPrices() {
  const closes = Array(100).fill(1000);
  const result = computeStochRSI(closes);
  // When all RSI values are the same, range = 0, so %K = 50 (fallback)
  assertApprox(result.k, 50, 'flat_k', 0.01);
  assertApprox(result.d, 50, 'flat_d', 0.01);
  console.log('  PASS: flat prices → %K=%D=50');
}

// Test 3: Sufficient data with trending prices → valid range
function testTrendingPrices() {
  // Generate uptrend then consolidation
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) {
    closes.push(1000 + i * 10 + Math.sin(i * 0.5) * 50);
  }
  const result = computeStochRSI(closes);
  assertInRange(result.k, 0, 100, 'trending_k');
  assertInRange(result.d, 0, 100, 'trending_d');
  // prevK and prevD should also be available
  assertInRange(result.prevK, 0, 100, 'trending_prevK');
  assertInRange(result.prevD, 0, 100, 'trending_prevD');
  console.log(`  PASS: trending prices → %K=${result.k}, %D=${result.d} (in range)`);
}

// Test 4: Strong uptrend → %K should be high (towards 100)
function testStrongUptrend() {
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) {
    closes.push(1000 + i * 100); // strong consistent uptrend
  }
  const result = computeStochRSI(closes);
  // RSI should be near 100, StochRSI %K should be near 100 too
  assertInRange(result.k, 50, 100, 'uptrend_k');
  console.log(`  PASS: strong uptrend → %K=${result.k} (high)`);
}

// Test 5: Strong downtrend → %K should be low (towards 0)
function testStrongDowntrend() {
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) {
    closes.push(10000 - i * 100); // strong consistent downtrend
  }
  const result = computeStochRSI(closes);
  assertInRange(result.k, 0, 50, 'downtrend_k');
  console.log(`  PASS: strong downtrend → %K=${result.k} (low)`);
}

// Test 6: Verify RSI function consistency — the underlying RSI is used correctly
function testRsiConsistency() {
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) {
    closes.push(1000 + Math.sin(i * 0.3) * 200);
  }
  const rsiSeries = rsi(closes, 14);
  const lastRsi = rsiSeries.at(-1);
  if (lastRsi == null) throw new Error('RSI should not be null with 60 bars');
  assertInRange(lastRsi, 0, 100, 'rsi_range');

  const result = computeStochRSI(closes, 14, 14, 3, 3);
  assertInRange(result.k, 0, 100, 'stoch_k_from_sine');
  assertInRange(result.d, 0, 100, 'stoch_d_from_sine');
  console.log(`  PASS: sine wave → RSI=${lastRsi}, StochRSI %K=${result.k}, %D=${result.d}`);
}

async function main() {
  console.log('=== Stochastic RSI Tests ===');
  try {
    testInsufficientData();
    testFlatPrices();
    testTrendingPrices();
    testStrongUptrend();
    testStrongDowntrend();
    testRsiConsistency();
    console.log('PASS: all Stochastic RSI tests passed');
  } catch (e) {
    console.error('FAIL:', e);
    process.exit(1);
  }
}

main();
