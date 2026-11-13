/** Сборка выжимки: структура для интерфейса + markdown/CSV для экспорта. */

import type { Analysis, Resources, Stats, Unit } from "./types";
import type { Config } from "./config";
import { CATEGORY_TITLES, themeTitle } from "./config";

export interface DigestTheme {
  id: string;
  title: string;
  items: Unit[];
}

export interface DigestCategory {
  key: string;
  title: string;
  items: Unit[];
}

export interface Digest {
  chatName: string;
  chatType: string;
  stats: Stats;
  themes: DigestTheme[];
  categories: DigestCategory[];
  resources: Resources;
}

const fmt = (d: Date): string => {
  const p = (x: number): string => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const formatWhen = fmt;

export function buildDigest(analysis: Analysis, cfg: Config): Digest {
  const { selected, stats, resources, chat } = analysis;

  const order = [...cfg.themes.map((t) => t.id), "other"];
  const themes: DigestTheme[] = [];
  for (const id of order) {
    const items = selected.filter((u) => u.theme === id);
    if (items.length) themes.push({ id, title: themeTitle(id), items });
  }

  const categories: DigestCategory[] = [];
  for (const key of ["idea", "insight", "advice", "risk", "money"]) {
    const items = selected.filter((u) => u.cats.includes(key));
    if (items.length) categories.push({ key, title: CATEGORY_TITLES[key], items });
  }

  return { chatName: chat.name, chatType: chat.type, stats, themes, categories, resources };
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

function quote(text: string, limit = 700): string {
  let t = text.trim();
  if (t.length > limit) t = t.slice(0, limit - 1).trimEnd() + "…";
  return t
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

const iso = (s: string): string => s.slice(0, 10);

export function digestMarkdown(d: Digest, cfg: Config): string {
  const L: string[] = [];
  const add = (s = ""): void => void L.push(s);

  add(`# Дайджест переписки «${d.chatName}»`);
  add();
  if (d.stats.period) {
    add(
      `Период: **${iso(d.stats.period.from)} — ${iso(d.stats.period.to)}** · сообщений: ` +
        `**${d.stats.messages}** · смысловых фрагментов: **${d.stats.units}** · отобрано: ` +
        `**${d.themes.reduce((s, t) => s + t.items.length, 0)}**`,
    );
  }
  add();
  add(
    `Фрагменты — это склеенные подряд сообщения одного автора (пауза < ${cfg.gapSeconds} с). ` +
      "Балл = эвристика информативности, а не оценка важности.",
  );
  add();

  add("## Статистика");
  add();
  add("| Участник | Сообщений |");
  add("|---|---|");
  for (const [name, cnt] of d.stats.authors) add(`| ${name} | ${cnt} |`);
  add();
  if (d.stats.topWords.length) {
    add(
      "Частые содержательные слова: " +
        d.stats.topWords
          .slice(0, 20)
          .map(([w, c]) => `\`${w}\`×${c}`)
          .join(", "),
    );
    add();
  }

  add("## Топ фрагментов по темам");
  add();
  for (const theme of d.themes) {
    add(`### ${theme.title}`);
    add();
    for (const u of theme.items.slice(0, 6)) {
      const cats = u.cats.join(", ") || "—";
      const ids =
        u.ids.length > 1
          ? ` · id ${u.ids[0]}–${u.ids[u.ids.length - 1]}`
          : ` · id ${u.ids[0]}`;
      add(`**${fmt(u.start)} · ${u.author} · балл ${u.score}** (${cats})${ids}  `);
      add(quote(u.text));
      add();
    }
  }

  for (const cat of d.categories) {
    add(`## ${cat.title}`);
    add();
    for (const u of cat.items.slice(0, 12)) {
      let one = u.text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" / ");
      if (one.length > 400) one = one.slice(0, 399).trimEnd() + "…";
      add(`- **${fmt(u.start)} · ${u.author}** — ${one}`);
    }
    add();
  }

  const { urls, handles, domains } = d.resources;
  if (urls.length || handles.length || domains.length) {
    add("## Упомянутые ссылки, боты и домены");
    add();
    for (const [x, c] of urls) add(`- ${x}${c > 1 ? ` ×${c}` : ""}`);
    for (const [x, c] of handles) add(`- \`${x}\`${c > 1 ? ` ×${c}` : ""}`);
    for (const [x, c] of domains) add(`- ${x}${c > 1 ? ` ×${c}` : ""}`);
    add();
  }

  add("---");
  add();
  add("Сделано в Chat Insights — анализ экспорта Telegram в браузере.");
  return L.join("\n");
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export function insightsCsv(units: Unit[]): string {
  const rows = [["date", "author", "score", "theme", "categories", "ids", "text"]];
  for (const u of units) {
    rows.push([
      u.start.toISOString(),
      u.author,
      String(u.score),
      u.theme,
      u.cats.join(", "),
      u.ids.filter((i) => i !== null).join(" "),
      u.text.replace(/\n/g, " / "),
    ]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
