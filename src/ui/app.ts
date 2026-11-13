/** Основной контроллер: загрузка файла, рендер выжимки, AI-режим. */

import "../styles.css";

import { DEFAULT_CONFIG, type Config } from "../core/config";
import { analyze } from "../core/analyze";
import { buildDigest, digestMarkdown, formatWhen, insightsCsv, type Digest } from "../core/digest";
import { extractMessages, loadChats } from "../core/parse";
import { buildPrompt, estimateTokens } from "../core/prompt";
import { DEMO_EXPORT, DEMO_FILENAME } from "../core/sample";
import type { Analysis, Chat, Unit } from "../core/types";
import { escapeHtml, renderMarkdown } from "./markdown";
import {
  MODELS,
  ensureEngine,
  generate,
  hasWebGPU,
  isReady,
  resolveModelId,
  stopGeneration,
} from "../ai/webllm";

/* ------------------------------------------------------------------ */
/* Состояние                                                           */
/* ------------------------------------------------------------------ */

interface Settings {
  minScore: number;
  topN: number;
  gapSeconds: number;
  minChars: number;
  aiModel: number;
}

const SETTINGS_KEY = "ci-settings-v1";
const THEME_KEY = "ci-theme";

const stored = ((): Partial<Settings> => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
  } catch {
    return {};
  }
})();

const settings: Settings = {
  minScore: stored.minScore ?? DEFAULT_CONFIG.minScore,
  topN: stored.topN ?? DEFAULT_CONFIG.topN,
  gapSeconds: stored.gapSeconds ?? DEFAULT_CONFIG.gapSeconds,
  minChars: stored.minChars ?? DEFAULT_CONFIG.minChars,
  aiModel: stored.aiModel ?? 0,
};

function makeConfig(): Config {
  return {
    ...DEFAULT_CONFIG,
    minScore: settings.minScore,
    topN: settings.topN,
    gapSeconds: settings.gapSeconds,
    minChars: settings.minChars,
  };
}

const state = {
  chats: [] as Chat[],
  chatIndex: 0,
  analysis: null as Analysis | null,
  digest: null as Digest | null,
  fileName: "",
  theme: "all" as string,
  search: "",
  tab: "digest",
  aiReady: false,
  aiModelId: "",
  aiBusy: false,
  aiText: "",
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
};

/* ------------------------------------------------------------------ */
/* Мелкие утилиты                                                      */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(message: string): void {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-visible"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove("is-visible");
    window.setTimeout(() => {
      el.hidden = true;
    }, 220);
  }, 3200);
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const slug = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "chat";

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/* ------------------------------------------------------------------ */
/* Тема                                                                */
/* ------------------------------------------------------------------ */

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme(): void {
  const forced = new URLSearchParams(location.search).get("theme");
  const saved = localStorage.getItem(THEME_KEY);
  const prefers = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const initial =
    forced === "dark" || forced === "light"
      ? forced
      : saved === "dark" || saved === "light"
        ? saved
        : prefers
          ? "dark"
          : "light";
  document.documentElement.dataset.theme = initial;
  $("theme-toggle").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
}

/* ------------------------------------------------------------------ */
/* Настройки                                                           */
/* ------------------------------------------------------------------ */

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function syncSettingsInputs(): void {
  ($("set-min-score") as HTMLInputElement).value = String(settings.minScore);
  ($("set-top") as HTMLInputElement).value = String(settings.topN);
  ($("set-gap") as HTMLInputElement).value = String(settings.gapSeconds);
  ($("set-min-chars") as HTMLInputElement).value = String(settings.minChars);
}

function readSettingsInputs(): void {
  settings.minScore = clamp(Number(($("set-min-score") as HTMLInputElement).value), 0, 15);
  settings.topN = Math.round(clamp(Number(($("set-top") as HTMLInputElement).value), 5, 200));
  settings.gapSeconds = Math.round(clamp(Number(($("set-gap") as HTMLInputElement).value), 15, 1800));
  settings.minChars = Math.round(clamp(Number(($("set-min-chars") as HTMLInputElement).value), 0, 500));
  saveSettings();
}

