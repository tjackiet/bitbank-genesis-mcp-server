import getTickersJpy from './get_tickers_jpy.js';
import { runCli } from './lib/cli-utils.js';

runCli(() => getTickersJpy());
