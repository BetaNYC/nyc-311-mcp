import { z } from "zod";
import {
  getCalendar,
  getStatus,
  getServiceRequest,
  getServiceRequestList,
} from "./nyc-311.js";
import { DISTRICT_ARG_SHAPES, DISTRICT_TOOLS, runDistrictTool, type DistrictToolName } from "./district-tools.js";
import { describeStatus } from "./status.js";
import { describeServiceRequest, describeServiceRequestList, listNotFoundMessage, notFoundMessage } from "./service-requests.js";
import { LL47_ARG_SHAPES, LL47_TOOLS, runLl47Tool, type Ll47ToolName } from "./ll47-reports.js";
import { REPORT_ARG_SHAPES, REPORT_TOOLS, runReportTool, type ReportToolName } from "./how-to-report.js";
import { DRAFT_ARG_SHAPES, DRAFT_TOOLS, runDraftTool, type DraftToolName } from "./draft-report.js";
import { BUILT_IN_911_READ, SAFETY_LINE } from "./emergency.js";
import { boardstatData } from "./district-tools.js";
import { CALL_CENTER_DATASET, sodaClient, type SodaMetadata } from "./soda.js";
import { SLA_KEY, type SlaCache } from "./draft-report.js";
import { contentClient } from "./content-311.js";

/** The last line of whats_changed, about_betanyc and about_data: SAFETY_LINE's closing 911 sentence, word for word. */
export const SHARED_TOOL_LINE = "If this is an emergency, or if you think this is an emergency, call 911.";
import { plainArgsError } from "./plain-errors.js";
import { createBetanycTools } from "./betanyc-tools.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * whats_changed, about_betanyc and about_data, the three tools every BetaNYC MCP server
 * carries (betanyc-ai-workspace platform/system/whats-changed-standard.md § 7 and
 * about-data-standard.md). betanyc-tools.ts is a copy of the workspace's canonical file:
 * never edit it here. WHATS-CHANGED.md and DATA-SOURCES.json ship in the npm package
 * (package.json `files`), one level above dist/.
 *
 * about_data's freshness hooks say how current each source is on this machine, read from
 * what the server itself last fetched and saved (never a date typed into DATA-SOURCES.json).
 * Each returns null when nothing has been fetched yet, and never touches the network.
 */
export const FRESHNESS_HOOKS: Record<string, () => string | null> = {
  // BoardStat's build time, from the manifest in memory or in the cache folder.
  boardstat_build: () => boardstatData().knownManifest()?.generated_at ?? null,
  // The City's boundary datasets, as recorded in the manifest of the build in use.
  community_district_boundaries: () => boardstatData().knownManifest()?.sources?.community_districts?.rowsUpdatedAt_iso ?? null,
  council_district_boundaries: () => boardstatData().knownManifest()?.sources?.council_districts?.rowsUpdatedAt_iso ?? null,
  // NYC Open Data's own update time for the 311 Call Center Inquiry dataset, last read.
  call_center_dataset: () => sodaClient().readCacheSync<SodaMetadata>(`meta/${CALL_CENTER_DATASET}`)?.value.rowsUpdatedAt_iso ?? null,
  // The day the City last updated the Service Level Agreements rows the server saved.
  sla_dataset: () => sodaClient().readCacheSync<SlaCache>(SLA_KEY)?.value.rows_updated ?? null,
  // When the 311 category list was last fetched from the 311 Public API.
  articles_saved: () => contentClient().savedAt("categories"),
  // The day the City's "Call 911" lines were copied into this server (emergency.ts).
  built_in_911: () => BUILT_IN_911_READ,
};

