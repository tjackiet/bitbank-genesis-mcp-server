import getTickersJpy from '../tools/get_tickers_jpy.js';
import { runCli } from './cli-utils.js';

runCli(() => getTickersJpy());
