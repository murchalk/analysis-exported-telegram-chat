/** Промпт для локальной модели: компактный, чтобы влезть в контекст 4k. */

import type { Stats, Unit } from "./types";
import { formatWhen } from "./digest";

export const SYSTEM_PROMPT = `Ты — аналитик переписок. На вход дают фрагменты чата и краткую статистику.

Задача: вытащить идеи, мысли, выводы, советы и договорённости. Нужен синтез, а не пересказ всех фрагментов.

Правила:
- Опирайся только на текст фрагментов, ничего не выдумывай.
- Не придумывай числа, суммы и названия: если их нет в тексте — не пиши.
- Числа из текста помечай как «со слов участников».
- Пиши кратко, без вступлений и воды. Повторы объединяй.
- Заполни все разделы, даже если в каком-то нечего сказать.

Формат (markdown, ровно эти разделы):
## Главные идеи
- ...
## Мысли и выводы
- ...
## Практические советы
- ...
## Договорённости и сроки
- ... (если нет — «Не обсуждались»)
## Что осталось неясным
- ...`;

const trim = (text: string, limit: number): string =>
  text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";

/**
 * Сначала берём по одному лучшему фрагменту на тему, потом добираем по баллу.
 * Так модель видит все темы, а не только самые «жирные» реплики.
 */
export function pickFragments(units: Unit[], budgetChars: number): Unit[] {
  const best = new Map<string, number>();
  units.forEach((u, i) => {
    if (!best.has(u.theme)) best.set(u.theme, i);
  });

  const order: number[] = [...best.values()];
  units.forEach((_, i) => {
    if (!order.includes(i)) order.push(i);
  });

  const out: Unit[] = [];
  let total = 0;
  for (const i of order) {
    const u = units[i];
    const piece = Math.min(u.text.length, 650) + 60;
    if (total + piece > budgetChars && out.length) break;
    out.push(u);
    total += piece;
  }
  return out;
}

export interface PromptResult {
  system: string;
  user: string;
  chars: number;
}

export function buildPrompt(
  chatName: string,
  stats: Stats,
  units: Unit[],
  budgetChars = 4500,
): PromptResult {
  const head: string[] = [`Переписка: «${chatName}»`];
  if (stats.period) head.push(`Период: ${stats.period.from.slice(0, 10)} — ${stats.period.to.slice(0, 10)}`);
  head.push(`Текстовых сообщений: ${stats.messages}`);
  if (stats.authors.length) {
    head.push("Участники: " + stats.authors.slice(0, 6).map(([n, c]) => `${n} (${c})`).join(", "));
  }

  const chosen = pickFragments(units, budgetChars);
  const blocks = chosen.map(
    (u) => `[${formatWhen(u.start)} · ${u.author}]\n${trim(u.text, 650)}`,
  );

  const sample = chosen.map((u) => u.text).join(" ").toLowerCase();
  const cyr = (sample.match(/[а-яё]/g) ?? []).length;
  const lat = (sample.match(/[a-z]/g) ?? []).length;
  const lang = cyr >= lat ? "Отвечай на русском языке." : "Answer in English.";

  const user =
    head.join("\n") +
    "\n\nФрагменты переписки:\n\n" +
    blocks.join("\n\n") +
    "\n\nЗадача: сделай аналитическую выжимку по схеме из системного сообщения. " +
    lang;

  return { system: SYSTEM_PROMPT, user, chars: user.length };
}

export const estimateTokens = (chars: number): number => Math.ceil(chars / 3);
