import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createApi, errorMessage } from "../api.ts";
import { chatReducer } from "../chat.ts";
import { runInbox } from "../inbox.ts";
import type { InboxStatus } from "../inbox.ts";
import type { Credentials } from "../types.ts";
import { MAX_MESSAGE_LENGTH, normalizePhone } from "../validation.ts";
import { Icon } from "./Icon.tsx";
import { MessagePane } from "./MessagePane.tsx";

export function ChatWorkspace({
  credentials,
  onDisconnect,
}: {
  credentials: Credentials;
  onDisconnect: () => void;
}) {
  const api = useMemo(() => createApi(credentials), [credentials]);
  const [chats, dispatch] = useReducer(chatReducer, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [chatError, setChatError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxStatus>({ state: "connecting" });
  const [retry, setRetry] = useState(0);
  const requests = useRef(new Set<AbortController>());
  const createLock = useRef(false);
  const sendLock = useRef(false);
  const phoneInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void runInbox(
      api,
      controller.signal,
      (incoming) => dispatch({ type: "incoming", incoming }),
      setInbox,
    );
    return () => controller.abort();
  }, [api, retry]);

  useEffect(() => {
    const pending = requests.current;
    return () => {
      pending.forEach((request) => request.abort());
      pending.clear();
    };
  }, []);

  async function openChat(event: FormEvent) {
    event.preventDefault();
    if (createLock.current) return;
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setChatError(
        "Введите номер РФ (+7) или РБ (+375) в международном формате.",
      );
      return;
    }
    const existing = chats.find((chat) => chat.phone === normalized);
    if (existing) {
      setSelectedId(existing.id);
      setPhone("");
      setChatError("");
      return;
    }
    const controller = new AbortController();
    requests.current.add(controller);
    createLock.current = true;
    setCreating(true);
    setChatError("");
    try {
      const id = await api.checkAccount(normalized, controller.signal);
      if (controller.signal.aborted) return;
      dispatch({ type: "open", id, phone: normalized });
      setSelectedId(id);
      setPhone("");
    } catch (cause) {
      if (!controller.signal.aborted) setChatError(errorMessage(cause));
    } finally {
      requests.current.delete(controller);
      createLock.current = false;
      if (!controller.signal.aborted) setCreating(false);
    }
  }

  async function sendMessage() {
    if (!selectedId || sendLock.current) return;
    const chatId = selectedId;
    const text = drafts[chatId] ?? "";
    if (!text.trim() || text.length > MAX_MESSAGE_LENGTH) return;
    // В уведомлениях MAX время приходит с точностью до секунды.
    const timestamp = Math.floor(Date.now() / 1000) * 1000;
    const controller = new AbortController();
    requests.current.add(controller);
    sendLock.current = true;
    setSendingId(chatId);
    setSendErrors((current) => ({ ...current, [chatId]: "" }));
    try {
      const id = await api.sendMessage(chatId, text, controller.signal);
      if (controller.signal.aborted) return;
      dispatch({
        type: "sent",
        chatId,
        message: { id, text, timestamp, direction: "outgoing" },
      });
      setDrafts((current) => ({ ...current, [chatId]: "" }));
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSendErrors((current) => ({
          ...current,
          [chatId]: `${errorMessage(cause)} Текст сохранён. Перед повтором проверьте, не пришло ли сообщение в MAX.`,
        }));
      }
    } finally {
      requests.current.delete(controller);
      sendLock.current = false;
      if (!controller.signal.aborted) setSendingId(null);
    }
  }

  const selected = chats.find((chat) => chat.id === selectedId);
  const statusText = {
    connecting: "Подключаем получение…",
    connected: "Получение подключено",
    retrying: "Восстанавливаем связь…",
    stopped: "Получение приостановлено",
  }[inbox.state];

  return (
    <main className={`chat-app ${selected ? "has-selection" : ""}`}>
      <aside className="sidebar" aria-label="Список чатов">
        <header className="sidebar-header">
          <div className="small-brand">
            <span className="brand-mark">
              <Icon name="chat" />
            </span>
            <div>
              <h1>Чаты</h1>
              <p>MAX · GREEN-API</p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={onDisconnect}
            aria-label="Выйти и очистить сессию"
            title="Выйти и очистить сессию"
          >
            <Icon name="logout" />
          </button>
        </header>
        <form className="new-chat" onSubmit={openChat}>
          <label htmlFor="recipient">Новый чат</label>
          <div className="phone-row">
            <input
              ref={phoneInput}
              id="recipient"
              type="tel"
              autoComplete="off"
              placeholder="Номер телефона с кодом страны"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={creating}
              required
            />
            <button
              className="icon-button add-chat"
              type="submit"
              aria-label="Создать чат"
              disabled={creating || !phone.trim()}
            >
              {creating ? <span className="spinner" /> : <Icon name="plus" />}
            </button>
          </div>
          {chatError && (
            <p className="error" role="alert">
              {chatError}
            </p>
          )}
        </form>
        <nav className="chat-list" aria-label="Чаты">
          {chats.length === 0 && (
            <div className="sidebar-empty">
              <p>Здесь будут ваши чаты</p>
              <span>
                Введите номер получателя
                <br />и начните переписку.
              </span>
            </div>
          )}
          {chats.map((chat) => {
            const last = chat.messages.at(-1);
            return (
              <button
                key={chat.id}
                className={`chat-item ${selectedId === chat.id ? "selected" : ""}`}
                onClick={() => setSelectedId(chat.id)}
                aria-current={selectedId === chat.id ? "true" : undefined}
              >
                <span className="avatar">
                  {chat.name.replace("+", "").slice(0, 2).toUpperCase()}
                </span>
                <span className="chat-preview">
                  <strong>{chat.name}</strong>
                  <span>
                    {last
                      ? `${last.direction === "outgoing" ? "Вы: " : ""}${last.text}`
                      : "Нет сообщений"}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
        {inbox.error && !selected && (
          <div className="mobile-inbox-error connection-error" role="alert">
            <span>{inbox.error}</span>
            {inbox.state === "stopped" && (
              <button
                onClick={() => {
                  setInbox({ state: "connecting" });
                  setRetry((value) => value + 1);
                }}
              >
                Повторить
              </button>
            )}
          </div>
        )}
        <footer className="sidebar-footer">
          <span className="status-line" role="status">
            <i className={`status-dot ${inbox.state}`} />
            {statusText}
          </span>
          <span className="muted">Сессия {credentials.idInstance}</span>
        </footer>
      </aside>
      <div className="chat-main">
        {inbox.error && (
          <div className="connection-error" role="alert">
            <span>
              {inbox.error}{" "}
              {inbox.state === "retrying" && "Повторим автоматически."}
            </span>
            {inbox.state === "stopped" && (
              <button
                onClick={() => {
                  setInbox({ state: "connecting" });
                  setRetry((value) => value + 1);
                }}
              >
                Повторить
              </button>
            )}
          </div>
        )}
        {selected ? (
          <MessagePane
            chat={selected}
            draft={drafts[selected.id] ?? ""}
            sending={sendingId === selected.id}
            sendDisabled={sendingId !== null}
            error={sendErrors[selected.id]}
            onDraft={(value) =>
              setDrafts((current) => ({ ...current, [selected.id]: value }))
            }
            onSend={() => void sendMessage()}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <section className="welcome">
            <div className="welcome-icon">
              <Icon name="chat" />
            </div>
            <h2>Начните с одного сообщения</h2>
            <p>
              Создайте чат по номеру телефона
              <br />
              или выберите существующий слева.
            </p>
            <button
              className="secondary"
              onClick={() => phoneInput.current?.focus()}
            >
              Новый чат
            </button>
            <span className="welcome-footnote">
              Только текст. Всё необходимое для разговора.
            </span>
          </section>
        )}
      </div>
    </main>
  );
}
