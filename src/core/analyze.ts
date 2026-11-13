/** Склейка реплик, оценка информативности, темы, отбор, статистика. */

import type { Analysis, Chat, Msg, Resources, Stats, Unit } from "./types";
import type { Config } from "./config";
import { isMediaOnly } from "./parse";

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

export function tokenize(low: string): string[] {
  return low.match(/[a-zа-яё0-9$]+/gu) ?? [];
}

const matchCount = (re: RegExp, text: string): number => (text.match(re) ?? []).length;

/* ------------------------------------------------------------------ */
/* Склейка                                                             */
/* ------------------------------------------------------------------ */

export function mergeUnits(msgs: Msg[], cfg: Config): Unit[] {
  const units: Unit[] = [];
  let cur: Unit | null = null;

  const start = (m: Msg): Unit => ({
    ids: [m.id],
    start: m.ts,
    end: m.ts,
    author: m.author,
    text: m.text,
    links: [...m.links],
    reactions: m.reactions,
    replyTo: m.replyTo,
    score: 0,
    reasons: [],
    theme: "other",
    cats: [],
  });

  for (const m of msgs) {
    if (!cur) {
      cur = start(m);
      continue;
    }
    const fits =
      m.author === cur.author &&
      (m.ts.getTime() - cur.end.getTime()) / 1000 <= cfg.gapSeconds &&
      cur.text.length + m.text.length <= cfg.maxUnitChars;
    if (fits) {
      cur.ids.push(m.id);
      cur.end = m.ts;
      cur.text += "\n" + m.text;
      cur.links.push(...m.links);
      cur.reactions += m.reactions;
    } else {
      units.push(cur);
      cur = start(m);
    }
  }
  if (cur) units.push(cur);
  return units;
}

/* ------------------------------------------------------------------ */
/* Оценка                                                              */
/* ------------------------------------------------------------------ */

export function scoreUnit(unit: Unit, cfg: Config): { score: number; reasons: string[] } {
  const w = cfg.weights;
  const text = unit.text;
  const low = text.toLowerCase();
  const toks = tokenize(low);
  const n = toks.length;
  let score = 0;
  const reasons: string[] = [];

  if (n >= 8) {
    score += Math.min(n / 30, 1) * w.length;
    reasons.push(`длина ${n} сл.`);
  }
  if (n < 6 && text.length < 30) {
    score += w.shortPenalty;
    reasons.push("короткая реплика");
  }
  const isSmalltalk = cfg.patterns.smalltalk.some((re) => matchCount(re, low.trim()) > 0);
  if (isSmalltalk && n < 8) {
    score += w.smalltalkPenalty;
    reasons.push("смолток");
  }
  if (/[^.!?\n]{80,}/.test(text)) {
    score += w.sentence;
    reasons.push("развёрнутая мысль");
  }

  for (const cat of ["idea", "insight", "advice", "risk"] as const) {
    let hits = 0;
    for (const re of cfg.patterns[cat]) hits += matchCount(re, low);
    if (hits) {
      score += Math.min(hits, w.markerCap) * w.marker;
      reasons.push(`${cat}×${Math.min(hits, 3)}`);
    }
  }

  if (/\d/.test(text) && /\d+\s*(?:₽|руб|\$|usd|%|eur)|(?:₽|\$|usd)\s*\d/.test(low)) {
    score += w.number;
    reasons.push("цифры/деньги");
  }
  if (text.includes("?") && n >= 6) {
    score += w.question;
    reasons.push("вопрос");
  }

  let techHits = 0;
  for (const th of cfg.themes) {
    if (th.id !== "tech_infra" && th.id !== "ai_dev") continue;
    for (const kw of th.keywords) {
      if (toks.some((t) => t.startsWith(kw))) techHits++;
    }
  }
  if (techHits) {
    score += Math.min(techHits, 3) * w.tech;
    reasons.push("техно");
  }
  if (unit.reactions) {
    score += Math.min(unit.reactions * w.reaction, w.reactionCap);
    reasons.push(`реакции ${unit.reactions}`);
  }
  if (unit.links.length) {
    score += w.link;
    reasons.push("ссылка");
  }

  return { score: Math.round(score * 100) / 100, reasons };
}

export function detectTheme(text: string, cfg: Config): string {
  const low = " " + text.toLowerCase() + " ";
  const toks = tokenize(low);
  let best = "other";
  let bestHits = 0;
  for (const th of cfg.themes) {
    let hits = 0;
    for (const kw of th.keywords) {
      if (kw.includes(" ")) {
        if (low.includes(kw)) hits++;
      } else if (toks.some((t) => t.startsWith(kw))) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = th.id;
    }
  }
  return best;
}

export function detectCategories(text: string, cfg: Config): string[] {
  const low = text.toLowerCase();
  const cats: string[] = [];
  for (const cat of ["idea", "insight", "advice", "risk"] as const) {
    if (cfg.patterns[cat].some((re) => matchCount(re, low) > 0)) cats.push(cat);
  }
  if (/\d+\s*(?:₽|руб|\$|usd|%|eur)/.test(low)) cats.push("money");
  return cats;
}

