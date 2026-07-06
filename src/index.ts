#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getCalendar,
  getStatus,
  getServiceRequest,
  getServiceRequestList,
} from "./nyc-311.js";

const server = new McpServer({ name: "nyc-311-mcp", version: "1.0.0" });

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const results = await fn();
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

server.registerTool(
  "get_calendar",
  {
    description:
      "Get Alternate Side Parking, Garbage & Recycling, and Schools status for a date or date range (max 90 days). If no date is given, defaults to today.",
    inputSchema: {
      date: z
        .string()
        .optional()
        .describe("Single date, YYYY-MM-DD. Used for both from and to if no range is given."),
      from_date: z.string().optional().describe("Range start, YYYY-MM-DD"),
      to_date: z.string().optional().describe("Range end, YYYY-MM-DD"),
    },
  },
  async ({ date, from_date, to_date }) =>
    run(() => getCalendar({ date, fromDate: from_date, toDate: to_date }))
);

server.registerTool(
  "get_status",
  {
    description:
      "Get the current city status for an emergency or weather condition: Code Blue (cold weather), Fire Hydrant, OEM emergency notifications, Snow on Sidewalk, or Snow on Street.",
    inputSchema: {
      type: z
        .enum(["CodeBlue", "FireHydrant", "OEM", "SnowOnSidewalk", "SnowOnStreet"])
        .describe("Status type to look up"),
    },
  },
  async ({ type }) => run(() => getStatus(type))
);

server.registerTool(
  "get_service_request",
  {
    description:
      "Look up one 311 service request by its number (format 311-XXXXXXXX). Returns agency, problem type, status, timestamp, and address.",
    inputSchema: {
      sr_number: z.string().describe("Service request number, e.g. '311-17323508'"),
    },
  },
  async ({ sr_number }) => run(() => getServiceRequest(sr_number))
);

server.registerTool(
  "get_service_request_list",
  {
    description:
      "Bulk look up multiple 311 service requests by their numbers in a single call.",
    inputSchema: {
      sr_numbers: z
        .array(z.string())
        .describe("Array of service request numbers, e.g. ['311-17323508', '311-17323514']"),
    },
  },
  async ({ sr_numbers }) => run(() => getServiceRequestList(sr_numbers))
);

const transport = new StdioServerTransport();
await server.connect(transport);
