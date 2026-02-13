import getTransactions from './get_transactions.js';
import { runCli, parseArgs, intArg } from './lib/cli-utils.js';

runCli(() => {
  const { positional } = parseArgs();
  const pair = positional[0] || 'btc_jpy';
  const limit = intArg(positional[1], 100);
  const date = positional[2];
  return getTransactions(pair, limit, date);
});
