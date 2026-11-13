/**
 * Конфигурация анализа: темы, маркеры, веса.
 * Всё, что влияет на отбор, живёт здесь и меняется без правки логики.
 */

export interface Theme {
  id: string;
  title: string;
  keywords: string[];
}

export interface Weights {
  length: number;
  marker: number;
  markerCap: number;
  number: number;
  question: number;
  tech: number;
  techCap: number;
  reaction: number;
  reactionCap: number;
  link: number;
  sentence: number;
  shortPenalty: number;
  smalltalkPenalty: number;
}

export interface Config {
  gapSeconds: number;
  maxUnitChars: number;
  minScore: number;
  minChars: number;
  topN: number;
  dedupeRatio: number;
  redact: boolean;
  weights: Weights;
  themes: Theme[];
  patterns: Record<MarkerKind, RegExp[]>;
  stopwords: string[];
}

export type MarkerKind = "idea" | "insight" | "advice" | "risk" | "money" | "smalltalk";

// JS-регулярки не считают кириллицу «словом» для \b, поэтому используем
// Unicode-просмотры: граница — любой не-символ-буквы.
const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";
const rx = (source: string): RegExp => new RegExp(source, "giu");

export const THEMES: Theme[] = [
  {
    id: "sales_money",
    title: "Продажи, цена, деньги",
    keywords: [
      "прода", "цен", "ценник", "бабл", "деньг", "руб", "доллар", "usd", "оплат",
      "чек", "доход", "прибыл", "выручк", "заработ", "заказ", "клиент", "бюджет",
      "курс", "окупа", "мани", "money", "price", "sell", "revenue", "income",
    ],
  },
  {
    id: "ai_dev",
    title: "ИИ и разработка",
    keywords: [
      "гпт", "gpt", "ии", "нейросет", "промпт", "код", "разраб", "бот", "апи", "api",
      "питон", "python", "sql", "архитектур", "aiogram", "аиограм", "скрипт",
      "функци", "интеграц", "автоматиз", "llm", "claude", "code",
    ],
  },
  {
    id: "tech_infra",
    title: "Техника и инфраструктура",
    keywords: [
      "vpn", "впн", "панел", "3x-ui", "marzban", "сервер", "хост", "домен", "ssl",
      "подписк", "конфиг", "ubuntu", "деплой", "nginx", "clash", "v2ray", "hiddify",
      "база", "бд", "database", "server", "hosting", "domain", "api",
    ],
  },
  {
    id: "networking",
    title: "Знакомства и связи",
    keywords: [
      "знаком", "связ", "друз", "нетворк", "партн", "обща", "люди", "команд",
      "коллег", "друзья", "network", "partner", "team",
    ],
  },
  {
    id: "market",
    title: "Рынок, ниши, конкуренция",
    keywords: [
      "рынок", "ниш", "конкурент", "спрос", "продукт", "уникальн", "тренд",
      "мемкоин", "крипт", "крипта", "маркетинг", "аудитор", "таргет", "трафик",
      "market", "niche", "competitor", "product", "traffic",
    ],
  },
  {
    id: "risks",
    title: "Риски и этика",
    keywords: [
      "риск", "опасн", "нельзя", "низя", "закон", "бан", "блокир", "слит",
      "стиллер", "воров", "обман", "скам", "схем", "грязн", "рискован", "легальн",
    ],
  },
  {
    id: "growth",
    title: "Опыт, обучение, планы",
    keywords: [
      "опыт", "навык", "учит", "мотивац", "план", "цель", "развит", "карьер",
      "ошибк", "урок", "понял", "вывод", "научил", "практик", "эксперимент",
    ],
  },
  {
    id: "personal",
    title: "Личное и контекст",
    keywords: [
      "работ", "студи", "банк", "переезд", "дубай", "возраст", "лет", "живу",
      "город", "семь", "отпуск", "здоров",
    ],
  },
];

