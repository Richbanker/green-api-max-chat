import { useEffect, useRef } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { Chat } from "../types.ts";
import { MAX_MESSAGE_LENGTH } from "../validation.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  chat: Chat;
  draft: string;
  sending: boolean;
  sendDisabled: boolean;
  error?: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
}

const timeFormat = new Intl.DateTimeFormat("ru", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "long",
});

export function MessagePane({
  chat,
  draft,
  sending,
  sendDisabled,
  error,
  onDraft,
  onSend,
  onBack,
}: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.id, chat.messages.length]);
  useEffect(() => {
    if (!sending) textarea.current?.focus();
  }, [chat.id, sending]);
  const canSend =
    !!draft.trim() && draft.length <= MAX_MESSAGE_LENGTH && !sendDisabled;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSend) onSend();
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <section className="conversation" aria-label={`Переписка: ${chat.name}`}>
      <header className="conversation-header">
        <button
          className="icon-button mobile-back"
          onClick={onBack}
          aria-label="К списку чатов"
        >
          <Icon name="back" />
        </button>
        <span className="avatar">
          {chat.name.replace("+", "").slice(0, 2).toUpperCase()}
        </span>
        <div className="contact-heading">
          <h2>{chat.name}</h2>
          <p>{chat.phone ? `+${chat.phone} · MAX` : "Личный чат MAX"}</p>
        </div>
      </header>
      <div
        className="messages"
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
        aria-relevant="additions"
      >
        {chat.messages.length === 0 && (
          <div className="conversation-empty">
            <Icon name="chat" />
            <h3>Начните разговор</h3>
            <p>
              Напишите первое сообщение.
              <br />
              Ответ появится здесь.
            </p>
          </div>
        )}
        {chat.messages.map((message, index) => {
          const previous = chat.messages[index - 1];
          const date = new Date(message.timestamp);
          const showDate =
            !previous ||
            new Date(previous.timestamp).toDateString() !== date.toDateString();
          return (
            <div className="message-group" key={message.id}>
              {showDate && (
                <div className="date-divider">{dateFormat.format(date)}</div>
              )}
              <article className={`bubble ${message.direction}`}>
                <p>{message.text}</p>
                <div className="message-meta">
                  {message.direction === "outgoing" && (
                    <span title="GREEN-API принял сообщение в очередь; доставка не подтверждена">
                      Принято API
                    </span>
                  )}
                  <time dateTime={date.toISOString()}>
                    {timeFormat.format(date)}
                  </time>
                </div>
              </article>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form className="composer" onSubmit={submit}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-row">
          <textarea
            ref={textarea}
            aria-label="Сообщение"
            placeholder="Напишите сообщение…"
            rows={2}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={keyDown}
            disabled={sending}
          />
          <button
            type="submit"
            className="send-button"
            aria-label="Отправить сообщение"
            disabled={!canSend}
          >
            {sending ? <span className="spinner" /> : <Icon name="send" />}
          </button>
        </div>
        <div className="composer-hint">
          <span>Enter — отправить · Shift + Enter — новая строка</span>
          <span
            className={draft.length > MAX_MESSAGE_LENGTH ? "over-limit" : ""}
          >
            {draft.length} / {MAX_MESSAGE_LENGTH}
          </span>
        </div>
      </form>
    </section>
  );
}
