#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, callTool } from "./tools.js";
import { PACKAGE_VERSION } from "./version.js";
import { boardstatData } from "./district-tools.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

// Fail fast on a bad BOARDSTAT_DATA_URL / NYC_311_MCP_CACHE_DIR, before any tool is called.
// Nothing is fetched here; files are downloaded the first time a tool needs them.
boardstatData();

const server = new Server(
  { name: "nyc-311-mcp", version: PACKAGE_VERSION },
  // Shared explanations (district ids, date options, what BoardStat is) are sent once here.
  { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callTool(request.params.name, request.params.arguments)
);

const transport = new StdioServerTransport();
await server.connect(transport);