const clamp = (n: number, min: number, max: number): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;

/* ------------------------------------------------------------------ */
/* Загрузка и анализ                                                   */
/* ------------------------------------------------------------------ */

function showWorkspace(show: boolean): void {
  $("landing").hidden = show;
  $("workspace").hidden = !show;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadChatsFrom(data: unknown, fileName: string): void {
  const chats = loadChats(data);
  if (!chats.length) throw new Error("В файле не нашлось чатов");
  if (!chats.some((c) => c.messages.length)) throw new Error("В чатах нет сообщений");

  state.chats = chats;
  state.fileName = fileName;
  state.chatIndex = chats.reduce(
    (best, c, i) => (c.messages.length > chats[best].messages.length ? i : best),
    0,
  );

  const select = $("chat-select") as HTMLSelectElement;
  select.innerHTML = chats
    .map(
      (c, i) =>
        `<option value="${i}"${i === state.chatIndex ? " selected" : ""}>${escapeHtml(
          c.name,
        )} · ${c.messages.length}</option>`,
    )
    .join("");

  ($("file-name") as HTMLElement).textContent = fileName;
  showWorkspace(true);
  analyzeCurrent();
}

async function handleFile(file: File): Promise<void> {
  if (!/\.json$/i.test(file.name)) {
    toast("Нужен файл .json из экспорта Telegram");
    return;
  }
  if (file.size > 250 * 1024 * 1024) {
    const ok = window.confirm(
      `Файл ${(file.size / 1024 / 1024).toFixed(0)} МБ. Браузер может задуматься на несколько секунд. Продолжить?`,
    );
    if (!ok) return;
  }

  const zone = $("dropzone");
  zone.classList.add("is-loading");
  try {
    const text = await file.text();
    loadChatsFrom(JSON.parse(text), file.name);
    toast(`Готово: ${state.analysis?.selected.length ?? 0} ${plural(state.analysis?.selected.length ?? 0, "фрагмент", "фрагмента", "фрагментов")}`);
  } catch (error) {
    console.error(error);
    toast(error instanceof SyntaxError ? "Не удалось разобрать JSON" : (error as Error).message);
  } finally {
    zone.classList.remove("is-loading");
  }
}

function analyzeCurrent(): void {
  const chat = state.chats[state.chatIndex];
  if (!chat) return;

  const cfg = makeConfig();
  const msgs = extractMessages(chat, cfg.redact);
  if (!msgs.length) {
    toast("В этом чате нет текстовых сообщений");
    return;
  }
  state.analysis = analyze(chat, cfg, msgs);
  state.digest = buildDigest(state.analysis, cfg);

  const el = $("file-meta");
  const period = state.analysis.stats.period;
  el.textContent = period
    ? `${period.from.slice(0, 10)} — ${period.to.slice(0, 10)} · ${state.analysis.stats.messages} сообщений`
    : "";

  renderStats();
  renderChips();
  renderDigest();
  renderIdeas();
  updateAIButton();
}

/* ------------------------------------------------------------------ */
/* Рендер                                                              */
/* ------------------------------------------------------------------ */

function renderStats(): void {
  const s = state.analysis?.stats;
  if (!s) return;

  const period = s.period
    ? `${s.period.from.slice(8, 10)}.${s.period.from.slice(5, 7)} — ${s.period.to.slice(8, 10)}.${s.period.to.slice(5, 7)}`
    : "—";

  const cards = [
    [String(s.messages), "сообщений"],
    [period, "период"],
    [String(s.authors.length), plural(s.authors.length, "участник", "участника", "участников")],
    [String(state.analysis?.selected.length ?? 0), "фрагментов в выжимке"],
  ];

  $("stats").innerHTML = cards
    .map(
      ([value, label]) =>
        `<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(
          label,
        )}</div></div>`,
    )
    .join("");
}

const SHORT_THEMES: Record<string, string> = {
  sales_money: "Продажи",
  ai_dev: "ИИ",
  tech_infra: "Техника",
  networking: "Связи",
  market: "Рынок",
  risks: "Риски",
  growth: "Опыт",
  personal: "Личное",
  other: "Прочее",
};

function renderChips(): void {
  const d = state.digest;
  if (!d) return;
  const all = d.themes.reduce((sum, t) => sum + t.items.length, 0);
  const items = [
    { id: "all", title: "Все", full: "Все темы", count: all },
    ...d.themes.map((t) => ({
      id: t.id,
      title: SHORT_THEMES[t.id] ?? t.title,
      full: t.title,
      count: t.items.length,
    })),
  ];

  $("theme-chips").innerHTML = items
    .map(
      (t) =>
        `<button class="chip${state.theme === t.id ? " is-active" : ""}" data-theme="${t.id}" ` +
        `title="${escapeHtml(t.full)}" type="button">${escapeHtml(t.title)} ` +
        `<span class="chip-count">${t.count}</span></button>`,
    )
    .join("");

  $("theme-chips")
    .querySelectorAll<HTMLButtonElement>(".chip")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        state.theme = btn.dataset.theme ?? "all";
        renderChips();
        renderDigest();
        renderIdeas();
      }),
    );
}

