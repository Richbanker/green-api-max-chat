import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createApi, errorMessage } from "../api.ts";
import type { Credentials } from "../types.ts";
import { validateCredentials } from "../validation.ts";
import { Icon } from "./Icon.tsx";

export function Login({
  onConnect,
}: {
  onConnect: (credentials: Credentials) => void;
}) {
  const [id, setId] = useState("");
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState(
    import.meta.env.VITE_GREEN_API_URL || "https://api.green-api.com",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const credentials = {
      idInstance: id.trim(),
      apiTokenInstance: token.trim(),
      apiUrl: apiUrl.trim(),
    };
    const invalid = validateCredentials(credentials);
    if (invalid) {
      setError(invalid);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setLoading(true);
    try {
      await createApi(credentials).checkConnection(controller.signal);
      if (!controller.signal.aborted) onConnect(credentials);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark">
          <Icon name="chat" />
        </div>
        <p className="eyebrow">MAX · GREEN-API</p>
        <h1 id="login-title">
          Ваши сообщения.
          <br />В одном окне.
        </h1>
        <p className="muted intro">
          Подключите инстанс MAX, чтобы начать переписку.
        </p>
        <form onSubmit={connect}>
          <fieldset disabled={loading}>
            <label htmlFor="instance">idInstance</label>
            <input
              id="instance"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Номер инстанса"
              value={id}
              onChange={(event) => setId(event.target.value)}
              required
            />
            <label htmlFor="token">apiTokenInstance</label>
            <input
              id="token"
              type="password"
              autoComplete="off"
              placeholder="Ключ доступа"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <details>
              <summary>Адрес API</summary>
              <label htmlFor="api-url">apiUrl из личного кабинета</label>
              <input
                id="api-url"
                type="url"
                autoComplete="off"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                required
              />
            </details>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary connect-button"
            disabled={loading}
            type="submit"
          >
            {loading && <span className="spinner" />}
            {loading ? "Подключаемся…" : "Открыть чат"}
          </button>
        </form>
        <p className="session-note">
          Ключ и переписка хранятся только в памяти этой вкладки. При обновлении
          страницы они удалятся.
        </p>
        <a
          className="help-link"
          href="https://console.green-api.com/"
          target="_blank"
          rel="noreferrer"
        >
          Личный кабинет GREEN-API ↗
        </a>
      </section>
    </main>
  );
}
