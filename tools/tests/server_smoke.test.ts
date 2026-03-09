import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PROMPT } from '../../src/system-prompt.js';

const runtime = vi.hoisted(() => ({
  toolDefs: [] as any[],
  promptDefs: [] as any[],
  serverInstances: [] as any[],
  stdioTransports: [] as any[],
  httpTransports: [] as any[],
  logToolRun: vi.fn(),
  logError: vi.fn(),
  expressFactory: vi.fn(),
  expressJson: vi.fn(),
  expressApp: null as any,
  httpMiddleware: { kind: 'http-middleware' } as any,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class FakeMcpServer {
    info: any;
    tools: Array<{ name: string; options: any; handler: (input: any) => Promise<any> }>;
    prompts: Array<{ name: string; options: any; handler: () => any }>;
    requestHandlers: Record<string, (request?: any) => Promise<any> | any>;
    connections: any[];

    constructor(info: any) {
      this.info = info;
      this.tools = [];
      this.prompts = [];
      this.requestHandlers = {};
      this.connections = [];
      runtime.serverInstances.push(this);
    }

    registerTool(name: string, options: any, handler: (input: any) => Promise<any>) {
      this.tools.push({ name, options, handler });
    }

    registerPrompt(name: string, options: any, handler: () => any) {
      this.prompts.push({ name, options, handler });
    }

    setRequestHandler(name: string, handler: (request?: any) => Promise<any> | any) {
      this.requestHandlers[name] = handler;
    }

    async connect(transport: any) {
      this.connections.push(transport);
    }
  }

  return { McpServer: FakeMcpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class FakeStdioServerTransport {
    kind = 'stdio';

    constructor() {
      runtime.stdioTransports.push(this);
    }
  }

  return { StdioServerTransport: FakeStdioServerTransport };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  class FakeStreamableHTTPServerTransport {
    kind = 'http';
    options: any;

    constructor(options: any) {
      this.options = options;
      runtime.httpTransports.push(this);
    }

    expressMiddleware() {
      return runtime.httpMiddleware;
    }
  }

  return { StreamableHTTPServerTransport: FakeStreamableHTTPServerTransport };
});

vi.mock('../../lib/logger.js', () => ({
  logToolRun: runtime.logToolRun,
  logError: runtime.logError,
}));

vi.mock('express', () => {
  const express = runtime.expressFactory as any;
  express.json = runtime.expressJson;
  return { default: express };
});

vi.mock('../../src/prompts.js', () => ({
  get prompts() {
    return runtime.promptDefs;
  },
}));

vi.mock('../../src/tool-registry.js', async () => {
  const { z } = await import('zod');

  if (!runtime.toolDefs.length) {
    runtime.toolDefs = [
      {
        name: 'smoke_tool',
        description: 'Default smoke tool',
        inputSchema: z.object({
          pair: z.string().regex(/^[a-z_]+$/),
          limit: z.number().default(5),
          verbose: z.boolean().optional(),
        }),
        handler: vi.fn(async () => ({ summary: 'default ok', ok: true })),
      },
    ];
  }

  return {
    get allToolDefs() {
      return runtime.toolDefs;
    },
  };
});

const originalEnv = { ...process.env };

function resetRuntime() {
  runtime.toolDefs = [];
  runtime.promptDefs = [
    {
      name: 'smoke_prompt',
      description: 'Smoke prompt description',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'system instruction' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'assistant note' },
            { type: 'tool_code', tool_name: 'get_ticker', tool_input: { pair: 'btc_jpy' } },
          ],
        },
      ],
    },
  ];
  runtime.serverInstances = [];
  runtime.stdioTransports = [];
  runtime.httpTransports = [];
  runtime.logToolRun.mockReset();
  runtime.logError.mockReset();
  runtime.expressApp = {
    use: vi.fn(),
    listen: vi.fn((port: number, callback?: () => void) => {
      callback?.();
      return { port };
    }),
  };
  runtime.expressFactory.mockReset();
  runtime.expressFactory.mockImplementation(() => runtime.expressApp);
  runtime.expressJson.mockReset();
  runtime.expressJson.mockReturnValue({ kind: 'json-middleware' });
  runtime.httpMiddleware = { kind: 'http-middleware' };
}