const CAT_LABELS: Record<string, string> = {
  idea: "идея",
  insight: "вывод",
  advice: "совет",
  risk: "риск",
  money: "деньги",
};

function card(u: Unit, withScore = true): string {
  const tags = u.cats
    .map((c) => `<span class="tag ${c}">${CAT_LABELS[c] ?? c}</span>`)
    .join("");
  const scoreClass = u.score >= 4 ? "fragment-score hot" : "fragment-score";

  return `<article class="fragment">
    <div class="fragment-head">
      <span class="fragment-author">${escapeHtml(u.author)}</span>
      <span class="fragment-date">${escapeHtml(formatWhen(u.start))}</span>
      ${withScore ? `<span class="${scoreClass}" title="Эвристика информативности">${u.score.toFixed(1)}</span>` : ""}
    </div>
    <div class="fragment-text">${escapeHtml(u.text)}</div>
    ${tags ? `<div class="fragment-foot">${tags}</div>` : ""}
  </article>`;
}

function matchesSearch(u: Unit, q: string): boolean {
  if (!q) return true;
  return (u.text + " " + u.author).toLowerCase().includes(q);
}

function renderDigest(): void {
  const d = state.digest;
  const panel = $("panel-digest");
  if (!d) return;

  const q = state.search.trim().toLowerCase();
  const themes = d.themes
    .map((t) => ({ ...t, items: t.items.filter((u) => matchesSearch(u, q)) }))
    .filter((t) => t.items.length && (state.theme === "all" || t.id === state.theme));

  if (!themes.length) {
    panel.innerHTML = `<div class="card"><p class="muted">Ничего не найдено. Попробуйте другой запрос или сбросьте фильтр.</p></div>`;
    return;
  }

  panel.innerHTML = themes
    .map(
      (t) => `<section class="digest-section">
        <h2>${escapeHtml(t.title)} <span class="section-count">${t.items.length}</span></h2>
        ${t.items.map((u) => card(u)).join("")}
      </section>`,
    )
    .join("");
}

