// One safe line from a caught error, for a warning or note inside a successful answer (#49
// review, round 2). The error path already goes through toolError; these answers did not, so a
// raw err.message (several lines, a stack frame, an echoed key) could reach the person.
import { errorSummary, toolError } from "./betanyc-tools.js";

/** Most characters of a reason inside an answer, "…" included. */
export const WARNING_MAX = 300;

/** The keys this server reads from its environment; never part of an answer (#44). */
export function secretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.NYC_311_API_KEY, env.SOCRATA_APP_TOKEN].filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * The first plain line of an error (errorSummary: no stack frame, no cause), with the 311 key and
 * the Socrata token redacted as toolError redacts them (plain, percent-, form-, JSON- and
 * base64-encoded), at most WARNING_MAX characters. Redaction runs before the cap, so no part of
 * a key survives a cut.
 */
export function cleanWarning(err: unknown, max: number = WARNING_MAX): string {
  const line = errorSummary(err, 4_000);
  const redacted = toolError(line, { secrets: secretValues() }).content[0].text.replace(/^Error: /, "");
  const cp = [...redacted];
  return cp.length > max ? `${cp.slice(0, max - 1).join("")}…` : redacted;
}
