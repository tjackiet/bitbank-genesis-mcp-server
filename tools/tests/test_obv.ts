/**
 * OBV (On-Balance Volume) unit test — fixed-value hand-calculation verification.
 *
 * OBV rules:
 * - close > prev_close → OBV += volume
 * - close < prev_close → OBV -= volume
 * - close == prev_close → OBV unchanged
 */
import { computeOBV } from '../analyze_indicators.js';
import type { Candle } from '../../src/types/domain.d.ts';

function makeCandle(close: number, volume: number, open = close, high = close, low = close): Candle {
  return { open, high, low, close, volume };
}

function assertApprox(actual: number | null, expected: number, label: string, tolerance = 0.01) {
  if (actual == null) throw new Error(`${label}: expected ~${expected}, got null`);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected} ±${tolerance}, got ${actual}`);
  }
}

function assertNull(actual: any, label: string) {
  if (actual != null) throw new Error(`${label}: expected null, got ${actual}`);
}

// Test 1: Insufficient data (< 2 candles) → null
function testInsufficientData() {
  const result = computeOBV([makeCandle(100, 10)]);
  assertNull(result.obv, 'insufficient_obv');
  assertNull(result.obvSma, 'insufficient_sma');
  console.log('  PASS: insufficient data returns null');
}

// Test 2: Hand-calculated OBV
// Candles:  close=[100, 105, 103, 108, 108]  volume=[10, 20, 15, 25, 30]
// OBV:     [0,  +20, +20-15=5, 5+25=30, 30(unchanged)]  = [0, 20, 5, 30, 30]
function testHandCalculation() {
  const candles = [
    makeCandle(100, 10),
    makeCandle(105, 20),  // up → +20
    makeCandle(103, 15),  // down → -15
    makeCandle(108, 25),  // up → +25
    makeCandle(108, 30),  // equal → 0
  ];
  const result = computeOBV(candles, 20);
  assertApprox(result.obv, 30, 'hand_obv');
  assertApprox(result.prevObv!, 30, 'hand_prevObv'); // candle[3] OBV = 30
  // SMA20 is null (only 5 candles)
  assertNull(result.obvSma, 'hand_sma_null');
  console.log('  PASS: hand calculation matches');
}

// Test 3: All prices going up → OBV should be sum of all volumes (except first)
function testAllUp() {
  const candles = [];
  for (let i = 0; i < 30; i++) {
    candles.push(makeCandle(100 + i, 10));
  }
  const result = computeOBV(candles, 20);
  // OBV = 10 * 29 = 290 (each bar adds 10 volume)
  assertApprox(result.obv, 290, 'all_up_obv');
  // SMA(20) should be the average of last 20 OBV values
  if (result.obvSma == null) throw new Error('SMA should be non-null with 30 candles');
  console.log(`  PASS: all up → OBV=${result.obv}, SMA=${result.obvSma}`);
}

// Test 4: All prices going down → OBV should be negative sum
function testAllDown() {
  const candles = [];
  for (let i = 0; i < 30; i++) {
    candles.push(makeCandle(1000 - i, 10));
  }
  const result = computeOBV(candles, 20);
  assertApprox(result.obv, -290, 'all_down_obv');
  console.log(`  PASS: all down → OBV=${result.obv}`);
}

// Test 5: Flat prices → OBV stays at 0
function testFlat() {
  const candles = Array(30).fill(null).map(() => makeCandle(100, 10));
  const result = computeOBV(candles, 20);
  assertApprox(result.obv, 0, 'flat_obv');
  assertApprox(result.obvSma!, 0, 'flat_sma');
  if (result.trend !== 'flat') throw new Error(`expected trend=flat, got ${result.trend}`);
  console.log('  PASS: flat prices → OBV=0, trend=flat');
}

// Test 6: Trend detection (rising)
function testTrendRising() {
  const candles = [];
  // First 20 candles flat to establish SMA baseline
  for (let i = 0; i < 20; i++) candles.push(makeCandle(100, 10));
  // Next 10 candles all up with high volume → OBV rises above SMA
  for (let i = 0; i < 10; i++) candles.push(makeCandle(101 + i, 50));
  const result = computeOBV(candles, 20);
  if (result.trend !== 'rising') throw new Error(`expected trend=rising, got ${result.trend}`);
  console.log(`  PASS: rising trend detected (OBV=${result.obv}, SMA=${result.obvSma})`);
}

// Test 7: Trend detection (falling)
function testTrendFalling() {
  const candles = [];
  // First 20 candles slightly up
  for (let i = 0; i < 20; i++) candles.push(makeCandle(100 + i * 0.1, 10));
  // Next 10 candles all down with high volume → OBV drops below SMA
  for (let i = 0; i < 10; i++) candles.push(makeCandle(100 - i, 50));
  const result = computeOBV(candles, 20);
  if (result.trend !== 'falling') throw new Error(`expected trend=falling, got ${result.trend}`);
  console.log(`  PASS: falling trend detected (OBV=${result.obv}, SMA=${result.obvSma})`);
}

async function main() {
  console.log('=== OBV Tests ===');
  try {
    testInsufficientData();
    testHandCalculation();
    testAllUp();
    testAllDown();
    testFlat();
    testTrendRising();
    testTrendFalling();
    console.log('PASS: all OBV tests passed');
  } catch (e) {
    console.error('FAIL:', e);
    process.exit(1);
  }
}

main();
