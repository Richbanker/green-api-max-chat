import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApi } from "../src/api.ts";
import { chatReducer, parseIncoming } from "../src/chat.ts";
import { runInbox, wait } from "../src/inbox.ts";
import { normalizePhone, validateCredentials } from "../src/validation.ts";

const credentials = {
  idInstance: "3100000000",
  apiTokenInstance: "test-token",
  apiUrl: "https://api.green-api.com",
};
const body = {
  typeWebhook: "incomingMessageReceived",
  idMessage: "message-1",
  timestamp: 1763115112,
  senderData: {
    chatId: "10000000",
    senderName: "Получатель",
    chatType: "user",
  },
  messageData: {
    typeMessage: "textMessage",
    textMessageData: { textMessage: "Привет" },
  },
};

test("phone normalization follows MAX CheckAccount contract", () => {
  assert.equal(normalizePhone("+7 (999) 123-45-67"), "79991234567");
  assert.equal(normalizePhone("+375 29 123-45-67"), "375291234567");
  for (const phone of [
    "89991234567",
    "123",
    "+1 202 555 0123",
    "abc79991234567",
    "7+9991234567",
  ]) {
    assert.equal(normalizePhone(phone), null);
  }
});

test("credentials cannot be sent to an arbitrary host", () => {
  assert.equal(validateCredentials(credentials), null);
  assert.equal(
    validateCredentials({
      ...credentials,
      apiUrl: "https://3100.api.green-api.com",
    }),
    null,
  );
  for (const apiUrl of [
    "http://api.green-api.com",
    "https://green-api.com.evil.test",
    "https://evil.test",
    "https://user:pass@api.green-api.com",
    "https://api.green-api.com?token=123",
  ]) {
    assert.ok(validateCredentials({ ...credentials, apiUrl }));
  }
});

test("text and extended text are read; media, groups and outgoing events are ignored", () => {
  assert.equal(parseIncoming(body).message.text, "Привет");
  assert.equal(
    parseIncoming({
      ...body,
      messageData: {
        typeMessage: "extendedTextMessage",
        extendedTextMessageData: { text: "https://example.com" },
      },
    }).message.text,
    "https://example.com",
  );
  assert.equal(
    parseIncoming({ ...body, messageData: { typeMessage: "imageMessage" } }),
    null,
  );
  assert.equal(
    parseIncoming({ ...body, typeWebhook: "outgoingMessageReceived" }),
    null,
  );
  assert.equal(
    parseIncoming({
      ...body,
      senderData: { ...body.senderData, chatType: "group" },
    }),
    null,
  );
  assert.throws(() => parseIncoming({ ...body, idMessage: null }), ApiError);
});

test("repeated notifications do not duplicate messages; opening by phone preserves history", () => {
  const incoming = parseIncoming(body);
  let chats = chatReducer([], { type: "incoming", incoming });
  chats = chatReducer(chats, { type: "incoming", incoming });
  chats = chatReducer(chats, {
    type: "open",
    id: incoming.chatId,
    phone: "79991234567",
  });
  assert.equal(chats.length, 1);
  assert.equal(chats[0].messages.length, 1);
  assert.equal(chats[0].phone, "79991234567");
});

test("API uses MAX chatId, exact text, correct methods and acknowledgement receipt", async (t) => {
  const calls = [];
  const responses = [
    { stateInstance: "authorized" },
    { exist: true, chatId: "10000000" },
    { idMessage: "sent-1" },
    { receiptId: 123, body },
    { result: true },
  ];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(responses.shift());
  });
  const api = createApi(credentials);
  const signal = new AbortController().signal;
  await api.checkConnection(signal);
  const chatId = await api.checkAccount("79991234567", signal);
  await api.sendMessage(chatId, "  Текст\nсообщения  ", signal);
  const notification = await api.receiveNotification(signal);
  await api.deleteNotification(notification.receiptId, signal);
  assert.deepEqual(JSON.parse(calls[1].body), { phoneNumber: 79991234567 });
  assert.deepEqual(JSON.parse(calls[2].body), {
    chatId: "10000000",
    message: "  Текст\nсообщения  ",
  });
  assert.equal(calls[2].method, "POST");
  assert.equal(calls[4].method, "DELETE");
  assert.match(calls[4].url, /deleteNotification\/test-token\/123$/);
  assert.equal(calls[2].credentials, "omit");
  assert.equal(calls[2].redirect, "error");
  await assert.rejects(api.sendMessage(chatId, " ".repeat(4), signal));
  await assert.rejects(api.sendMessage(chatId, "a".repeat(4001), signal));
  assert.equal(calls.length, 5);
});

test("empty polling response is normal; HTTP and business errors are handled without exposing secrets", async (t) => {
  const signal = new AbortController().signal;
  const api = createApi(credentials);
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(""),
  );
  assert.equal(await api.receiveNotification(signal), null);
  fetchMock.mock.mockImplementation(async () =>
    Response.json({ message: credentials.apiTokenInstance }, { status: 401 }),
  );
  await assert.rejects(
    api.checkConnection(signal),
    (error) =>
      error instanceof ApiError &&
      !error.retryable &&
      !error.message.includes(credentials.apiTokenInstance),
  );
  fetchMock.mock.mockImplementation(async () =>
    Response.json({
      status: false,
      reason: "instance is starting or not authorized",
    }),
  );
  await assert.rejects(api.checkAccount("79991234567", signal), /Авторизуйте/);
  fetchMock.mock.mockImplementation(async () => {
    throw new Error(`Network error: ${credentials.apiTokenInstance}`);
  });
  await assert.rejects(
    api.receiveNotification(signal),
    (error) =>
      error.retryable && !error.message.includes(credentials.apiTokenInstance),
  );
});

test("queue processes then acknowledges, deduplicates after failed acknowledgement, and skips media", async () => {
  const controller = new AbortController();
  const events = [];
  let received = 0;
  let deleted = 0;
  let chats = [];
  const api = {
    async receiveNotification() {
      events.push("receive");
      received += 1;
      return {
        receiptId: received < 3 ? 1 : 2,
        body: received < 3 ? body : { typeWebhook: "stateInstanceChanged" },
      };
    },
    async deleteNotification() {
      events.push("delete");
      deleted += 1;
      if (deleted === 1) throw new ApiError("Сеть недоступна", true);
      if (deleted === 3) controller.abort();
    },
  };
  await runInbox(
    api,
    controller.signal,
    (incoming) => {
      events.push("process");
      chats = chatReducer(chats, { type: "incoming", incoming });
    },
    () => {},
    async () => {},
  );
  assert.deepEqual(events, [
    "receive",
    "process",
    "delete",
    "receive",
    "process",
    "delete",
    "receive",
    "delete",
  ]);
  assert.equal(chats[0].messages.length, 1);
});

test("polling stops on auth errors and aborted waits settle immediately", async () => {
  const statuses = [];
  const controller = new AbortController();
  await runInbox(
    {
      async receiveNotification() {
        throw new ApiError("Нет доступа");
      },
    },
    controller.signal,
    () => {},
    (value) => statuses.push(value),
  );
  assert.equal(statuses.at(-1).state, "stopped");
  const pending = wait(60000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("a late response after logout is neither processed nor acknowledged", async () => {
  const controller = new AbortController();
  let handled = false;
  let deleted = false;
  await runInbox(
    {
      async receiveNotification() {
        controller.abort();
        return { receiptId: 1, body };
      },
      async deleteNotification() {
        deleted = true;
      },
    },
    controller.signal,
    () => {
      handled = true;
    },
    () => {},
  );
  assert.equal(handled, false);
  assert.equal(deleted, false);
});
