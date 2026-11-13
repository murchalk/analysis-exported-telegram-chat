import { describe, expect, it } from "vitest";
import { analyze, buildUnits, mergeUnits, select } from "../src/core/analyze";
import { DEFAULT_CONFIG } from "../src/core/config";
import { extractMessages, loadChats } from "../src/core/parse";
import { DEMO_EXPORT } from "../src/core/sample";
import { buildDigest, digestMarkdown, insightsCsv } from "../src/core/digest";

const chat = loadChats(DEMO_EXPORT)[0];
const msgs = extractMessages(chat, true);
const analysis = analyze(chat, DEFAULT_CONFIG, msgs);

describe("mergeUnits", () => {
  it("склеивает реплики одного автора с короткой паузой", () => {
    const units = mergeUnits(
      [
        { id: 1, ts: new Date("2026-01-01T10:00:00"), author: "A", text: "раз", links: [], replyTo: null, reactions: 0 },
        { id: 2, ts: new Date("2026-01-01T10:01:00"), author: "A", text: "два", links: [], replyTo: null, reactions: 0 },
        { id: 3, ts: new Date("2026-01-01T10:02:00"), author: "A", text: "три", links: [], replyTo: null, reactions: 0 },
      ],
      DEFAULT_CONFIG,
    );
    expect(units).toHaveLength(1);
    expect(units[0].text).toBe("раз\nдва\nтри");
  });

  it("не склеивает разных авторов", () => {
    const units = mergeUnits(
      [
        { id: 1, ts: new Date("2026-01-01T10:00:00"), author: "A", text: "раз", links: [], replyTo: null, reactions: 0 },
        { id: 2, ts: new Date("2026-01-01T10:00:30"), author: "B", text: "два", links: [], replyTo: null, reactions: 0 },
      ],
      DEFAULT_CONFIG,
    );
    expect(units).toHaveLength(2);
  });
});

describe("analyze", () => {
  it("находит фрагменты в демо-переписке", () => {
    expect(analysis.stats.messages).toBe(DEMO_EXPORT.messages.length);
    expect(analysis.selected.length).toBeGreaterThan(4);
    expect(analysis.selected.length).toBeLessThanOrEqual(DEFAULT_CONFIG.topN);
  });

  it("сортирует по баллу и соблюдает порог", () => {
    const scores = analysis.selected.map((u) => u.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minScore);
  });

  it("раскладывает по темам и категориям", () => {
    const themes = new Set(analysis.selected.map((u) => u.theme));
    expect(themes.size).toBeGreaterThan(1);
    expect(analysis.selected.some((u) => u.cats.includes("idea"))).toBe(true);
    expect(analysis.selected.some((u) => u.cats.includes("money"))).toBe(true);
  });

  it("считает статистику по авторам", () => {
    const authors = analysis.stats.authors.map(([n]) => n);
    expect(authors).toContain("Алина");
    expect(analysis.stats.topWords.length).toBeGreaterThan(0);
  });
});

describe("select", () => {
  it("ограничивает количество и убирает медиа-заглушки", () => {
    const units = buildUnits(msgs, { ...DEFAULT_CONFIG, topN: 3 });
    const picked = select(units, { ...DEFAULT_CONFIG, topN: 3 });
    expect(picked.length).toBeLessThanOrEqual(3);
    expect(picked.every((u) => !/^\[[^\]]+\]$/.test(u.text))).toBe(true);
  });
});

describe("digest", () => {
  const d = buildDigest(analysis, DEFAULT_CONFIG);

  it("собирает темы и категории", () => {
    expect(d.themes.length).toBeGreaterThan(1);
    expect(d.categories.some((c) => c.key === "idea")).toBe(true);
  });

  it("отдаёт markdown с заголовком и цитатами", () => {
    const md = digestMarkdown(d, DEFAULT_CONFIG);
    expect(md).toContain("# Дайджест переписки");
    expect(md).toContain("> ");
    expect(md).toContain("## Статистика");
  });

  it("отдаёт CSV с BOM и заголовком", () => {
    const csv = insightsCsv(analysis.selected);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")[0]).toContain('"date";"author";"score"');
  });
});