function renderIdeas(): void {
  const d = state.digest;
  const panel = $("panel-ideas");
  if (!d) return;

  const q = state.search.trim().toLowerCase();
  const groups = d.categories
    .map((c) => ({ ...c, items: c.items.filter((u) => matchesSearch(u, q)) }))
    .filter((c) => c.items.length);

  if (!groups.length) {
    panel.innerHTML = `<div class="card"><p class="muted">Пока нечего показать: под эти условия ничего не подошло.</p></div>`;
    return;
  }

  panel.innerHTML = `<div class="ideas-grid">${groups
    .map(
      (g) => `<article class="idea-group">
        <h3>${escapeHtml(g.title)} <span class="section-count">${g.items.length}</span></h3>
        ${g.items
          .map(
            (u) => `<div class="idea-item">
              <div class="idea-meta">${escapeHtml(formatWhen(u.start))} · ${escapeHtml(u.author)}</div>
              <div class="idea-text">${escapeHtml(u.text.replace(/\n/g, " · "))}</div>
            </div>`,
          )
          .join("")}
      </article>`,
    )
    .join("")}</div>`;
}

/* ------------------------------------------------------------------ */
/* Вкладки и поиск                                                     */
/* ------------------------------------------------------------------ */

function setTab(tab: string): void {
  state.tab = tab;
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  for (const name of ["digest", "ideas", "ai", "settings"]) {
    ($(`panel-${name}`) as HTMLElement).hidden = name !== tab;
  }
  if (tab === "ai") initAI();
  if (tab === "settings") syncSettingsInputs();
}

function initTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab ?? "digest"));
  });
}

/* ------------------------------------------------------------------ */
/* Экспорт                                                             */
/* ------------------------------------------------------------------ */

