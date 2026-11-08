// A client for the 311 Public API's content operations: the knowledge-base articles
// portal.311.nyc.gov shows (KA-#####), their categories, and the agency and 311
// "Problem" each reportable action goes to. Used by how_to_report and
// list_311_categories (#17).
//
// Built against the API portal's own operation list (engineering standards §0):
// https://api-portal.nyc.gov/api-details#api=nyc-311-public-api, read 2026-11-07
// through the portal's backing endpoints
// /developer/apis/nyc-311-public-api/operations/<id> and /schemas/<id>:
//   - GET /api/GetCategory?max-level={int} "retrieve all categories, and optionally
//     sub-categories ... a category's hierarchy may have three (3) levels". "If a
//     category or sub-category has no sub-categories, it is an end node, and has
//     related knowledge base articles." max-level defaults to 2.
//   - GET /api/GetContentList?categoryId={id} "a list of content article summaries
//     under the given category".
//   - GET /api/GetContent?SearchText={id} "Returns content details". No response
//     schema is documented.
// The documented schemas do not match what the API returns, so every shape below
// was confirmed with live responses on 2026-11-07 (recorded in test/fixtures/content/):
//   - GetCategory returns { Categories: [...] }, a FLAT list (not the nested
//     SubCategory tree the schema shows), each with Name, Description, CategoryId
//     ("311-12"), CategoryURL, and ParentCategoryId for sub-categories. Sub-categories
//     are ALSO nested under their parent's SubCategory, so most appear twice.
//   - GetContentList returns { ContentArticleList: [{ id, title, description }] }
//     (the schema says `kanumber`; the API sends `id`). Parent categories and
//     "A to Z" (311-19) return an empty list: only end nodes have articles.
//   - GetContent returns { KnowledgeArticle: [{ ArticlePublicNumber, Title,
//     Description, Section: [{ Name, Content (HTML), ContentAction: [{ Name,
//     Agency, Problem?, ProblemDetail? }] }] }] }.
//
// Politeness (engineering standards §6): one request at a time, at least 1 s between
// request starts, a 30 s timeout, one retry on 429/503 honoring Retry-After, a
// User-Agent naming this package, and a disk cache: categories, article lists and
// articles change rarely, so each is kept 7 days, and an older copy answers (marked
// stale) when the API cannot be reached.
//
// ZIP codes: article text is HTML the City writes, and some of it carries mailing
// addresses. The text is reduced to plain text here; how-to-report.ts redacts ZIP
// codes from everything it returns.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultCacheDir, stderrLogger, type Logger } from "./boardstat-data.js";
import { BASE_URL, errorFromResponse, getApiKey, retryAfterMs } from "./nyc-311.js";
import { USER_AGENT } from "./version.js";

export const PORTAL = "https://portal.311.nyc.gov";
export const CATEGORY_ID = /^311-\d{1,6}$/;
export const KA_NUMBER = /^KA-\d{4,6}$/;

/** The stable link to an article on 311 Online. */
export function articleUrl(ka: string): string {
  return `${PORTAL}/article/?kanumber=${encodeURIComponent(ka)}`;
}

export type Category = {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  url: string | null;
};

export type ArticleSummary = { ka_number: string; title: string; description: string };

export type ContentAction = {
  /** The action's name on the article, e.g. "Noise from Street or Sidewalk". */
  name: string | null;
  agency: string | null;
  /** The 311 Problem. NYC Open Data calls it complaint_type ("Problem (formerly Complaint Type)"). */
  problem: string | null;
  problem_detail: string | null;
};

export type ArticleSection = { name: string; text: string; actions: ContentAction[] };

export type Article = {
  ka_number: string;
  title: string;
  description: string;
  sections: ArticleSection[];
};

/** A cached value, how old it is, and whether it was served because the API could not be reached. */
export type Fetched<T> = { value: T; fetched_at: string; stale: boolean; warning?: string };

