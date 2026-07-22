import { z } from "zod";
import {
  getCalendar,
  getStatus,
  getServiceRequest,
  getServiceRequestList,
} from "./nyc-311.js";

const STATUS_TYPES = [
  "CodeBlue",
  "FireHydrant",
  "OEM",
  "SnowOnSidewalk",
  "SnowOnStreet",
] as const;

export const TOOLS = [
  {
    name: "get_calendar",
    description:
      "Get Alternate Side Parking, Garbage & Recycling, and Schools status for a date or date range (max 90 days). Dates are interpreted in America/New_York (Eastern Time); if no date is given, defaults to today in New York.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
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
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: STATUS_TYPES,
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
      additionalProperties: false,
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
      additionalProperties: false,
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
];

const ARG_SHAPES = {
  get_calendar: {
    date: z.string().optional(),
    from_date: z.string().optional(),
    to_date: z.string().optional(),
  },
  get_status: { type: z.enum(STATUS_TYPES) },
  get_service_request: { sr_number: z.string() },
  get_service_request_list: { sr_numbers: z.array(z.string()) },
};

/**
 * Parse tool arguments strictly. zod strips unknown keys by default, which turns
 * a guessed parameter name into a silently dropped filter and an answer to a
 * different question than the one asked. `.strict()` raises instead, and the
 * message names the rejected key alongside the parameters this tool does accept.
 */
export function parseToolArgs<K extends keyof typeof ARG_SHAPES>(
  tool: K,
  args: unknown
): z.infer<z.ZodObject<(typeof ARG_SHAPES)[K]>> {
  const shape = ARG_SHAPES[tool];
  const parsed = z.object(shape).strict().safeParse(args ?? {});
  if (parsed.success) {
    return parsed.data as z.infer<z.ZodObject<(typeof ARG_SHAPES)[K]>>;
  }
  const rejected = parsed.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : []
  );
  if (rejected.length === 0) throw parsed.error;
  throw new Error(
    `${tool} does not accept ${rejected.map((k) => `'${k}'`).join(", ")}. ` +
      `The parameters it accepts are: ${Object.keys(shape).join(", ")}. ` +
      `Unknown parameters are rejected rather than ignored, because ignoring one ` +
      `would return results that look right but answer a different question.`
  );
}

export async function callTool(name: string, args: unknown) {
  try {
    switch (name) {
      case "get_calendar": {
        const { date, from_date, to_date } = parseToolArgs("get_calendar", args);
        const results = await getCalendar({ date, fromDate: from_date, toDate: to_date });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_status": {
        const { type } = parseToolArgs("get_status", args);
        const results = await getStatus(type);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_service_request": {
        const { sr_number } = parseToolArgs("get_service_request", args);
        const results = await getServiceRequest(sr_number);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "get_service_request_list": {
        const { sr_numbers } = parseToolArgs("get_service_request_list", args);
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
}
