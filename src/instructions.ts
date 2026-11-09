/**
 * Server instructions, sent once in the MCP initialize answer. Text that several tools
 * share lives here instead of in every tool schema, so tools/list stays small; each tool
 * keeps a short version that is enough to call it correctly.
 */

export const ABOUT_BOARDSTAT =
  "BoardStat: the district tools read files that BoardStat (BetaNYC) builds every night from NYC Open Data, with 311 requests from 2020 on, so the numbers match the BoardStat page each answer links to. It is not an official City report. 311 counts are reports, not problems, and 'closed' does not mean fixed.";

export const DISTRICT_IDS =
  "Districts: community_district is BoardStat's id, borough digit + district number: Manhattan 101-112, Bronx 201-212, Brooklyn 301-318, Queens 401-414, Staten Island 501-503 (Brooklyn Community District 6 is 306). Board codes and names work too: BK06, BK6, 'Brooklyn 6', 'Brooklyn CD 6'. Joint Interest Areas (parks and other areas outside every community district): 164, 226, 227, 228, 355, 356, 480-484, 595. council_district is 1 to 51. Give one, not both.";

export const DATE_OPTIONS =
  "Dates: give from_date/to_date (YYYY-MM-DD, inclusive; data begins 2020-01-01), or a fiscal_year, or last_days, not a mix. The NYC fiscal year runs July 1 to June 30 and is named for the year it ends: 2027 or 'FY2027' is 2026-07-01 to 2027-06-30. last_days ends on the day of the newest request, not today, because the City publishes 311 data a few days late. With no dates, a tool uses the dates BoardStat's page opens with (about the last year), unless its description says otherwise.";

export const LL47_REBUILD =
  "Local Law 47 reports (ll47_service_request_report, ll47_directory_assistance_report, cb_monthly_list): a BetaNYC rebuild from NYC Open Data, not the City's official report; only the City can meet Charter § 1075. ZIP codes are left out by decision, and nothing before 2020-01-01 is included. 311 counts are reports, not problems, and 'closed' does not mean fixed.";

export const SERVER_INSTRUCTIONS = [
  "NYC 311 tools: the 311 calendar and status alerts, 311 request lookup, and district tools built on BoardStat.",
  ABOUT_BOARDSTAT,
  DISTRICT_IDS,
  DATE_OPTIONS,
  LL47_REBUILD,
].join("\n\n");