export type ContentClientOptions = {
  baseUrl?: string;
  /** Returns the subscription key. Default: NYC_311_API_KEY, read when the first request is made. */
  apiKey?: () => string;
  fetch?: typeof fetch;
  logger?: Logger;
  cacheDir?: string;
  /** How long a cached answer is used without asking the API. Default 7 days. */
  ttlMs?: number;
  /** Least time between request starts. Default 1000 ms. */
  minIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DAY = 24 * 60 * 60 * 1000;

export class ContentClient {
  private readonly base: string;
  private readonly apiKey: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly log: Logger;
  readonly cacheDir: string;
  private readonly ttl: number;
  private readonly minGap: number;
  private readonly timeout: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastStart: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<Fetched<unknown>>>();
  /** Requests actually sent to the API by this client (cache hits are not counted). */
  requests = 0;

  constructor(opts: ContentClientOptions = {}) {
    this.base = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? getApiKey;
    this.fetchImpl = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.log = opts.logger ?? stderrLogger;
    this.cacheDir = opts.cacheDir ?? path.join(defaultCacheDir(), "content-311");
    this.ttl = opts.ttlMs ?? 7 * DAY;
    this.minGap = opts.minIntervalMs ?? 1000;
    this.timeout = opts.timeoutMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Every category, flat, in the API's order. */
  categories(): Promise<Fetched<Category[]>> {
    return this.cached("categories", () => this.get("/GetCategory", { "max-level": "3" }), parseCategories);
  }

  /** The article summaries in one end-node category. Parent categories have none. */
  articleList(categoryId: string): Promise<Fetched<ArticleSummary[]>> {
    if (!CATEGORY_ID.test(categoryId)) throw new Error(`'${categoryId}' is not a 311 category id (they look like 311-12).`);
    return this.cached(`list/${categoryId}`, () => this.get("/GetContentList", { categoryId }), parseArticleList);
  }

  /**
   * One article by its KA number. An article whose text says something holds "right
   * now", "currently" or "at this time" (KA-01397: "DSNY isn't taking complaints right
   * now") is refreshed daily rather than weekly, because it changes with the season.
   */
  article(ka: string): Promise<Fetched<Article>> {
    const id = ka.trim().toUpperCase();
    if (!KA_NUMBER.test(id)) throw new Error(`'${ka}' is not a 311 article number (they look like KA-01092).`);
    return this.cached(`article/${id}`, () => this.get("/GetContent", { SearchText: id }), (raw) => parseArticle(raw, id), (a) => (isTimeSensitive(a) ? DAY : this.ttl));
  }

  // ─── cache ──────────────────────────────────────────────────────────────────

  private file(key: string): string {
    if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error(`Bad cache key '${key}'.`);
    return path.join(this.cacheDir, ...key.split("/")) + ".json";
  }

  private async read<T>(key: string): Promise<{ fetched_at: string; value: T } | null> {
    try {
      const raw = JSON.parse(await readFile(this.file(key), "utf8"));
      if (!raw || typeof raw.fetched_at !== "string" || Number.isNaN(Date.parse(raw.fetched_at)) || !("value" in raw)) return null;
      return raw;
    } catch {
      return null;
    }
  }

  private async write(key: string, value: unknown): Promise<string> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const fetched_at = new Date(this.now()).toISOString();
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify({ fetched_at, value }));
    await rename(tmp, file);
    return fetched_at;
  }

  /**
   * A fresh cached copy, else the API (then cached), else an older cached copy
   * marked stale. Concurrent asks for the same key share one request.
   */
  private cached<T>(key: string, load: () => Promise<unknown>, parse: (raw: unknown) => T, ttlFor: (value: T) => number = () => this.ttl): Promise<Fetched<T>> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<Fetched<T>>;
    const run = (async (): Promise<Fetched<T>> => {
      const saved = await this.read<T>(key);
      if (saved && this.now() - Date.parse(saved.fetched_at) < ttlFor(saved.value)) return { value: saved.value, fetched_at: saved.fetched_at, stale: false };
      try {
        const value = parse(await load());
        const fetched_at = await this.write(key, value);
        return { value, fetched_at, stale: false };
      } catch (err) {
        if (!saved || err instanceof NotFoundError) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        this.log("content_311_stale", { key, reason: err instanceof MissingKeyError ? "NYC_311_API_KEY not set" : reason });
        return {
          value: saved.value,
          fetched_at: saved.fetched_at,
          stale: true,
          warning:
            err instanceof MissingKeyError
              ? `NYC_311_API_KEY is not set, so the 311 API was not asked. This uses the copy saved ${saved.fetched_at}; set the key to get current text.`
              : `The 311 API could not be reached (${reason}). This uses the copy saved ${saved.fetched_at}.`,
        };
      }
    })();
    this.inflight.set(key, run);
    run.finally(() => this.inflight.delete(key)).catch(() => undefined);
    return run;
  }

  // ─── requests ───────────────────────────────────────────────────────────────

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pace() {
    if (this.lastStart !== null) {
      const wait = this.lastStart + this.minGap - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastStart = this.now();
  }

  private get(pathname: string, params: Record<string, string>): Promise<unknown> {
    let key: string;
    try {
      key = this.apiKey();
    } catch (err) {
      throw new MissingKeyError(err instanceof Error ? err.message : String(err));
    }
    const url = new URL(`${this.base}${pathname}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers = { "Ocp-Apim-Subscription-Key": key, "User-Agent": USER_AGENT, Accept: "application/json" };
    return this.serial(async () => {
      for (let attempt = 1; ; attempt++) {
        await this.pace();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new Error(`the 311 API sent no answer within ${this.timeout} ms (${pathname})`)), this.timeout);
        let res: Response;
        try {
          this.requests++;
          res = await this.fetchImpl(url.toString(), { headers, signal: ac.signal });
        } catch (err) {
          throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : err;
        } finally {
          clearTimeout(timer);
        }
        if (res.ok) return res.json();
        if ((res.status === 429 || res.status === 503) && attempt === 1) {
          const wait = retryAfterMs(res.headers.get("retry-after"));
          this.log("content_311_retry", { path: pathname, status: res.status, wait_ms: wait });
          await this.sleep(wait);
          continue;
        }
        throw await errorFromResponse(res);
      }
    });
  }
}

/** NYC_311_API_KEY is not set. A saved copy may still answer, with a warning that says so. */
export class MissingKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingKeyError";
  }
}

/** Text that says something holds only now ("right now", "currently", "at this time"). */
export function isTimeSensitive(a: Article): boolean {
  return a.sections.some((s) => /\b(right now|currently|at this time)\b/i.test(s.text));
}

/** The API answered, but the article asked for is not in its answer. Never served from a stale copy. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// ─── parsing (shapes confirmed against live responses, 2026-11-07) ───────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseCategories(raw: unknown): Category[] {
  const list = (raw as { Categories?: unknown })?.Categories;
  if (!Array.isArray(list)) throw new Error("The 311 API's GetCategory answer has an unexpected shape (no Categories list).");
  const out: Category[] = [];
  const seen = new Set<string>();
  // The API sends every category in the flat list AND nests sub-categories under
  // SubCategory (live response, 2026-11-07). Both are read; each id is kept once.
  const walk = (items: unknown[], parent: string | null) => {
    for (const c of items as Record<string, unknown>[]) {
      const id = str(c?.CategoryId);
      const name = str(c?.Name);
      if (!id || !name) continue;
      if (Array.isArray(c.SubCategory)) walk(c.SubCategory, id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name, description: str(c.Description), parent_id: str(c.ParentCategoryId) ?? parent, url: str(c.CategoryURL) });
    }
  };
  walk(list, null);
  if (!out.length) throw new Error("The 311 API returned no categories.");
  return out;
}

export function parseArticleList(raw: unknown): ArticleSummary[] {
  const list = (raw as { ContentArticleList?: unknown })?.ContentArticleList;
  if (!Array.isArray(list)) throw new Error("The 311 API's GetContentList answer has an unexpected shape (no ContentArticleList).");
  const out: ArticleSummary[] = [];
  for (const a of list as Record<string, unknown>[]) {
    // `id` is what the API sends; `kanumber` is what its schema names.
    const ka = str(a?.id) ?? str(a?.kanumber);
    const title = str(a?.title);
    if (!ka || !title || !KA_NUMBER.test(ka)) continue;
    out.push({ ka_number: ka, title: htmlToText(title), description: htmlToText(str(a.description) ?? "") });
  }
  return out;
}

export function parseArticle(raw: unknown, ka: string): Article {
  const list = (raw as { KnowledgeArticle?: unknown })?.KnowledgeArticle;
  if (!Array.isArray(list)) throw new Error("The 311 API's GetContent answer has an unexpected shape (no KnowledgeArticle list).");
  const a = (list as Record<string, unknown>[]).find((x) => str(x?.ArticlePublicNumber)?.toUpperCase() === ka);
  if (!a) throw new NotFoundError(`The 311 API has no article ${ka}.`);
  const sections: ArticleSection[] = [];
  for (const s of (Array.isArray(a.Section) ? a.Section : []) as Record<string, unknown>[]) {
    const actions = (Array.isArray(s?.ContentAction) ? s.ContentAction : []) as Record<string, unknown>[];
    sections.push({
      name: htmlToText(str(s?.Name) ?? ""),
      text: htmlToText(typeof s?.Content === "string" ? s.Content : ""),
      actions: actions.map((x) => ({ name: str(x?.Name), agency: str(x?.Agency), problem: str(x?.Problem), problem_detail: str(x?.ProblemDetail) })),
    });
  }
  return { ka_number: ka, title: htmlToText(str(a.Title) ?? ka), description: htmlToText(str(a.Description) ?? ""), sections };
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", eacute: "é", ntilde: "ñ", copy: "©", reg: "®",
};

/** Article HTML as plain text: one line per block, entities decoded, styles and scripts dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|table)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[​‌‍﻿]/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
}

let shared: ContentClient | null = null;

/** The one content client this process uses. The API key is read on the first request, not here. */
export function contentClient(): ContentClient {
  if (!shared) shared = new ContentClient();
  return shared;
}

/** Tests point the tools at a client with a fake fetch. */
export function setContentClient(c: ContentClient | null): void {
  shared = c;
}