export const PATTERNS: Record<MarkerKind, RegExp[]> = {
  idea: [
    rx(`${B}иде[яйю]${E}`),
    rx(`${B}придумал`),
    rx(`${B}а что если${E}`),
    rx(`${B}можно (?:сделать|запустить|продавать|построить|организовать|собрать)${E}`),
    rx(`${B}давай(?:те)? (?:сделаем|запустим|попробуем)${E}`),
    rx(`${B}хочу (?:сделать|запустить|собрать|попробовать)${E}`),
    rx(`${B}план[а-я]*${E}`),
    rx(`${B}схем[а-я]*${E}`),
    rx(`${B}idea${E}`),
    rx(`${B}what if${E}`),
    rx(`${B}plan${E}`),
  ],
  insight: [
    rx(`${B}понял`),
    rx(`${B}оказывается${E}`),
    rx(`${B}вывод${E}`),
    rx(`${B}суть${E}`),
    rx(`${B}смысл${E}`),
    rx(`${B}получается${E}`),
    rx(`${B}значит${E}`),
    rx(`${B}в итоге${E}`),
    rx(`${B}дело в том${E}`),
    rx(`${B}заметил`),
    rx(`${B}осознал`),
    rx(`${B}пришло понимание${E}`),
    rx(`${B}вот почему${E}`),
    rx(`${B}note that${E}`),
    rx(`${B}i realized${E}`),
    rx(`${B}the point is${E}`),
    rx(`${B}insight${E}`),
  ],
  advice: [
    rx(`${B}надо${E}`),
    rx(`${B}нужно${E}`),
    rx(`${B}делай${E}`),
    rx(`${B}бери${E}`),
    rx(`${B}старайся${E}`),
    rx(`${B}ищи${E}`),
    rx(`${B}учись${E}`),
    rx(`${B}не продавай${E}`),
    rx(`${B}не ссы${E}`),
    rx(`${B}запомни${E}`),
    rx(`${B}совет${E}`),
    rx(`${B}лучше (?:сделать|брать|ставить|начать)${E}`),
    rx(`${B}попробуй${E}`),
    rx(`${B}should${E}`),
    rx(`${B}try to${E}`),
    rx(`${B}advice${E}`),
    rx(`${B}recommend`),
  ],
  risk: [
    rx(`${B}опасн`),
    rx(`${B}риск`),
    rx(`${B}нельзя${E}`),
    rx(`${B}низя${E}`),
    rx(`${B}запрещ`),
    rx(`${B}закон${E}`),
    rx(`${B}бан${E}`),
    rx(`${B}блокир`),
    rx(`${B}слит`),
    rx(`${B}стиллер`),
    rx(`${B}воров`),
    rx(`${B}обман${E}`),
    rx(`${B}скам${E}`),
    rx(`${B}осторожн`),
    rx(`${B}illegal${E}`),
    rx(`${B}scam${E}`),
    rx(`${B}risk${E}`),
  ],
  money: [rx("\\d+\\s*(?:₽|руб|р\\.|рубл)"), rx("\\d+\\s*(?:\\$|доллар|usd|eur|евро)"), rx("\\d+\\s*%")],
  smalltalk: [
    rx("^(?:да|нет|ага|угу|ок|окей|понял|привет|ку|йоу|q|qq|а|ааа|ессс)[.!)\\s]*$"),
    rx("^(?:да|нет|ага|ок)(?:[\\s.,!]|$)"),
  ],
};

export const STOPWORDS = new Set([
  "что", "это", "как", "так", "все", "ещё", "еще", "уже", "или", "был", "была", "были",
  "быть", "есть", "нет", "для", "про", "при", "над", "под", "без", "через", "тоже",
  "очень", "просто", "вообще", "себе", "меня", "тебя", "его", "она", "они", "мы", "вы",
  "я", "ты", "он", "там", "тут", "где", "когда", "если", "чтобы", "чем", "то",
  "же", "ли", "бы", "не", "ни", "в", "на", "с", "и", "а", "но", "у", "о", "по", "из",
  "за", "от", "до", "the", "and", "you", "that", "this", "with", "for", "have", "not",
  "are", "was", "but", "can", "will", "just", "your", "вот", "мне", "нас", "вас",
  "надо", "можно", "нужно", "тебе", "сейчас", "даже", "тогда", "только", "пока",
  "около", "точно", "важно", "много", "знает", "начал", "делать", "будет",
  "сказал", "говорит", "хочу", "хочешь", "знаю", "знаешь", "думаю", "понимаю",
  "фото", "стикер", "файл", "медиа", "аудио", "видео",
]);

export const DEFAULT_CONFIG: Config = {
  gapSeconds: 180,
  maxUnitChars: 1500,
  minScore: 2.6,
  minChars: 60,
  topN: 40,
  dedupeRatio: 0.9,
  redact: true,
  weights: {
    length: 3,
    marker: 1.2,
    markerCap: 3,
    number: 1,
    question: 0.8,
    tech: 0.5,
    techCap: 1.5,
    reaction: 0.4,
    reactionCap: 2,
    link: 0.4,
    sentence: 0.6,
    shortPenalty: -3,
    smalltalkPenalty: -2,
  },
  themes: THEMES,
  patterns: PATTERNS,
  stopwords: [...STOPWORDS],
};

export const CATEGORY_TITLES: Record<string, string> = {
  idea: "Идеи и планы",
  insight: "Выводы и наблюдения",
  advice: "Практические советы",
  risk: "Риски и ограничения",
  money: "Цифры и деньги",
};

export function themeTitle(id: string): string {
  return THEMES.find((t) => t.id === id)?.title ?? "Прочее";
}
