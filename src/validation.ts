import type { Credentials } from "./types.ts";

export const MAX_MESSAGE_LENGTH = 4000;

export function validateCredentials(credentials: Credentials): string | null {
  if (!/^\d+$/.test(credentials.idInstance))
    return "idInstance должен содержать только цифры.";
  if (
    !credentials.apiTokenInstance ||
    /\s/.test(credentials.apiTokenInstance)
  ) {
    return "Введите apiTokenInstance без пробелов.";
  }
  try {
    const url = new URL(credentials.apiUrl);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)green-api\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !["/", "/v3", "/v3/"].includes(url.pathname)
    ) {
      return "Укажите HTTPS-адрес API из кабинета GREEN-API, без параметров и ключа.";
    }
  } catch {
    return "Введите корректный адрес API.";
  }
  return null;
}

export function normalizePhone(value: string): string | null {
  if (!/^\+?[\d\s()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, "");
  return /^(7\d{10}|375\d{9})$/.test(digits) ? digits : null;
}
