import getFlowMetrics from './get_flow_metrics.js';
import { runCli, parseArgs, intArg } from './lib/cli-utils.js';

runCli(() => {
  const { positional } = parseArgs();
  const pair = positional[0] || 'btc_jpy';
  const limit = intArg(positional[1], 100);
  const bucketMs = intArg(positional[2], 60_000);
  const date = positional[3];
  return getFlowMetrics(pair, limit, date, bucketMs);
});