/* ------------------------------------------------------------------ */
/* Дедупликация                                                        */
/* ------------------------------------------------------------------ */

const normalize = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const v of A.values()) sizeA += v;
  for (const v of B.values()) sizeB += v;
  for (const [g, count] of A) overlap += Math.min(count, B.get(g) ?? 0);
  return sizeA + sizeB === 0 ? 0 : (2 * overlap) / (sizeA + sizeB);
}

function dedupe(units: Unit[], ratio: number): Unit[] {
  const kept: Unit[] = [];
  const norms: string[] = [];
  for (const u of units) {
    const n = normalize(u.text);
    if (norms.some((k) => similarity(n, k) > ratio)) continue;
    kept.push(u);
    norms.push(n);
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Отбор                                                               */
/* ------------------------------------------------------------------ */

export function buildUnits(msgs: Msg[], cfg: Config): Unit[] {
  const units = mergeUnits(msgs, cfg);
  for (const u of units) {
    const { score, reasons } = scoreUnit(u, cfg);
    u.score = score;
    u.reasons = reasons;
    u.theme = detectTheme(u.text, cfg);
    u.cats = detectCategories(u.text, cfg);
  }
  return units;
}

export function select(units: Unit[], cfg: Config): Unit[] {
  const cand = units
    .filter(
      (u) =>
        u.score >= cfg.minScore &&
        u.text.length >= cfg.minChars &&
        !isMediaOnly(u.text),
    )
    .sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());
  return dedupe(cand, cfg.dedupeRatio).slice(0, cfg.topN);
}

/* ------------------------------------------------------------------ */
/* Статистика и ресурсы                                                */
/* ------------------------------------------------------------------ */

const DAY = (d: Date): string => {
  const p = (x: number): string => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function buildStats(msgs: Msg[], units: Unit[], cfg: Config): Stats {
  const authors = new Map<string, number>();
  const days = new Map<string, number>();
  const words = new Map<string, number>();
  const stop = new Set(cfg.stopwords);

  for (const m of msgs) {
    authors.set(m.author, (authors.get(m.author) ?? 0) + 1);
    days.set(DAY(m.ts), (days.get(DAY(m.ts)) ?? 0) + 1);
    const clean = m.text.toLowerCase().replace(/\[[^\]]{0,60}\]/g, " ").replace(/<[^>]{0,40}>/g, " ");
    for (const t of tokenize(clean)) {
      if (t.length > 4 && !stop.has(t) && !/^\d+$/.test(t)) words.set(t, (words.get(t) ?? 0) + 1);
    }
  }

  const themes = new Map<string, number>();
  for (const u of units) {
    if (u.score >= cfg.minScore) themes.set(u.theme, (themes.get(u.theme) ?? 0) + 1);
  }

  const byCount = (m: Map<string, number>, limit: number): Array<[string, number]> =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  return {
    messages: msgs.length,
    units: units.length,
    period: msgs.length
      ? { from: msgs[0].ts.toISOString(), to: msgs[msgs.length - 1].ts.toISOString() }
      : null,
    authors: byCount(authors, 20),
    days: Object.fromEntries([...days.entries()].sort()),
    topWords: byCount(words, 30),
    themes: byCount(themes, 20),
    avgChars: Math.round(msgs.reduce((s, m) => s + m.text.length, 0) / Math.max(msgs.length, 1)),
  };
}

const URL_RE = /https?:\/\/[^\s)\]>]+/g;
const HANDLE_RE = /(?<![\w@])@[A-Za-z][A-Za-z0-9_]{3,}/g;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:ru|com|net|io|org|bot|app|dev|me|co)\b/gi;

function countInto(map: Map<string, number>, items: string[]): void {
  for (const raw of items) {
    const item = raw.replace(/[.,;]+$/, "");
    if (!item) continue;
    map.set(item, (map.get(item) ?? 0) + 1);
  }
}

export function collectResources(units: Unit[]): Resources {
  const urls = new Map<string, number>();
  const handles = new Map<string, number>();
  const domains = new Map<string, number>();
  for (const u of units) {
    countInto(urls, u.text.match(URL_RE) ?? []);
    countInto(handles, u.text.match(HANDLE_RE) ?? []);
    countInto(domains, (u.text.match(DOMAIN_RE) ?? []).filter((d) => !d.toLowerCase().startsWith("http")));
  }
  const top = (m: Map<string, number>, n = 25): Array<[string, number]> =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { urls: top(urls), handles: top(handles), domains: top(domains) };
}

/* ------------------------------------------------------------------ */
/* Оркестратор                                                         */
/* ------------------------------------------------------------------ */

export function analyze(chat: Chat, cfg: Config, msgs: Msg[]): Analysis {
  const units = buildUnits(msgs, cfg);
  const selected = select(units, cfg);
  return {
    chat,
    msgs,
    units,
    selected,
    stats: buildStats(msgs, units, cfg),
    resources: collectResources(units),
  };
}
