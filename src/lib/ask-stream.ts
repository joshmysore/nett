import type { AskStreamEvent } from "./api.js";
import { upsertStage, type AskStage } from "./ask-display.js";
import type { Citation } from "../types.js";

export type AskLiveAnswer = {
  text: string;
  citations: Citation[];
  provider: string;
  note?: string;
  stages: AskStage[];
  evidence: Array<{ id: string; title: string; text: string }>;
  loading: boolean;
};

export function emptyAskLiveAnswer(): AskLiveAnswer {
  return {
    text: "",
    citations: [],
    provider: "local-evidence",
    stages: [{ id: "search", label: "Searching records", done: false }],
    evidence: [],
    loading: true,
  };
}

export function applyAskStreamEvent(current: AskLiveAnswer, event: AskStreamEvent): AskLiveAnswer {
  if (event.type === "thread") return current;
  if (event.type === "stage") {
    return {
      ...current,
      stages: upsertStage(current.stages, {
        id: event.id,
        label: event.label,
        detail: event.detail,
      }),
    };
  }
  if (event.type === "meta") {
    return {
      ...current,
      evidence: event.evidence || current.evidence,
      citations: event.citations || current.citations,
      provider: event.provider,
      note: event.note,
    };
  }
  if (event.type === "token") {
    return { ...current, text: `${current.text}${event.text}` };
  }
  if (event.type === "reset") {
    return {
      ...current,
      text: "",
      stages: upsertStage(current.stages, {
        id: "escalate",
        label: "First pass was thin — trying the larger local model",
      }),
    };
  }
  if (event.type === "done") {
    return {
      ...current,
      loading: false,
      text: event.answer,
      citations: event.citations || [],
      provider: event.provider,
      note: event.note,
      stages: current.stages.map((stage) => ({ ...stage, done: true })),
    };
  }
  return current;
}