const betanyc = createBetanycTools({
  serverName: "nyc-311-mcp",
  version: PACKAGE_VERSION,
  repoUrl: "https://github.com/BetaNYC/nyc-311-mcp",
  whatsChangedPath: new URL("../WHATS-CHANGED.md", import.meta.url),
  dataSourcesPath: new URL("../DATA-SOURCES.json", import.meta.url),
  pageUrl: "https://betanyc.github.io/nyc-311-mcp/whats-changed.html",
  freshness: FRESHNESS_HOOKS,
  catalogUrls: { dataJson: "https://betanyc.github.io/nyc-311-mcp/data.json" },
});

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
      "Whether a City status is in effect right now, from the 311 Public API: Code Blue (cold weather), Fire Hydrant emergency, an OEM emergency event, Snow or Ice on Sidewalk, or Snow or Ice on Street. Returns the API's answer plus plain_language: yes or no in words, what it checks, and when it was asked. Not alternate side parking: use get_calendar for that.",
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
      "Look up one 311 service request by its 311 number (format 311-XXXXXXXX), from the City's 311 Public API. Returns agency, problem, status, submitted time, address (ZIP code removed) and the agency's resolution text, plus a plain_language block: the status in words and what it means. The 311 number is not NYC Open Data's unique_key, so it is not matched to BoardStat's rows by number; for other requests at the same address, pass plain_language.address_lookup to address_history.",
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
      "Look up several 311 service requests by their 311 numbers in one call. Each comes back as in get_service_request, with its plain_language block; numbers the API did not find are listed in not_found (the API leaves them out without an error).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sr_numbers: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Array of service request numbers, e.g. ['311-17323508', '311-17323514']",
        },
      },
      required: ["sr_numbers"],
    },
  },
  // The ten district tools, from BoardStat's published files (#14).
  ...DISTRICT_TOOLS,
  // The three Local Law 47 of 2005 reports (Charter § 1075), rebuilt from open data (#15).
  ...LL47_TOOLS,
  // Help reporting a problem: which 311 article, agency and problem type fit (#17).
  ...REPORT_TOOLS,
  // A ready-to-paste 311 report the person files themselves (#18).
  ...DRAFT_TOOLS,
  // What's changed in this server, who built it, and where its data comes from (BetaNYC standard tools).
  ...betanyc.tools,
];

const ARG_SHAPES = {
  get_calendar: {
    date: z.string().optional(),
    from_date: z.string().optional(),
    to_date: z.string().optional(),
  },
  get_status: { type: z.enum(STATUS_TYPES) },
  get_service_request: { sr_number: z.string() },
  // An empty list is refused here, never sent to the City (the API answers it with a raw 400).
  get_service_request_list: {
    sr_numbers: z.array(z.string()).min(1, "Give at least one 311 number in sr_numbers, for example ['311-17323508']."),
  },
  ...DISTRICT_ARG_SHAPES,
  ...LL47_ARG_SHAPES,
  ...REPORT_ARG_SHAPES,
  ...DRAFT_ARG_SHAPES,
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
  if (rejected.length === 0) throw plainArgsError(tool, parsed.error, shape as Record<string, z.ZodTypeAny>, args);
  throw new Error(
    `${tool} does not accept ${rejected.map((k) => `'${k}'`).join(", ")}. ` +
      `The parameters it accepts are: ${Object.keys(shape).join(", ")}. ` +
      `Unknown parameters are rejected rather than ignored, because ignoring one ` +
      `would return results that look right but answer a different question.`
  );
}

/**
 * Every response from every tool, success or error, ends with SAFETY_LINE as its last line (Noel,
 * beta round 17), and every structured answer carries it as its first field (safety_line). A tool
 * that detects danger (how_to_report, draft_311_report) still leads first_line with a stronger 911
 * line at the top. An error message carries it once, at the end.
 */
export async function callTool(name: string, args: unknown) {
  if (betanyc.handles(name)) {
    // The shared tools answer in readable text plus structuredContent that matches their
    // outputSchema. They give no figures from City data (about_data describes the sources but
    // answers from DATA-SOURCES.json), so the City-data part of SAFETY_LINE does not fit them;
    // their text ends with its 911 sentence only (QA on the pilot, 2026-11-12). structuredContent is left exactly as the shared module built it, which the
    // standard allows (§ 7, "A server's own wrapper").
    const out = betanyc.call(name, args);
    return { ...out, content: [{ type: "text" as const, text: `${out.content[0].text}\n\n${SHARED_TOOL_LINE}` }] };
  }
  const out = await runToolRaw(name, args);
  const text = out.content[0].text;
  if (out.isError) return { content: [{ type: "text", text: `${withoutSafetyLine(text)}\n\n${SAFETY_LINE}` }], isError: true };
  // The JSON keeps its safety_line field; the sentence is the text's last line once more, as Noel asked.
  return { content: [{ type: "text", text: `${text}\n\n${SAFETY_LINE}` }] };
}

