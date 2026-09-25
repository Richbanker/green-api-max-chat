import type { Credentials, Notification } from "./types.ts";
import { MAX_MESSAGE_LENGTH, validateCredentials } from "./validation.ts";

export class ApiError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.retryable = retryable;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Не удалось выполнить запрос. Попробуйте ещё раз.";
}

function responseError(status: number, data: unknown): ApiError {
  const detail = isRecord(data)
    ? String(data.message ?? data.reason ?? "")
    : "";
  if (/webhook.*url/i.test(detail)) {
    return new ApiError(
      "Очистите webhookUrl в кабинете GREEN-API и повторите через минуту.",
    );
  }
  if (/not authorized|starting/i.test(detail)) {
    return new ApiError(
      "Авторизуйте инстанс MAX в кабинете GREEN-API и дождитесь его запуска.",
    );
  }
  if (status === 469 || /contact info limit/i.test(detail)) {
    return new ApiError(
      "MAX временно ограничил проверку номеров. Повторите позже.",
    );
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      "Нет доступа. Проверьте idInstance, токен, адрес API и ограничения аккаунта.",
    );
  }
  if (status === 429)
    return new ApiError(
      "Превышен лимит запросов GREEN-API. Подождите немного.",
      true,
    );
  if (status >= 500)
    return new ApiError("GREEN-API временно недоступен.", true);
  return new ApiError(
    "GREEN-API отклонил запрос. Проверьте данные и настройки инстанса.",
  );
}

export function createApi(credentials: Credentials) {
  const validationError = validateCredentials(credentials);
  if (validationError) throw new ApiError(validationError);
  const base = `${credentials.apiUrl.replace(/\/$/, "")}/waInstance${credentials.idInstance}`;
  const token = encodeURIComponent(credentials.apiTokenInstance);

  async function request(
    method: string,
    signal: AbortSignal,
    options: {
      verb?: string;
      body?: unknown;
      suffix?: string;
      timeout?: number;
    } = {},
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(options.timeout ?? 20000);
    try {
      const response = await fetch(
        `${base}/${method}/${token}${options.suffix ?? ""}`,
        {
          method: options.verb ?? "GET",
          headers:
            options.body === undefined
              ? undefined
              : { "Content-Type": "application/json" },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: AbortSignal.any([signal, timeoutSignal]),
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        },
      );
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = raw.trim() ? JSON.parse(raw) : null;
      } catch {
        if (!response.ok) throw responseError(response.status, null);
        throw new ApiError("GREEN-API вернул некорректный ответ.", true);
      }
      if (
        !response.ok ||
        (isRecord(data) && (data.status === "error" || data.status === false))
      ) {
        throw responseError(response.status, data);
      }
      return data;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ApiError) throw error;
      if (timeoutSignal.aborted)
        throw new ApiError("Время ожидания ответа истекло.", true);
      // Не выводим исходную ошибку fetch: URL запроса содержит токен.
      throw new ApiError(
        "Не удалось связаться с GREEN-API. Проверьте сеть и адрес API.",
        true,
      );
    }
  }

  return {
    async checkConnection(signal: AbortSignal) {
      const data = await request("getStateInstance", signal);
      if (!isRecord(data) || typeof data.stateInstance !== "string") {
        throw new ApiError("Не удалось определить состояние инстанса.");
      }
      if (data.stateInstance !== "authorized") {
        throw new ApiError(
          "Инстанс не готов. Проверьте авторизацию и статус MAX в кабинете GREEN-API.",
        );
      }
    },
    async checkAccount(phone: string, signal: AbortSignal): Promise<string> {
      const data = await request("checkAccount", signal, {
        verb: "POST",
        body: { phoneNumber: Number(phone) },
      });
      if (isRecord(data) && data.exist === false) {
        throw new ApiError(
          "Аккаунт MAX не найден или скрыт настройками приватности.",
        );
      }
      if (
        !isRecord(data) ||
        data.exist !== true ||
        typeof data.chatId !== "string" ||
        !data.chatId
      ) {
        throw new ApiError("Не удалось получить идентификатор чата MAX.");
      }
      return data.chatId;
    },
    async sendMessage(
      chatId: string,
      message: string,
      signal: AbortSignal,
    ): Promise<string> {
      if (!message.trim() || message.length > MAX_MESSAGE_LENGTH) {
        throw new ApiError("Введите сообщение длиной от 1 до 4000 символов.");
      }
      const data = await request("sendMessage", signal, {
        verb: "POST",
        body: { chatId, message },
      });
      if (
        !isRecord(data) ||
        typeof data.idMessage !== "string" ||
        !data.idMessage
      ) {
        throw new ApiError(
          "GREEN-API не подтвердил отправку. Перед повтором проверьте чат в MAX.",
        );
      }
      return data.idMessage;
    },
    async receiveNotification(
      signal: AbortSignal,
    ): Promise<Notification | null> {
      const data = await request("receiveNotification", signal, {
        suffix: "?receiveTimeout=30",
        timeout: 40000,
      });
      if (data === null) return null;
      if (
        !isRecord(data) ||
        !Number.isSafeInteger(data.receiptId) ||
        !isRecord(data.body)
      ) {
        throw new ApiError(
          "Некорректное уведомление GREEN-API. Получение приостановлено.",
        );
      }
      return { receiptId: data.receiptId as number, body: data.body };
    },
    async deleteNotification(receiptId: number, signal: AbortSignal) {
      const data = await request("deleteNotification", signal, {
        verb: "DELETE",
        suffix: `/${receiptId}`,
      });
      if (!isRecord(data) || data.result !== true) {
        throw new ApiError(
          "Не удалось подтвердить уведомление. Убедитесь, что инстанс открыт только в одной вкладке.",
        );
      }
    },
  };
}

export type GreenApi = ReturnType<typeof createApi>;