async function importServer() {
  vi.resetModules();
  await import('../../src/server.js');
  return runtime.serverInstances.at(-1);
}

describe('server.ts smoke', () => {
  beforeEach(() => {
    resetRuntime();
    process.env = { ...originalEnv };
    delete process.env.MCP_ENABLE_HTTP;
    delete process.env.PORT;
    delete process.env.ALLOWED_HOSTS;
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('起動時にツール・prompt・fallback handlers を登録する', async () => {
    const { z } = await import('zod');

    runtime.toolDefs = [
      {
        name: 'smoke_tool',
        description: 'Smoke tool description',
        inputSchema: z.object({
          pair: z.string().regex(/^[a-z_]+$/),
          limit: z.number().default(5),
          includeMeta: z.boolean().optional(),
        }),
        handler: vi.fn(async () => ({ summary: 'ok', ok: true })),
      },
      {
        name: 'second_tool',
        description: 'Second tool description',
        inputSchema: z.object({
          enabled: z.boolean(),
        }),
        handler: vi.fn(async () => ({ summary: 'ok2', ok: true })),
      },
    ];

    const server = await importServer();

    expect(server.info).toEqual({ name: 'bitbank-mcp', version: '0.4.2' });
    expect(server.tools.map((tool: any) => tool.name)).toEqual(['smoke_tool', 'second_tool']);
    expect(server.prompts.map((prompt: any) => prompt.name)).toEqual(['smoke_prompt']);
    expect(Object.keys(server.requestHandlers)).toEqual(
      expect.arrayContaining(['tools/list', 'prompts/list', 'prompts/get', 'resources/list', 'resources/read'])
    );
    expect(server.connections).toHaveLength(1);
    expect(server.connections[0].kind).toBe('stdio');
    expect(runtime.stdioTransports).toHaveLength(1);
  });

  it('tools/list・prompts/list・prompts/get・resources/read の fallback を返す', async () => {
    const { z } = await import('zod');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      runtime.toolDefs = [
        {
          name: 'smoke_tool',
          description: 'Smoke tool description',
          inputSchema: z.object({
            pair: z.string().regex(/^[a-z_]+$/),
            limit: z.number().default(5),
            enabled: z.boolean(),
            note: z.string().optional(),
          }),
          handler: vi.fn(async () => ({ summary: 'ok', ok: true })),
        },
      ];

      const server = await importServer();

      const toolsList = await server.requestHandlers['tools/list']();
      expect(toolsList.tools).toHaveLength(1);
      expect(toolsList.tools[0]).toMatchObject({
        name: 'smoke_tool',
        description: 'Smoke tool description',
        inputSchema: {
          type: 'object',
          properties: {
            pair: { type: 'string', pattern: '^[a-z_]+$' },
            limit: { type: 'number', default: 5 },
            enabled: { type: 'boolean' },
            note: { type: 'string' },
          },
          required: ['pair', 'enabled'],
        },
      });

      const promptsList = await server.requestHandlers['prompts/list']();
      expect(promptsList.prompts).toEqual([{ name: 'smoke_prompt', description: 'Smoke prompt description' }]);

      const registeredPrompt = server.prompts[0];
      const promptRegistration = registeredPrompt.handler();
      expect(promptRegistration.messages).toEqual([
        { role: 'user', content: { type: 'text', text: 'system instruction' } },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: 'assistant note\nCall get_ticker with {"pair":"btc_jpy"}',
          },
        },
      ]);

      const promptGet = await server.requestHandlers['prompts/get']({ params: { name: 'smoke_prompt' } });
      expect(promptGet.description).toBe('Smoke prompt description');
      expect(promptGet.messages).toEqual([
        { role: 'user', content: { type: 'text', text: 'system instruction' } },
        { role: 'assistant', content: { type: 'text', text: 'assistant note' } },
      ]);

      const resourcesList = await server.requestHandlers['resources/list']();
      expect(resourcesList.resources).toEqual([
        {
          uri: 'prompt://system',
          name: 'test-bb System Prompt',
          description: 'System-level guidance for using test-bb MCP server',
          mimeType: 'text/plain',
        },
      ]);

      const resourceRead = await server.requestHandlers['resources/read']({ params: { uri: 'prompt://system' } });
      expect(resourceRead.contents).toEqual([
        {
          uri: 'prompt://system',
          mimeType: 'text/plain',
          text: SYSTEM_PROMPT,
        },
      ]);

      await expect(server.requestHandlers['prompts/get']({ params: { name: 'missing_prompt' } })).rejects.toThrow(
        'Prompt not found: missing_prompt'
      );
      await expect(server.requestHandlers['resources/read']({ params: { uri: 'prompt://missing' } })).rejects.toThrow(
        'Resource not found: prompt://missing'
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('tool 実行の success と error を整形し logger を呼ぶ', async () => {
    const { z } = await import('zod');

    const successHandler = vi.fn(async () => ({
      content: [{ type: 'text', text: 'preferred text' }],
      summary: 'ignored summary',
      ok: true,
      data: { value: 1 },
    }));
    const errorHandler = vi.fn(async () => {
      throw new Error('boom');
    });

    runtime.toolDefs = [
      {
        name: 'success_tool',
        description: 'Success tool',
        inputSchema: z.object({ pair: z.string() }),
        handler: successHandler,
      },
      {
        name: 'error_tool',
        description: 'Error tool',
        inputSchema: z.object({ pair: z.string() }),
        handler: errorHandler,
      },
    ];

    const server = await importServer();

    const successResult = await server.tools[0].handler({ pair: 'btc_jpy' });
    expect(successResult).toEqual({
      content: [{ type: 'text', text: 'preferred text' }],
      structuredContent: {
        content: [{ type: 'text', text: 'preferred text' }],
        summary: 'ignored summary',
        ok: true,
        data: { value: 1 },
      },
    });
    expect(runtime.logToolRun).toHaveBeenCalledTimes(1);
    expect(runtime.logToolRun.mock.calls[0][0]).toMatchObject({
      tool: 'success_tool',
      input: { pair: 'btc_jpy' },
      ms: expect.any(Number),
    });

    const errorResult = await server.tools[1].handler({ pair: 'eth_jpy' });
    expect(errorResult).toEqual({
      content: [{ type: 'text', text: 'internal error: boom' }],
      structuredContent: {
        ok: false,
        summary: 'internal error: boom',
        meta: {
          ms: expect.any(Number),
          errorType: 'internal',
        },
      },
    });
    expect(runtime.logError).toHaveBeenCalledTimes(1);
    expect(runtime.logError).toHaveBeenCalledWith('error_tool', expect.any(Error), { pair: 'eth_jpy' });
  });

  it('HTTP 有効時は HTTP transport と express を初期化する', async () => {
    const { z } = await import('zod');

    runtime.toolDefs = [
      {
        name: 'smoke_tool',
        description: 'Smoke tool description',
        inputSchema: z.object({ pair: z.string() }),
        handler: vi.fn(async () => ({ summary: 'ok', ok: true })),
      },
    ];
    process.env.MCP_ENABLE_HTTP = '1';
    process.env.PORT = '3010';
    process.env.ALLOWED_HOSTS = '127.0.0.1,localhost,example.com';
    process.env.ALLOWED_ORIGINS = 'https://example.com';

    const server = await importServer();

    expect(server.connections).toHaveLength(2);
    expect(server.connections[0].kind).toBe('stdio');
    expect(server.connections[1].kind).toBe('http');
    expect(runtime.httpTransports).toHaveLength(1);
    expect(runtime.httpTransports[0].options).toMatchObject({
      path: '/mcp',
      enableDnsRebindingProtection: true,
      allowedHosts: ['127.0.0.1', 'localhost', 'example.com'],
      allowedOrigins: ['https://example.com'],
    });
    expect(typeof runtime.httpTransports[0].options.sessionIdGenerator).toBe('function');
    expect(runtime.expressFactory).toHaveBeenCalledTimes(1);
    expect(runtime.expressJson).toHaveBeenCalledTimes(1);
    expect(runtime.expressApp.use).toHaveBeenNthCalledWith(1, { kind: 'json-middleware' });
    expect(runtime.expressApp.use).toHaveBeenNthCalledWith(2, runtime.httpMiddleware);
    expect(runtime.expressApp.listen).toHaveBeenCalledWith(3010, expect.any(Function));
  });
});
