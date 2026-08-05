/**
 * Dictation capability layer.
 *
 * Browser SpeechRecognition is an optional progressive enhancement. Recognition
 * may use a vendor cloud service depending on the browser — that fact is
 * disclosed to the UI. There is no passive listening and no raw-audio retention.
 * A future local macOS helper can register here without changing call sites.
 */

export type DictationBackend =
  | "unavailable"
  | "browser-speech"
  | "local-helper";

export type DictationCapability = {
  backend: DictationBackend;
  available: boolean;
  /** True when recognition may leave the machine via a browser/vendor service. */
  mayUseRemoteService: boolean;
  /** Short disclosure for the UI when the mic is offered. */
  disclosure: string;
  reason?: string;
};

export type DictationState =
  | "idle"
  | "requesting-permission"
  | "listening"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export type DictationSessionHandlers = {
  onState: (state: DictationState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const candidate =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
  return candidate ?? null;
}

/** Detect what dictation backends are available in this environment. */
export function detectDictationCapability(): DictationCapability {
  const ctor = speechCtor();
  if (!ctor) {
    return {
      backend: "unavailable",
      available: false,
      mayUseRemoteService: false,
      disclosure: "Speech recognition is unavailable in this browser. Type or paste instead.",
      reason: "browser-speech-unavailable",
    };
  }
  return {
    backend: "browser-speech",
    available: true,
    // Chromium/WebKit SpeechRecognition typically routes audio to a vendor service.
    mayUseRemoteService: true,
    disclosure:
      "Browser speech recognition may send audio to the browser vendor. The transcript stays editable and nothing is saved until you approve.",
  };
}

export type DictationSession = {
  start: (lang?: string) => void;
  stop: () => void;
  cancel: () => void;
};

/** Start a single explicit dictation session. Activation is always user-driven. */
export function createDictationSession(handlers: DictationSessionHandlers): DictationSession {
  const capability = detectDictationCapability();
  let recognition: SpeechRecognitionLike | null = null;
  let cancelled = false;

  const start = (lang?: string) => {
    cancelled = false;
    const Ctor = speechCtor();
    if (!Ctor || !capability.available) {
      handlers.onState("failed");
      handlers.onError(capability.disclosure);
      return;
    }
    handlers.onState("requesting-permission");
    const instance = new Ctor();
    recognition = instance;
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = lang || navigator.language || "en-US";
    instance.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (finalText) handlers.onTranscript(finalText, true);
      else if (interim) handlers.onTranscript(interim, false);
    };
    instance.onerror = (event) => {
      if (cancelled) return;
      const code = event.error || "failed";
      handlers.onState("failed");
      if (code === "not-allowed" || code === "service-not-allowed") {
        handlers.onError("Microphone permission was denied. You can still type or paste.");
      } else if (code === "no-speech") {
        handlers.onError("No speech was detected. Try again, or type instead.");
      } else if (code === "network") {
        handlers.onError("Browser speech recognition needs a network connection in this browser. Type or paste instead.");
      } else {
        handlers.onError("Voice transcription stopped. Review any text captured so far.");
      }
    };
    instance.onend = () => {
      if (cancelled) {
        handlers.onState("cancelled");
        return;
      }
      handlers.onState("ready");
    };
    try {
      instance.start();
      handlers.onState("listening");
    } catch {
      handlers.onState("failed");
      handlers.onError("Could not start the microphone. You can still type or paste.");
    }
  };

  const stop = () => {
    handlers.onState("processing");
    recognition?.stop();
  };

  const cancel = () => {
    cancelled = true;
    recognition?.abort();
    handlers.onState("cancelled");
  };

  return { start, stop, cancel };
}
