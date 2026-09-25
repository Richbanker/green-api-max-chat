import { useState } from "react";
import type { Credentials } from "./types.ts";
import { Login } from "./components/Login.tsx";
import { ChatWorkspace } from "./components/ChatWorkspace.tsx";

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  return credentials ? (
    <ChatWorkspace
      credentials={credentials}
      onDisconnect={() => setCredentials(null)}
    />
  ) : (
    <Login onConnect={setCredentials} />
  );
}
