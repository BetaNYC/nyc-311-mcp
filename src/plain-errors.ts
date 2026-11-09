// Argument errors in plain sentences (beta test round 1, 2026-11-08). zod's own message is
// JSON meant for programmers; a person reading an assistant's answer needs to know which
// argument was wrong and how to fix it, in one or two short sentences.

import { z } from "zod";

type Shape = Record<string, z.ZodTypeAny>;

const unwrap = (t: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined => {
  let s = t;
  while (s && (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault)) s = s._def.innerType;
  return s;
};

function kindOf(t: z.ZodTypeAny | undefined): string {
  const s = unwrap(t);
  if (!s) return "a value";
  if (s instanceof z.ZodNumber) return s._def.checks.some((c: { kind: string }) => c.kind === "int") ? "a whole number" : "a number";
  if (s instanceof z.ZodString) return "text";
  if (s instanceof z.ZodBoolean) return "true or false";
  if (s instanceof z.ZodArray) return "a list";
  if (s instanceof z.ZodEnum) return `one of: ${(s.options as string[]).join(", ")}`;
  if (s instanceof z.ZodUnion) {
    const opts = (s.options as z.ZodTypeAny[]).map(kindOf);
    return [...new Set(opts)].join(" or ");
  }
  return "a value";
}

const given = (v: unknown) => (typeof v === "string" ? `'${v}'` : JSON.stringify(v));

function sentence(issue: z.ZodIssue, shape: Shape, args: Record<string, unknown>): string {
  const key = String(issue.path[0] ?? "");
  const name = issue.path.length ? `'${issue.path.join(".")}'` : "The arguments";
  const value = issue.path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string | number, unknown>)[k] : undefined), args);
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined") return `${name} is required.`;
      if (issue.expected === "integer") return `${name} should be a whole number (you gave ${given(value)}).`;
      return `${name} should be ${issue.path.length > 1 ? issue.expected : kindOf(shape[key])} (you gave ${given(value)}).`;
    case "invalid_union": {
      const missing = issue.unionErrors.every((e) => e.issues.every((i) => i.code === "invalid_type" && i.received === "undefined"));
      if (missing) return `${name} is required.`;
      return `${name} should be ${kindOf(shape[key])} (you gave ${given(value)}).`;
    }
    case "invalid_enum_value":
      return `${name} must be one of: ${issue.options.join(", ")} (you gave ${given(value)}).`;
    case "too_small":
      if (issue.type === "string") return Number(issue.minimum) <= 1 ? `${name} cannot be empty.` : `${name} needs at least ${issue.minimum} characters.`;
      if (issue.type === "array") return `${name} needs at least ${issue.minimum} item${Number(issue.minimum) === 1 ? "" : "s"}.`;
      return `${name} must be at least ${issue.minimum} (you gave ${given(value)}).`;
    case "too_big":
      if (issue.type === "string") return `${name} can be at most ${issue.maximum} characters.`;
      if (issue.type === "array") return `${name} can list at most ${issue.maximum} items.`;
      return `${name} can be at most ${issue.maximum} (you gave ${given(value)}).`;
    case "invalid_string":
      return `${name} is not in the expected form (you gave ${given(value)}).${issue.message && issue.message !== "Invalid" ? ` ${issue.message}` : ""}`;
    default:
      // A message written for this argument (z.string().min(1, "...")) is already plain.
      return issue.message && issue.message !== "Invalid input" ? issue.message : `${name} is not valid (you gave ${given(value)}).`;
  }
}

/** One plain message for a failed parse: what was wrong, then how to fix it. */
export function plainArgsError(tool: string, error: z.ZodError, shape: Shape, args: unknown): Error {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const lines = [...new Set(error.issues.map((i) => {
    // A custom message (written in the schema) stands on its own.
    if (i.code === "custom" || (i.code === "too_small" && i.message && !/^(String|Array|Number) must/.test(i.message))) return i.message;
    return sentence(i, shape, a);
  }))];
  return new Error(`${tool}: ${lines.slice(0, 3).join(" ")} Check the argument and try again; the tool's description lists what each one takes.`);
}
