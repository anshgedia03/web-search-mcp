#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { createServer } from 'node:http';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

const isValidSearchArgs = (args: any): args is { query: string; limit?: number } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.query === 'string' &&
  (args.limit === undefined || typeof args.limit === 'number');

const coerceLimit = (limit: unknown): number => {
  const fallback = 5;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback;
  const asInt = Math.trunc(limit);
  return Math.min(Math.max(asInt, 1), 10);
};

class WebSearchServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'web-search-sse',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search',
          description: 'Search the web using Google (no API key required)',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 5)',
                minimum: 1,
                maximum: 10,
              },
            },
            required: ['query'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'search') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      if (!isValidSearchArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid search arguments'
        );
      }

      const query = request.params.arguments.query;
      const limit = coerceLimit(request.params.arguments.limit);

      try {
        const results = await this.performSearch(query, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `Search error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  private async performSearch(query: string, limit: number): Promise<SearchResult[]> {
    const searxngUrl = (process.env.SEARXNG_URL || '').trim().replace(/\/+$/, '');
    if (!searxngUrl) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing SEARXNG_URL. Set SEARXNG_URL (e.g. http://127.0.0.1:8080) to enable searching.'
      );
    }

    const response = await axios.get(`${searxngUrl}/search`, {
      params: { q: query, format: 'json' },
      timeout: 15_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'application/json',
      },
    });

    const items = (response.data?.results ?? []) as Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;

    return items
      .filter((r) => typeof r?.title === 'string' && typeof r?.url === 'string')
      .slice(0, limit)
      .map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        description: typeof r.content === 'string' ? r.content : '',
      }));
  }

  async run() {
    const args = process.argv.slice(2);
    const useSse = args.includes('--sse') || process.env.MCP_TRANSPORT === 'sse';
    const portArgIndex = args.findIndex((a) => a === '--port');
    const port =
      portArgIndex >= 0 && args[portArgIndex + 1]
        ? Number(args[portArgIndex + 1])
        : Number(process.env.PORT || process.env.MCP_PORT || 3000);

    if (!useSse) {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Web Search MCP server running on stdio');
      return;
    }

    const transports = new Map<string, SSEServerTransport>();

    const httpServer = createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (req.method === 'GET' && (url.pathname === '/sse' || url.pathname === '/')) {
          const transport = new SSEServerTransport('/message', res);
          transports.set(transport.sessionId, transport);

          const server = new WebSearchServer();
          server.server.onclose = () => transports.delete(transport.sessionId);

          await server.server.connect(transport);
          return;
        }

        if (req.method === 'POST' && url.pathname === '/message') {
          const sessionId = url.searchParams.get('sessionId') || '';
          const transport = transports.get(sessionId);
          if (!transport) {
            res.statusCode = 404;
            res.end('Session not found');
            return;
          }
          await transport.handlePostMessage(req, res);
          return;
        }

        res.statusCode = 404;
        res.end('Not Found');
      } catch (e) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });

    httpServer.listen(port, () => {
      console.error(`Web Search MCP server (SSE) listening on http://localhost:${port}/sse`);
    });
  }
}

const server = new WebSearchServer();
server.run().catch(console.error);
