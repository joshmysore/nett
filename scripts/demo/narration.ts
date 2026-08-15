import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Spoken only if a neural voice is available. Otherwise the cut stays silent. */
export const NARRATION = [
  "Nett is a private relationship memory. It runs on one Mac. Nothing leaves the machine.",
  "Find the person. Recover why they matter. Keep the evidence that produced the fact.",
  "This is the argument. Recognition first. Then provenance. Then local-first.",
  "Open the workbench.",
  "Ask is retrieval. You ask in the language you remember. Ask never writes.",
  "People is the record. Cards, not a CRM grid.",
  "Review is where Nett refuses to guess. A suggestion waits until you accept it.",
  "Sources are the evidence you already own. Messages and WhatsApp. Read only. Refresh when you want them current.",
  "Kendra is family. The profile keeps why she matters, and every fact traces back to something stored.",
  "Add what you just learned. The note is the record.",
  "Gilly is a friend. Same motion.",
  "Now ask. Tell me about this person. Describe their history. Nett answers from owned evidence, on this machine.",
  "Remember everyone.",
].join(" ");

function have(command: string) {
  return spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

export async function trySynthesizeNarration(wavPath: string): Promise<string | null> {
  if (process.env.NETT_DEMO_SILENT === "1") return null;
  const script = path.join(path.dirname(wavPath), "narration.txt");
  writeFileSync(script, NARRATION);

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
    const result = spawnSync("python3", [
      "-m",
      "edge_tts",
      "--voice",
      "en-US-AndrewNeural",
      "--rate",
      "-8%",
      "--text",
      NARRATION,
      "--write-media",
      wavPath,
    ], { encoding: "utf8" });
    if (result.status !== 0 || !existsSync(wavPath)) {
      console.log("edge-tts failed; recording silent UI.", result.stderr?.slice(0, 400));
      return null;
    }
    return wavPath;
  } catch (error) {
    console.log("Skipping narration:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function mixNarration(webm: string, wav: string, mp4: string) {
  const result = spawnSync("ffmpeg", [
    "-y",
    "-i", webm,
    "-i", wav,
    "-filter_complex",
    "[1:a]adelay=900|900,apad[a]",
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
