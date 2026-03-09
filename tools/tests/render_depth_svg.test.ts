import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../get_depth.js', () => ({
  default: vi.fn(),
}));

import getDepth from '../get_depth.js';
import renderDepthSvg, { toolDef } from '../render_depth_svg.js';

function depthOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    summary: 'depth ok',
    data: {
      asks: [
        ['101', '0.2'],
        ['102', '0.5'],
      ],
      bids: [
        ['99', '0.3'],
        ['98', '0.4'],
      ],
      ...overrides,
    },
    meta: {},
  };
}

describe('render_depth_svg', () => {
  const mockedGetDepth = vi.mocked(getDepth);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: depth.levels は 10 未満を拒否する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', depth: { levels: 9 } });
    expect(parse).toThrow();
  });

  it('asks/bids が空配列のときは fail を返すべき（現状は ok=true で 0 円チャートを返す）', async () => {
    mockedGetDepth.mockResolvedValueOnce(
      depthOk({
        asks: [],
        bids: [],
      }) as any
    );

    const res: any = await renderDepthSvg({
      pair: 'btc_jpy',
      type: '1day',
      depth: { levels: 10 },
    });

    expect({
      ok: res.ok,
      errorType: res.meta?.errorType ?? null,
      currentPrice: res.data?.summary?.currentPrice ?? null,
      bestBid: res.data?.summary?.bestBid ?? null,
      bestAsk: res.data?.summary?.bestAsk ?? null,
    }).toEqual({
      ok: false,
      errorType: 'upstream',
      currentPrice: null,
      bestBid: null,
      bestAsk: null,
    });
  });

  it('asks が空で bids のみあるときは fail を返すべき（現状は currentPrice を半値で算出する）', async () => {
    mockedGetDepth.mockResolvedValueOnce(
      depthOk({
        asks: [],
        bids: [
          ['100', '1.0'],
          ['99', '2.0'],
        ],
      }) as any
    );

    const res: any = await renderDepthSvg({
      pair: 'btc_jpy',
      type: '1day',
      depth: { levels: 10 },
    });

    expect({
      ok: res.ok,
      errorType: res.meta?.errorType ?? null,
      currentPrice: res.data?.summary?.currentPrice ?? null,
      bestBid: res.data?.summary?.bestBid ?? null,
      bestAsk: res.data?.summary?.bestAsk ?? null,
    }).toEqual({
      ok: false,
      errorType: 'upstream',
      currentPrice: null,
      bestBid: null,
      bestAsk: null,
    });
  });
});
