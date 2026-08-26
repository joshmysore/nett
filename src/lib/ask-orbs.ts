import type { OrbState } from "thinking-orbs";

/** Map a retrieval stage id to the matching thinking-orb verb. */
export function askOrbState(id: string): OrbState {
  switch (id) {
    case "extract":
      return "listening";
    case "search":
      return "searching";
    case "match":
      return "connecting";
    case "records":
      return "weaving";
    case "write":
      return "composing";
    case "brief":
      return "weaving";
    case "escalate":
      return "working";
    default:
      return "working";
  }
}
