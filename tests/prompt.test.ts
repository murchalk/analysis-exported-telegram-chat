import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config";
import { analyze } from "../src/core/analyze";
import { extractMessages, loadChats } from "../src/core/parse";
import { buildPrompt, estimateTokens, pickFragments } from "../src/core/prompt";
import { DEMO_EXPORT } from "../src/core/sample";

const chat = loadChats(DEMO_EXPORT)[0];
const analysis = analyze(chat, DEFAULT_CONFIG, extractMessages(chat, true));

describe("buildPrompt", () => {
  it("укладывается в бюджет символов", () => {
    const { user } = buildPrompt(chat.name, analysis.stats, analysis.selected, 2000);
    // +шапка и хвост с задачей
    expect(user.length).toBeLessThan(2000 + 600);
  });

  it("содержит название, период и фрагменты", () => {
    const { user } = buildPrompt(chat.name, analysis.stats, analysis.selected, 4000);
    expect(user).toContain(chat.name);
    expect(user).toContain("Фрагменты переписки");
    expect(user).toContain("Задача:");
    expect(user).toContain("[");
  });

  it("просит отвечать по-русски для русской переписки", () => {
    const { user } = buildPrompt(chat.name, analysis.stats, analysis.selected, 4000);
    expect(user).toContain("Отвечай на русском");
  });

  it("в системном промпте есть все разделы", () => {
    const { system } = buildPrompt(chat.name, analysis.stats, analysis.selected, 4000);
    for (const section of ["Главные идеи", "Мысли и выводы", "Практические советы", "Договорённости"]) {
      expect(system).toContain(section);
    }
  });

  it("оценка токенов правдоподобна", () => {
    expect(estimateTokens(3000)).toBe(1000);
  });
});

describe("pickFragments", () => {
  it("берёт по одному фрагменту на каждую тему", () => {
    const themes = new Set(analysis.selected.map((u) => u.theme));
    const picked = pickFragments(analysis.selected, 100000);
    const pickedThemes = new Set(picked.map((u) => u.theme));
    expect(pickedThemes.size).toBe(themes.size);
  });

  it("не превышает бюджет", () => {
    const budget = 1200;
    const picked = pickFragments(analysis.selected, budget);
    const size = picked.reduce((s, u) => s + Math.min(u.text.length, 650) + 60, 0);
    expect(size).toBeLessThanOrEqual(budget);
  });
});