/** An error message without the sentence, which the response adds once at the end. */
function withoutSafetyLine(message: string): string {
  return message.split(`${SAFETY_LINE} `).join("").split(SAFETY_LINE).join("").trim();
}

/** The structured answer with the safety line as its first field. */
function withSafety(result: unknown): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const { safety_line: _s, ...rest } = result as Record<string, unknown>;
    return { safety_line: SAFETY_LINE, ...rest };
  }
  return { safety_line: SAFETY_LINE, results: result };
}
const json = (result: unknown) => JSON.stringify(withSafety(result), null, 2);

async function runToolRaw(name: string, args: unknown): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> {
  // Own keys only: `name in shapes` is also true for "constructor", "toString" and the
  // rest of Object's properties, which would run a tool body for a name that is no tool.
  if (!Object.hasOwn(ARG_SHAPES, name)) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    switch (name) {
      case "get_calendar": {
        const { date, from_date, to_date } = parseToolArgs("get_calendar", args);
        const results = await getCalendar({ date, fromDate: from_date, toDate: to_date });
        return { content: [{ type: "text", text: json(results) }] };
      }

      case "get_status": {
        const { type } = parseToolArgs("get_status", args);
        const results = describeStatus(type, await getStatus(type));
        return { content: [{ type: "text", text: json(results) }] };
      }

      case "get_service_request": {
        const { sr_number } = parseToolArgs("get_service_request", args);
        let results: unknown;
        try {
          results = await getServiceRequest(sr_number);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(/ error 404/.test(message) ? notFoundMessage(sr_number, message) : message);
        }
        results = describeServiceRequest(results);
        return { content: [{ type: "text", text: json(results) }] };
      }

      case "get_service_request_list": {
        const { sr_numbers } = parseToolArgs("get_service_request_list", args);
        let raw: unknown;
        try {
          raw = await getServiceRequestList(sr_numbers);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(/ error 404/.test(message) ? listNotFoundMessage(sr_numbers, message) : message);
        }
        const results = describeServiceRequestList(raw, sr_numbers);
        return { content: [{ type: "text", text: json(results) }] };
      }

      default:
        if (name in DRAFT_ARG_SHAPES) {
          const parsed = parseToolArgs(name as DraftToolName, args) as Record<string, unknown>;
          const result = await runDraftTool(name as DraftToolName, parsed);
          return { content: [{ type: "text", text: json(result) }] };
        }
        if (name in REPORT_ARG_SHAPES) {
          const parsed = parseToolArgs(name as ReportToolName, args) as Record<string, unknown>;
          const result = await runReportTool(name as ReportToolName, parsed);
          return { content: [{ type: "text", text: json(result) }] };
        }
        if (name in LL47_ARG_SHAPES) {
          const parsed = parseToolArgs(name as Ll47ToolName, args) as Record<string, unknown>;
          const result = await runLl47Tool(name as Ll47ToolName, parsed);
          return { content: [{ type: "text", text: json(result) }] };
        }
        if (name in DISTRICT_ARG_SHAPES) {
          const parsed = parseToolArgs(name as DistrictToolName, args) as Record<string, unknown>;
          const result = await runDistrictTool(name as DistrictToolName, parsed);
          return { content: [{ type: "text", text: json(result) }] };
        }
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The reporting-help tools put the safety line first on every error too, argument
    // errors included: a person describing a problem may be in danger (QA on #23, #24).
    return { content: [{ type: "text", text: `Error: ${withoutSafetyLine(message)}` }], isError: true };
  }
}
