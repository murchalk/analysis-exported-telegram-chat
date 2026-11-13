import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config";
import { analyze } from "../src/core/analyze";
import { extractMessages, loadChats } from "../src/core/parse";

// Проверка на настоящем экспорте, если он лежит рядом с проектом.
// В CI файла нет — тест просто пропускается.
const exportPath = fileURLToPath(new URL("../../result.json", import.meta.url));
const hasExport = existsSync(exportPath);

describe.skipIf(!hasExport)("реальный экспорт Telegram", () => {
  it("даёт те же объёмы, что и Python-версия", () => {
    const data = JSON.parse(readFileSync(exportPath, "utf8"));
    const chat = loadChats(data)[0];
    const msgs = extractMessages(chat, true);
    const analysis = analyze(chat, DEFAULT_CONFIG, msgs);

    expect(analysis.stats.messages).toBe(497);
    expect(analysis.units.length).toBe(141);
    expect(analysis.selected.length).toBe(40);
    expect(analysis.stats.authors[0]).toEqual(["TDS ADMIN", 408]);
    expect(analysis.stats.authors[1][0]).toBe("Miur");
  });

  it("находит идеи и технические фрагменты", () => {
    const data = JSON.parse(readFileSync(exportPath, "utf8"));
    const chat = loadChats(data)[0];
    const analysis = analyze(chat, DEFAULT_CONFIG, extractMessages(chat, true));
    expect(analysis.selected.some((u) => u.cats.includes("idea"))).toBe(true);
    expect(analysis.selected.some((u) => u.theme === "tech_infra")).toBe(true);
    expect(analysis.selected.every((u) => u.text.length > 0)).toBe(true);
  });
});
