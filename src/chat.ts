import { ApiError, isRecord } from "./api.ts";
import type { Chat, IncomingMessage, Message } from "./types.ts";

export function parseIncoming(
  body: Record<string, unknown>,
): IncomingMessage | null {
  if (body.typeWebhook !== "incomingMessageReceived") return null;
  const sender = body.senderData;
  const data = body.messageData;
  if (!isRecord(sender) || !isRecord(data))
    throw new ApiError("Повреждено входящее уведомление.");
  if (sender.chatType && sender.chatType !== "user") return null;
  let text: unknown;
  if (data.typeMessage === "textMessage") {
    text = isRecord(data.textMessageData)
      ? data.textMessageData.textMessage
      : undefined;
  } else if (data.typeMessage === "extendedTextMessage") {
    text = isRecord(data.extendedTextMessageData)
      ? data.extendedTextMessageData.text
      : undefined;
  } else {
    return null;
  }
  if (
    typeof text !== "string" ||
    typeof sender.chatId !== "string" ||
    !sender.chatId ||
    typeof body.idMessage !== "string" ||
    !body.idMessage ||
    typeof body.timestamp !== "number" ||
    !Number.isFinite(new Date(body.timestamp * 1000).getTime())
  ) {
    throw new ApiError(
      "Не удалось прочитать текстовое уведомление. Получение приостановлено.",
    );
  }
  const phone = sender.senderPhoneNumber
    ? String(sender.senderPhoneNumber)
    : undefined;
  const name = sender.senderContactName || sender.senderName || sender.chatName;
  return {
    chatId: sender.chatId,
    name:
      typeof name === "string" && name.trim()
        ? name
        : phone
          ? `+${phone}`
          : `Чат ${sender.chatId}`,
    phone,
    message: {
      id: body.idMessage,
      text,
      timestamp: body.timestamp * 1000,
      direction: "incoming",
    },
  };
}

export type ChatAction =
  | { type: "open"; id: string; phone: string }
  | { type: "incoming"; incoming: IncomingMessage }
  | { type: "sent"; chatId: string; message: Message };

export function chatReducer(chats: Chat[], action: ChatAction): Chat[] {
  if (action.type === "open") {
    const existing = chats.find((chat) => chat.id === action.id);
    return existing
      ? chats.map((chat) =>
          chat.id === action.id ? { ...chat, phone: action.phone } : chat,
        )
      : [
          ...chats,
          {
            id: action.id,
            phone: action.phone,
            name: `+${action.phone}`,
            messages: [],
          },
        ];
  }
  const chatId =
    action.type === "incoming" ? action.incoming.chatId : action.chatId;
  const message =
    action.type === "incoming" ? action.incoming.message : action.message;
  let next = chats;
  if (!chats.some((chat) => chat.id === chatId) && action.type === "incoming") {
    next = [
      ...chats,
      {
        id: chatId,
        name: action.incoming.name,
        phone: action.incoming.phone,
        messages: [],
      },
    ];
  }
  return next.map((chat) => {
    if (
      chat.id !== chatId ||
      chat.messages.some((item) => item.id === message.id)
    )
      return chat;
    return {
      ...chat,
      name: action.type === "incoming" ? action.incoming.name : chat.name,
      messages: [...chat.messages, message].sort(
        (a, b) => a.timestamp - b.timestamp,
      ),
    };
  });
}
