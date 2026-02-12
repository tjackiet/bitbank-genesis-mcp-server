/**
 * CLI ツール共通ユーティリティ
 *
 * 各 CLI ツールの引数パース・結果出力・エラーハンドリングを統一する。
 */

// ---------------------------------------------------------------------------
// 引数パース
// ---------------------------------------------------------------------------

/**
 * process.argv から位置引数とフラグを分離する。
 *
 * 位置引数: `--` で始まらないもの
 * フラグ: `--key` → `{ key: true }`, `--key=val` → `{ key: "val" }`
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex === -1) {
        flags[arg.slice(2)] = true;
      } else {
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

/**
 * 位置引数を整数として取得する。無い場合や NaN の場合は defaultValue を返す。
 */
export function intArg(value: string | undefined, defaultValue: number): number {
  if (value == null) return defaultValue;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

// ---------------------------------------------------------------------------
// CLI ランナー
// ---------------------------------------------------------------------------

/**
 * CLI ツールのエントリポイントを統一的にラップする。
 *
 * - fn が ok フィールドを持つオブジェクトを返す場合: JSON を stdout に出力し、ok でなければ exit(1)
 * - fn が void を返す場合: そのまま終了（report.ts / stat.ts 等）
 * - 例外発生時: stderr にメッセージを出力し exit(1)
 */
export function runCli(
  fn: () => Promise<{ ok: boolean } | void>,
): void {
  fn()
    .then((result) => {
      if (result == null) return; // void 戻り値
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