function initExport(): void {
  const btn = $("export-btn");
  const menu = $("export-menu");

  const close = (): void => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  menu.querySelectorAll<HTMLButtonElement>("button").forEach((item) =>
    item.addEventListener("click", () => {
      close();
      const a = state.analysis;
      const d = state.digest;
      if (!a || !d) return;
      const base = slug(d.chatName);

      if (item.dataset.export === "md") {
        download(`${base}-digest.md`, digestMarkdown(d, makeConfig()), "text/markdown;charset=utf-8");
      } else if (item.dataset.export === "csv") {
        download(`${base}-fragments.csv`, insightsCsv(a.selected), "text/csv;charset=utf-8");
      } else {
        const payload = {
          chat: d.chatName,
          stats: a.stats,
          items: a.selected.map((u) => ({
            date: u.start.toISOString(),
            author: u.author,
            score: u.score,
            theme: u.theme,
            categories: u.cats,
            ids: u.ids,
            text: u.text,
          })),
        };
        download(`${base}-insights.json`, JSON.stringify(payload, null, 2), "application/json");
      }
    }),
  );
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

let aiInitialized = false;

function initAI(): void {
  if (aiInitialized) {
    updateAIButton();
    return;
  }
  aiInitialized = true;

  const webgpu = hasWebGPU();
  const line = $("webgpu-line");
  if (webgpu) {
    line.className = "webgpu-line ok";
    line.innerHTML = `<span>●</span><span>WebGPU доступен — модель сможет работать локально</span>`;
  } else {
    line.className = "webgpu-line bad";
    line.innerHTML = `<span>●</span><span>WebGPU недоступен. Нужны Chrome или Edge 113+ на компьютере с поддерживаемой видеокартой.</span>`;
  }

  $("model-list").innerHTML = MODELS.map(
    (m, i) => `<label class="model-option${i === settings.aiModel ? " is-active" : ""}">
      <input type="radio" name="ai-model" value="${i}"${i === settings.aiModel ? " checked" : ""} />
      <span><strong>${escapeHtml(m.label)}</strong><span>${escapeHtml(m.note)}</span></span>
      <span class="model-size">${escapeHtml(m.size)}</span>
    </label>`,
  ).join("");

  $("model-list")
    .querySelectorAll<HTMLInputElement>("input")
    .forEach((input) =>
      input.addEventListener("change", () => {
        settings.aiModel = Number(input.value);
        saveSettings();
        state.aiReady = false;
        $("model-list")
          .querySelectorAll(".model-option")
          .forEach((el, i) => el.classList.toggle("is-active", i === settings.aiModel));
        updateAIButton();
      }),
    );

  $("ai-main-btn").addEventListener("click", () => void aiAction());
  $("ai-stop-btn").addEventListener("click", () => {
    stopGeneration();
    $("ai-stop-btn").hidden = true;
  });
  $("ai-copy").addEventListener("click", async () => {
    if (!state.aiText) return;
    try {
      await navigator.clipboard.writeText(state.aiText);
      toast("Скопировано");
    } catch {
      toast("Браузер не дал доступ к буферу");
    }
  });
  $("ai-save").addEventListener("click", () => {
    if (!state.aiText) return;
    download(`${slug(state.digest?.chatName ?? "chat")}-ai-review.md`, state.aiText, "text/markdown;charset=utf-8");
  });

  updateAIButton();
}

function updateAIButton(): void {
  if (!aiInitialized) return;
  const btn = $("ai-main-btn") as HTMLButtonElement;
  const webgpu = hasWebGPU();

  if (!webgpu) {
    btn.disabled = true;
    btn.textContent = "WebGPU недоступен";
    return;
  }
  if (!state.analysis) {
    btn.disabled = true;
    btn.textContent = "Сначала загрузите переписку";
    return;
  }
  if (state.aiBusy) {
    btn.disabled = true;
    btn.textContent = "Генерация…";
    return;
  }
  btn.disabled = false;
  const choice = MODELS[settings.aiModel];
  btn.textContent = state.aiReady ? "Сгенерировать разбор" : `Скачать модель (${choice.size})`;
}

function setProgress(visible: boolean, ratio = 0, text = ""): void {
  const wrap = $("ai-progress");
  wrap.hidden = !visible;
  ($("ai-progress-fill") as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
  $("ai-progress-text").textContent = text;
}

async function aiAction(): Promise<void> {
  if (!state.analysis || !state.digest) return;
  const choice = MODELS[settings.aiModel];

  if (state.aiReady && isReady(state.aiModelId)) {
    await aiGenerate();
    return;
  }

  const btn = $("ai-main-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Ищу модель…";
  setProgress(true, 0, "Проверяю список моделей…");

  let id: string | null = null;
  try {
    id = await resolveModelId(choice.match);
  } catch (error) {
    console.error(error);
    setProgress(false);
    updateAIButton();
    toast("Не удалось загрузить библиотеку WebLLM");
    return;
  }

  if (!id) {
    setProgress(false);
    updateAIButton();
    toast(`Модель ${choice.label} не найдена в WebLLM`);
    return;
  }

  btn.textContent = "Загрузка модели…";
  try {
    await ensureEngine(id, ({ progress, text }) => {
      setProgress(true, progress, text || "Скачиваю модель…");
    });
    state.aiReady = true;
    state.aiModelId = id;
    setProgress(false);
    btn.disabled = false;
    btn.textContent = "Сгенерировать разбор";
    toast("Модель загружена. Текст никуда не отправлялся.");
  } catch (error) {
    console.error(error);
    setProgress(false);
    updateAIButton();
    toast(`Не удалось загрузить модель: ${(error as Error).message}`);
  }
}

function streamRender(text: string, done: boolean): void {
  const out = $("ai-output");
  if (done) {
    out.innerHTML = renderMarkdown(text);
  } else {
    out.innerHTML = `<div class="stream">${escapeHtml(text)}</div>`;
  }
}

async function aiGenerate(): Promise<void> {
  if (!state.analysis || !state.digest) return;
  const { system, user } = buildPrompt(
    state.digest.chatName,
    state.analysis.stats,
    state.analysis.selected,
    4500,
  );

  state.aiBusy = true;
  state.aiText = "";
  const btn = $("ai-main-btn") as HTMLButtonElement;
  const stop = $("ai-stop-btn");
  btn.disabled = true;
  btn.textContent = "Генерация…";
  stop.hidden = false;
  ($("ai-save") as HTMLButtonElement).disabled = true;
  ($("ai-copy") as HTMLButtonElement).disabled = true;

  const out = $("ai-output");
  out.innerHTML = `<p class="placeholder">Промпт: ${user.length} символов (~${estimateTokens(user.length)} токенов). Генерирую…</p>`;

  let pending = "";
  let frame = 0;
  const flush = (): void => {
    frame = 0;
    streamRender(state.aiText + pending, false);
  };

  try {
    const text = await generate(system, user, (chunk) => {
      state.aiText += chunk;
      if (!frame) frame = requestAnimationFrame(flush);
    });
    if (frame) cancelAnimationFrame(frame);
    state.aiText = text;
    streamRender(text, true);
    toast("Готово");
  } catch (error) {
    console.error(error);
    out.innerHTML = `<p class="placeholder">Ошибка генерации: ${escapeHtml((error as Error).message)}</p>`;
  } finally {
    state.aiBusy = false;
    stop.hidden = true;
    ($("ai-save") as HTMLButtonElement).disabled = false;
    ($("ai-copy") as HTMLButtonElement).disabled = false;
    updateAIButton();
  }
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */

function initFileInput(): void {
  const input = $("file-input") as HTMLInputElement;
  const zone = $("dropzone");

  $("pick-file").addEventListener("click", () => input.click());
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void handleFile(file);
    input.value = "";
  });

  $("try-demo").addEventListener("click", () => {
    loadChatsFrom(DEMO_EXPORT, DEMO_FILENAME);
    toast("Загружено демо — вымышленная переписка");
  });

  $("ai-teaser-btn").addEventListener("click", () => {
    if (!state.analysis) {
      toast("Сначала загрузите файл или откройте демо");
      return;
    }
    setTab("ai");
    document.getElementById("panel-ai")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("reset-btn").addEventListener("click", () => {
    state.chats = [];
    state.analysis = null;
    state.digest = null;
    showWorkspace(false);
    setTab("digest");
  });

  ($("chat-select") as HTMLSelectElement).addEventListener("change", (e) => {
    state.chatIndex = Number((e.target as HTMLSelectElement).value);
    state.theme = "all";
    analyzeCurrent();
  });

  const search = $("search") as HTMLInputElement;
  let timer = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      state.search = search.value;
      renderDigest();
      renderIdeas();
    }, 120);
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      input.click();
    }
  });
}

