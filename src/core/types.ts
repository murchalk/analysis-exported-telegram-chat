/** Общие типы: сырой экспорт Telegram → нормализованные сообщения → фрагменты. */

export interface RawMessage {
  id?: number | string;
  type?: string;
  date?: string;
  from?: string;
  text?: unknown;
  text_entities?: unknown;
  reactions?: Array<{ count?: number }>;
  reply_to_message_id?: number;
  photo?: string;
  file?: string;
  file_name?: string;
  media_type?: string;
  sticker_emoji?: string;
  voice_message?: string;
  audio_file?: string;
  video_file?: string;
  [key: string]: unknown;
}

export interface Chat {
  name: string;
  type: string;
  messages: RawMessage[];
}

export interface Msg {
  id: number | string | null;
  ts: Date;
  author: string;
  text: string;
  links: string[];
  replyTo: number | null;
  reactions: number;
}

export interface Unit {
  ids: Array<number | string | null>;
  start: Date;
  end: Date;
  author: string;
  text: string;
  links: string[];
  reactions: number;
  replyTo: number | null;
  score: number;
  reasons: string[];
  theme: string;
  cats: string[];
}

export interface Stats {
  messages: number;
  units: number;
  period: { from: string; to: string } | null;
  authors: Array<[string, number]>;
  days: Record<string, number>;
  topWords: Array<[string, number]>;
  themes: Array<[string, number]>;
  avgChars: number;
}

export interface Resources {
  urls: Array<[string, number]>;
  handles: Array<[string, number]>;
  domains: Array<[string, number]>;
}

export interface Analysis {
  chat: Chat;
  msgs: Msg[];
  units: Unit[];
  selected: Unit[];
  stats: Stats;
  resources: Resources;
}

export interface Fragment {
  when: string;
  author: string;
  text: string;
  theme: string;
  score: number;
}
