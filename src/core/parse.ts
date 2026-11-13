/** Разбор result.json: чаты, текст с сущностями, маскировка секретов. */

import type { Chat, Msg, RawMessage } from "./types";

/* ------------------------------------------------------------------ */
/* Имена                                                               */
/* ------------------------------------------------------------------ */

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export function cleanName(name: string): string {
  const cleaned = name.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return cleaned || "—";
}

/* ------------------------------------------------------------------ */
/* Текст                                                               */
/* ------------------------------------------------------------------ */

interface TextPart {
  type?: string;
  text?: string;
  href?: string;
}

export function renderText(m: RawMessage): { text: string; links: string[] } {
  const t = m.text;
  const links: string[] = [];
  let raw = "";

  if (typeof t === "string") {
    raw = t;
  } else if (Array.isArray(t)) {
    for (const p of t) {
      if (typeof p === "string") {
        raw += p;
        continue;
      }
      const part = p as TextPart;
      const value = part.text ?? "";
      if (part.type === "text_link" && part.href) links.push(part.href);
      if (part.type === "code" || part.type === "pre") raw += "`" + value + "`";
      else if (part.type === "blockquote") raw += "> " + value;
      else raw += value;
    }
  }

  return { text: raw.trim(), links };
}

function mediaMarker(m: RawMessage): string {
  if (m.photo) return "[фото]";
  if (m.sticker_emoji) return `[стикер ${m.sticker_emoji}]`;
  if (m.media_type) return `[${m.media_type}]`;
  if (m.file_name) return `[файл ${m.file_name}]`;
  if (m.voice_message || m.audio_file) return "[аудио]";
  if (m.video_file) return "[видео]";
  return "[медиа]";
}

function reactionsCount(m: RawMessage): number {
  let total = 0;
  for (const r of m.reactions ?? []) total += Number(r?.count ?? 0) || 0;
  return total;
}

/* ------------------------------------------------------------------ */
/* Маскировка                                                          */
/* ------------------------------------------------------------------ */

const SECRET_WORDS =
  /(?<![\p{L}\p{N}_])(?:api[_-]?key|apikey|token|secret|password|passwd|pwd|пароль|токен|seed|mnemonic|приватн\p{L}*\s+ключ)(?![\p{L}\p{N}_])/iu;
const SECRET_LINE_VALUE = /[:=—–]\s*\S{2,}/;
const SECRET_INLINE =
  /(?<![\p{L}\p{N}_])((?:api[_-]?key|apikey|token|secret|password|passwd|pwd|пароль|токен))(\s+)(\S{3,})/giu;

const FINAL_REDACTIONS: Array<[RegExp, string]> = [
  [/\b(?:0x[a-fA-F0-9]{40}|[EU]Q[A-Za-z0-9_-]{46})\b/g, "<кошелёк скрыт>"],
  [/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, "<email скрыт>"],
  [/(?<!\d)(?:\+7|8)[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g, "<телефон скрыт>"],
  [/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}(?!\d)/g, "<карта скрыта>"],
];

export function redact(text: string): string {
  const lines = text.split("\n").map((line) => {
    if (!SECRET_WORDS.test(line)) return line;
    const found = SECRET_LINE_VALUE.exec(line);
    if (found) return line.slice(0, found.index) + ": <секрет скрыт>";
    return line.replace(SECRET_INLINE, "$1$2<секрет скрыт>");
  });
  let out = lines.join("\n");
  for (const [re, repl] of FINAL_REDACTIONS) out = out.replace(re, repl);
  return out;
}

/* ------------------------------------------------------------------ */
/* Загрузка                                                            */
/* ------------------------------------------------------------------ */

function asChat(value: unknown, fallbackName: string): Chat {
  const obj = value as Record<string, unknown>;
  return {
    name: typeof obj?.name === "string" && obj.name ? obj.name : fallbackName,
    type: typeof obj?.type === "string" ? obj.type : "",
    messages: Array.isArray(obj?.messages) ? (obj.messages as RawMessage[]) : [],
  };
}

export function loadChats(data: unknown): Chat[] {
  if (Array.isArray(data)) return [asChat({ messages: data }, "export")];

  const root = data as Record<string, unknown>;
  if (Array.isArray(root?.messages)) return [asChat(root, "чат")];

  const chatsField = root?.chats as unknown;
  const list = Array.isArray(chatsField)
    ? chatsField
    : Array.isArray((chatsField as Record<string, unknown>)?.list)
      ? ((chatsField as Record<string, unknown>).list as unknown[])
      : [];

  return list.map((c, i) => asChat(c, `чат ${i + 1}`));
}

const MEDIA_KEYS: Array<keyof RawMessage> = [
  "photo", "file", "sticker_emoji", "media_type", "voice_message", "audio_file", "video_file",
];

export function extractMessages(chat: Chat, redactText = true): Msg[] {
  const out: Msg[] = [];

  for (const m of chat.messages) {
    if (m.type === "service") continue;

    const { text: rendered, links } = renderText(m);
    let text = rendered;
    if (!text) {
      if (MEDIA_KEYS.some((k) => m[k])) text = mediaMarker(m);
      else continue;
    }
    if (!m.date) continue;

    const ts = new Date(m.date);
    if (Number.isNaN(ts.getTime())) continue;

    out.push({
      id: m.id ?? null,
      ts,
      author: cleanName(String(m.from ?? (m.actor as string) ?? "—")),
      text: redactText ? redact(text) : text,
      links,
      replyTo: (m.reply_to_message_id as number) ?? null,
      reactions: reactionsCount(m),
    });
  }

  return out.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

export function isMediaOnly(text: string): boolean {
  return /^\[[^\]]{0,60}\]$/.test(text.trim());
}
