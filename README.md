# Web Search MCP Server

A Model Context Protocol (MCP) server that enables web searching with no API keys required.

## Features

- No API keys or authentication required
- Returns structured results with titles, URLs, and descriptions
- Configurable number of results per search
- Recommended backend: SearXNG JSON API via `SEARXNG_URL` (fast + reliable)

## Installation

1. Clone or download this repository
2. Install dependencies:
```bash
npm install
```
3. Build the server:
```bash
npm run build
```
4. Add the server to your MCP configuration:

### VS Code (`.vscode/mcp.json`)

Example (adjust the path):

```json
{
  "servers": {
    "web-search": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/web-search/build/index.js"],
      "env": {
        "SEARXNG_URL": "http://127.0.0.1:8080"
      }
    }
  }
}
```

### Claude Desktop / other MCP clients

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/web-search/build/index.js"],
      "env": {
        "SEARXNG_URL": "http://127.0.0.1:8080"
      }
    }
  }
}
```

## (Recommended) Run SearXNG locally (no API keys, fast)

From the `web-search/` folder:

```bash
docker compose up -d
```

Then set:
- `SEARXNG_URL=http://127.0.0.1:8080`

You can quickly verify JSON search works:

```bash
curl "http://127.0.0.1:8080/search?q=openai&format=json" | head
```

Note: this repo includes `searxng/settings.yml` and mounts it via `docker-compose.yml` to ensure `format=json` is enabled.

## Hosting over SSE (remote MCP server)

This server can run over HTTP + SSE (Server-Sent Events), suitable for hosting on the internet.

Start the MCP server in SSE mode:

```bash
SEARXNG_URL="http://127.0.0.1:8080" node build/index.js --sse --port 3000
```

Endpoints:
- `GET /healthz` returns `200 OK` for Render health checks
- `GET /` or `GET /sse` establishes the SSE stream
- `POST /message?sessionId=...` receives client messages

## Deploy to Railway (public URL usable from any machine)

Railway is a good fit for MCP over SSE because it runs your service as a long-lived process that can keep SSE sessions in memory. Railway will provide a `PORT` environment variable; the server uses it automatically when running in SSE mode.

### A) Deploy SearXNG service (required)

1. Push this repo to GitHub (or deploy from local using Railway CLI).
2. In Railway: `New Project` → `Deploy from GitHub repo`.
3. Add a **new service** in the project for SearXNG:
   - Source: this repo
   - Dockerfile path: `searxng/Dockerfile`
4. Add a volume if you want persistence (optional).
5. Deploy and copy the SearXNG public URL (or internal URL).

### B) Deploy MCP server service (SSE)

1. Add another **new service** in the same Railway project:
   - Source: this repo
   - Dockerfile path: `Dockerfile`
2. Set environment variable on this MCP service:
   - `SEARXNG_URL` = your SearXNG service URL (e.g. `https://<searxng-service>.up.railway.app`)
3. Deploy and copy the MCP service public URL (e.g. `https://<mcp-service>.up.railway.app`).

### C) Use the Railway URL from any machine (VS Code)

```json
{
  "servers": {
    "web-search-sse": {
      "type": "sse",
      "url": "https://<mcp-service>.up.railway.app"
    }
  }
}
```

### VS Code config for a hosted SSE server

VS Code supports `"type": "sse"` servers with a `url`.

```json
{
  "servers": {
    "webSearchRemote": {
      "type": "sse",
      "url": "https://your-domain.example.com"
    }
  }
}
```

Security note: if you expose this publicly, add authentication (for example, require an `Authorization` header) and put it behind HTTPS (reverse proxy like Nginx/Caddy).

## Usage

The server provides a single tool named `search` that accepts the following parameters:

```typescript
{
  "query": string,    // The search query
  "limit": number     // Optional: Number of results to return (default: 5, max: 10)
}
```

Example usage:
```typescript
use_mcp_tool({
  server_name: "web-search",
  tool_name: "search",
  arguments: {
    query: "your search query",
    limit: 3  // optional
  }
})
```

Example response:
```json
[
  {
    "title": "Example Search Result",
    "url": "https://example.com",
    "description": "Description of the search result..."
  }
]
```

## Limitations

### SearXNG backend (required)

- `SEARXNG_URL` must be set, otherwise the server returns an error for the `search` tool.
- Your SearXNG instance must allow `format=json`. This repo’s `docker-compose.yml` + `searxng/settings.yml` are configured to enable it.
- Result quality and availability depend on the engines enabled in SearXNG and any rate limiting/captcha those upstream engines apply.
- For production, use your own SearXNG instance and review its configuration (engines, safe search, limiter, network policy).