function initDragDrop(): void {
  const overlay = $("drop-overlay");
  const zone = $("dropzone");
  let depth = 0;

  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    zone.classList.remove("is-drag");
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });
  zone.addEventListener("dragover", () => zone.classList.add("is-drag"));
  zone.addEventListener("dragleave", () => zone.classList.remove("is-drag"));
}

function initSettingsForm(): void {
  const ids = ["set-min-score", "set-top", "set-gap", "set-min-chars"];
  let timer = 0;

  for (const id of ids) {
    const input = $(id) as HTMLInputElement;
    input.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        readSettingsInputs();
        if (state.analysis) {
          analyzeCurrent();
          renderDigest();
          renderIdeas();
        }
      }, 350);
    });
  }

  $("settings-reset").addEventListener("click", () => {
    settings.minScore = DEFAULT_CONFIG.minScore;
    settings.topN = DEFAULT_CONFIG.topN;
    settings.gapSeconds = DEFAULT_CONFIG.gapSeconds;
    settings.minChars = DEFAULT_CONFIG.minChars;
    saveSettings();
    syncSettingsInputs();
    if (state.analysis) {
      analyzeCurrent();
      renderDigest();
      renderIdeas();
    }
  });
}

export function bootstrap(): void {
  initTheme();
  initTabs();
  initFileInput();
  initDragDrop();
  initExport();
  initSettingsForm();
  syncSettingsInputs();
  setTab("digest");

  // Автодемо для скриншотов и быстрого знакомства: ?demo=1
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    loadChatsFrom(DEMO_EXPORT, DEMO_FILENAME);
    if (params.get("tab")) setTab(params.get("tab") as string);
  }
}
