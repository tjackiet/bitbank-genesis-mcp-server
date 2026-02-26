/**
 * patterns/smoothing.ts - 価格データのノイズ除去フィルタ
 *
 * Savitzky-Golay フィルタを実装。
 * TradingPatternScanner (white07S) のアプローチを参考に、
 * ピボット検出前にhigh/lowデータを平滑化し、誤ピボットを削減する。
 *
 * 参考:
 * - savgol_filter(series, window_length, polyorder=2)
 * - ウェーブレット系は依存ライブラリが重いため SG に絞る
 */

/**
 * Savitzky-Golay フィルタの畳み込み係数を計算する。
 *
 * 最小二乗多項式フィッティングに基づくFIRフィルタ。
 * scipy.signal.savgol_filter と同等のロジック。
 *
 * @param windowSize - ウィンドウ幅（奇数）
 * @param polyOrder  - 多項式の次数（windowSize > polyOrder）
 * @returns 畳み込み係数の配列（長さ = windowSize）
 */
function savgolCoefficients(windowSize: number, polyOrder: number): number[] {
  const m = Math.floor(windowSize / 2);
  const order = polyOrder;

  // Vandermonde行列 J を構築 (windowSize × (order+1))
  // J[i][j] = (i - m)^j  (i = 0..windowSize-1, j = 0..order)
  const rows = windowSize;
  const cols = order + 1;

  // J^T * J を計算（cols × cols の正規方程式行列）
  const JtJ: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  for (let j1 = 0; j1 < cols; j1++) {
    for (let j2 = j1; j2 < cols; j2++) {
      let sum = 0;
      for (let i = 0; i < rows; i++) {
        const x = i - m;
        sum += Math.pow(x, j1) * Math.pow(x, j2);
      }
      JtJ[j1][j2] = sum;
      JtJ[j2][j1] = sum;
    }
  }

  // (J^T * J)^{-1} を Gauss-Jordan 法で求める
  const aug: number[][] = JtJ.map((row, i) => {
    const extended = new Array(2 * cols).fill(0);
    for (let j = 0; j < cols; j++) extended[j] = row[j];
    extended[cols + i] = 1;
    return extended;
  });

  for (let col = 0; col < cols; col++) {
    // ピボット選択
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < cols; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-15) continue;

    for (let j = 0; j < 2 * cols; j++) aug[col][j] /= pivot;

    for (let row = 0; row < cols; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * cols; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // 逆行列を抽出
  const inv: number[][] = aug.map(row => row.slice(cols));

  // 係数 = (J^T J)^{-1} J^T の第0行（平滑化＝0次の係数）
  // c[i] = sum_j inv[0][j] * (i - m)^j
  const coeffs = new Array(windowSize).fill(0);
  for (let i = 0; i < windowSize; i++) {
    const x = i - m;
    let val = 0;
    for (let j = 0; j < cols; j++) {
      val += inv[0][j] * Math.pow(x, j);
    }
    coeffs[i] = val;
  }

  return coeffs;
}

/**
 * Savitzky-Golay フィルタを1次元配列に適用する。
 *
 * @param data       - 入力データ
 * @param windowSize - ウィンドウ幅（奇数, デフォルト 5）
 * @param polyOrder  - 多項式次数（デフォルト 2 = 2次多項式）
 * @returns 平滑化されたデータ（元と同じ長さ）
 */
export function savgolFilter(
  data: number[],
  windowSize: number = 5,
  polyOrder: number = 2,
): number[] {
  const n = data.length;
  if (n === 0) return [];

  // ウィンドウサイズを奇数に強制
  let ws = Math.max(3, windowSize);
  if (ws % 2 === 0) ws += 1;
  // polyOrder < windowSize を保証
  const po = Math.min(polyOrder, ws - 1);

  if (n < ws) {
    // データがウィンドウより短い場合はそのまま返す
    return [...data];
  }

  const coeffs = savgolCoefficients(ws, po);
  const half = Math.floor(ws / 2);
  const result = new Array(n);

  // 中央部分: 畳み込み
  for (let i = half; i < n - half; i++) {
    let sum = 0;
    for (let j = 0; j < ws; j++) {
      sum += coeffs[j] * data[i - half + j];
    }
    result[i] = sum;
  }

  // 端の処理: 元データをそのまま使用（境界効果の回避）
  for (let i = 0; i < half; i++) {
    result[i] = data[i];
  }
  for (let i = n - half; i < n; i++) {
    result[i] = data[i];
  }

  return result;
}

/**
 * ローソク足の high/low 系列にSGフィルタを適用する。
 * 元のローソク足データは変更せず、平滑化された high/low 配列を返す。
 *
 * @param candles - ローソク足データ
 * @param windowSize - SGフィルタのウィンドウ幅（奇数）
 * @param polyOrder  - 多項式次数
 * @returns { smoothHigh, smoothLow } 平滑化されたhigh/low配列
 */
export function smoothCandleExtremes(
  candles: Array<{ high: number; low: number }>,
  windowSize: number = 5,
  polyOrder: number = 2,
): { smoothHigh: number[]; smoothLow: number[] } {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  return {
    smoothHigh: savgolFilter(highs, windowSize, polyOrder),
    smoothLow: savgolFilter(lows, windowSize, polyOrder),
  };
}
