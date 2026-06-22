#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  getCalendar,
  getStatus,
  getServiceRequest,
  getServiceRequestList,
} from "./nyc-311.js";

const server = new Server(
  { name: "nyc-311-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_calendar",
      description:
        "Get Alternate Side Parking, Garbage & Recycling, and Schools status for a date or date range (max 90 days). If no date is given, defaults to today.",
      inputSchema: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Single date, YYYY-MM-DD. Used for both from and to if no range is given.",
          },
          from_date: { type: "string", description: "Range start, YYYY-MM-DD" },
          to_date: { type: "string", description: "Range end, YYYY-MM-DD" },
        },
      },
    },
    {
      name: "get_status",
      description:
        "Get the current city status for an emergency or weather condition: Code Blue (cold weather), Fire Hydrant, OEM emergency notifications, Snow on Sidewalk, or Snow on Street.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["CodeBlue", "FireHydrant", "OEM", "SnowOnSidewalk", "SnowOnStreet"],
            description: "Status type to look up",
          },
        },
        required: ["type"],
      },
    },
    {
      name: "get_service_request",
      description:
        "Look up one 311 service request by its number (format 311-XXXXXXXX). Returns agency, problem type, status, timestamp, and address.",
      inputSchema: {
        type: "object",
        properties: {
          sr_number: { type: "string", description: "Service request number, e.g. '311-17323508'" },
        },
        required: ["sr_number"],
      },
    },
    {
      name: "get_service_request_list",
      description:
        "Bulk look up multiple 311 service requests by their numbers in a single call.",
      inputSchema: {
        type: "object",
        properties: {
          sr_numbers: {
            type: "array",
            items: { type: "string" },
            description: "Array of service request numbers, e.g. ['311-17323508', '311-17323514']",
          },
        },
        required: ["sr_numbers"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_calendar": {
        const { date, from_date, to_date } = z
          .object({
            date: z.string().optional(),
            from_date: z.string().optional(),
            to_date: z.string().optional(),
          })
          .parse(args ?? {});
        const results = await getCalendar({ date, fromDate: from_date, toDate: to_date });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_status": {
        const { type } = z
          .object({
            type: z.enum(["CodeBlue", "FireHydrant", "OEM", "SnowOnSidewalk", "SnowOnStreet"]),
          })
          .parse(args);
        const results = await getStatus(type);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_service_request": {
        const { sr_number } = z
          .object({ sr_number: z.string() })
          .parse(args);
        const results = await getServiceRequest(sr_number);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_service_request_list": {
        const { sr_numbers } = z
          .object({ sr_numbers: z.array(z.string()) })
          .parse(args);
        const results = await getServiceRequestList(sr_numbers);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
