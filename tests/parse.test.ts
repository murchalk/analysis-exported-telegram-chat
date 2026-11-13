import { describe, expect, it } from "vitest";
import { extractMessages, loadChats, redact } from "../src/core/parse";

const entityChat = {
  name: "Тест",
  type: "personal_chat",
  messages: [
    { id: 1, type: "service", date: "2026-01-01T10:00:00", text: "" },
    {
      id: 2,
      type: "message",
      date: "2026-01-01T10:01:00",
      from: "Аня",
      text: [
        { type: "plain", text: "Идея: сервис " },
        { type: "text_link", text: "мониторинга", href: "https://example.com" },
        { type: "plain", text: " цен. Ниша пустая." },
      ],
    },
    { id: 3, type: "message", date: "2026-01-01T10:05:00", from: "Борис", text: "" },
    { id: 4, type: "message", date: "2026-01-01T10:06:00", from: "Борис", photo: "x.jpg" },
  ],
};

describe("loadChats", () => {
  it("читает одиночный чат", () => {
    const chats = loadChats(entityChat);
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe("Тест");
  });

  it("читает мультичат-экспорт", () => {
    const chats = loadChats({ chats: { list: [entityChat, { name: "Второй", messages: [] }] } });
    expect(chats.map((c) => c.name)).toEqual(["Тест", "Второй"]);
  });

  it("читает голый список сообщений", () => {
    const chats = loadChats(entityChat.messages);
    expect(chats[0].messages).toHaveLength(entityChat.messages.length);
  });
});

describe("extractMessages", () => {
  const msgs = extractMessages(loadChats(entityChat)[0], true);

  it("пропускает служебные и пустые, но сохраняет медиа-заглушки", () => {
    expect(msgs.map((m) => m.id)).toEqual([2, 4]);
  });

  it("собирает текст из сущностей и не теряет ссылки", () => {
    expect(msgs[0].text).toBe("Идея: сервис мониторинга цен. Ниша пустая.");
    expect(msgs[0].links).toContain("https://example.com");
  });

  it("помечает фото", () => {
    expect(msgs[1].text).toBe("[фото]");
  });
});

describe("redact", () => {
  it("скрывает пароль и токен", () => {
    const out = redact("Пароль от админки: hunter2\napi_key=sk-test-1234567890");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("sk-test");
    expect(out).toContain("<секрет скрыт>");
  });

  it("скрывает кошелёк и телефон", () => {
    const out = redact("0x1234567890abcdef1234567890abcdef12345678 +7 999 123-45-67");
    expect(out).toContain("<кошелёк скрыт>");
    expect(out).toContain("<телефон скрыт>");
  });

  it("не портит обычные суммы", () => {
    expect(redact("Продал за 300 000 ₽")).toBe("Продал за 300 000 ₽");
  });
});
