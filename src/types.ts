export interface Credentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl: string;
}

export interface Message {
  id: string;
  text: string;
  timestamp: number;
  direction: "incoming" | "outgoing";
}

export interface Chat {
  id: string;
  name: string;
  phone?: string;
  messages: Message[];
}

export interface IncomingMessage {
  chatId: string;
  name: string;
  phone?: string;
  message: Message;
}

export interface Notification {
  receiptId: number;
  body: Record<string, unknown>;
}
