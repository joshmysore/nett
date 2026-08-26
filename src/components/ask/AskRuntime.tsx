import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

export type AskRuntimeMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  running?: boolean;
};

function toThreadMessage(message: AskRuntimeMessage): ThreadMessageLike {
  const createdAt = new Date(message.createdAt);
  return {
    id: message.id,
    role: message.role,
    content: [{ type: "text", text: message.text || "" }],
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  };
}

function textFromAppend(message: AppendMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

class AskRuntimeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Ask runtime failed; continuing without assistant-ui provider", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function AskRuntimeInner({
  messages,
  isRunning,
  onNew,
  onCancel,
  children,
}: {
  messages: AskRuntimeMessage[];
  isRunning: boolean;
  onNew: (text: string) => Promise<void>;
  onCancel: () => void;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime({
    isRunning,
    messages: messages.map(toThreadMessage),
    convertMessage: (message) => message,
    onNew: async (message) => {
      const text = textFromAppend(message);
      if (text) await onNew(text);
    },
    onCancel: async () => {
      onCancel();
    },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function AskRuntimeProvider({
  messages,
  isRunning,
  onNew,
  onCancel,
  children,
}: {
  messages: AskRuntimeMessage[];
  isRunning: boolean;
  onNew: (text: string) => Promise<void>;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <AskRuntimeBoundary fallback={children}>
      <AskRuntimeInner
        messages={messages}
        isRunning={isRunning}
        onNew={onNew}
        onCancel={onCancel}
      >
        {children}
      </AskRuntimeInner>
    </AskRuntimeBoundary>
  );
}
