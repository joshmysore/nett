import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Spoken at marked beats. Neural voice only; otherwise the cut stays silent. */
export const NARRATION_BEATS = [
  {
    id: "landing",
    text: "Nett is a private relationship memory. It runs on one Mac. Nothing leaves the machine.",
  },
  {
    id: "workbench",
    text: "The workbench is already lived in. No first-run setup.",
  },
  {
    id: "people",
    text: "People is the record. Cards, not a CRM grid. You find someone by why they matter.",
  },
  {
    id: "review",
    text: "Review is where Nett refuses to guess. A suggestion waits until you accept it.",
  },
  {
    id: "sources",
    text: "Sources are the evidence you already own. Messages and WhatsApp. Read only.",
  },
  {
    id: "kendra",
    text: "Kendra is family. The profile keeps why she matters, and every fact traces back to something stored.",
  },
  {
    id: "kendra_note",
    text: "Add what you just learned. The note is the record.",
  },
  {
    id: "gilly",
    text: "Gilly is a friend. Same motion — open, recover, go.",
  },
  {
    id: "ask",
    text: "Now ask. What do I know about Kendra. Nett thinks, grabs Messages and WhatsApp, cites the evidence, and writes a full brief on this machine.",
  },
  {
    id: "synthesis",
    text: "Then ask across people. Who would be a good lead for legal tech. Nett reads overlapping conversations, names the relationships, and writes the intro path.",
  },
  {
    id: "remember",
    text: "When something new happens, remember it. Structure waits for you. Nothing writes itself.",
  },
] as const;

export type NarrationClip = { id: string; path: string };

function have(command: string) {
  return spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

function synthesizeClip(text: string, wavPath: string) {
  const result = spawnSync("python3", [
    "-m",
    "edge_tts",
    "--voice",
    "en-US-AndrewNeural",
    "--rate=-5%",
    "--text",
    text,
    "--write-media",
    wavPath,
  ], { encoding: "utf8" });
  return result.status === 0 && existsSync(wavPath);
}

export async function trySynthesizeNarration(dir: string): Promise<NarrationClip[] | null> {
  if (process.env.NETT_DEMO_SILENT === "1") return null;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "narration.txt"), NARRATION_BEATS.map((beat) => `${beat.id}: ${beat.text}`).join("\n"));

  try {
    if (!have("edge-tts")) {
      const pip = spawnSync("python3", ["-m", "pip", "install", "--user", "--quiet", "edge-tts"], {
        encoding: "utf8",
      });
      if (pip.status !== 0) {
        console.log("No neural TTS available; recording silent UI.");
        return null;
      }
    }
    const clips: NarrationClip[] = [];
    for (const beat of NARRATION_BEATS) {
      const wavPath = path.join(dir, `narration-${beat.id}.wav`);
      if (!synthesizeClip(beat.text, wavPath)) {
        console.log(`edge-tts failed on ${beat.id}; recording silent UI.`);
        return null;
      }
      clips.push({ id: beat.id, path: wavPath });
    }
    return clips;
  } catch (error) {
    console.log("Skipping narration:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function mixNarration(
  webm: string,
  clips: Array<{ path: string; atMs: number }>,
  mp4: string,
) {
  if (!clips.length) {
    const silent = spawnSync("ffmpeg", [
      "-y",
      "-i", webm,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-an",
      mp4,
    ], { stdio: "inherit" });
    if (silent.status !== 0) throw new Error("ffmpeg failed");
    return;
  }

  const args = ["-y", "-i", webm];
  for (const clip of clips) args.push("-i", clip.path);

  const delayed = clips.map((clip, index) => {
    const delay = Math.max(0, Math.round(clip.atMs));
    return `[${index + 1}:a]adelay=${delay}|${delay},apad[a${index}]`;
  }).join(";");
  const mixInputs = clips.map((_, index) => `[a${index}]`).join("");
  const filter = `${delayed};${mixInputs}amix=inputs=${clips.length}:duration=longest:dropout_transition=0:normalize=0[a]`;

  const result = spawnSync("ffmpeg", [
    ...args,
    "-filter_complex",
    filter,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    mp4,
  ], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("ffmpeg mix failed");
}
