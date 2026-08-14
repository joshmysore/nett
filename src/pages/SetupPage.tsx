import {
  AddressBook,
  ArrowLeft,
  ArrowRight,
  ChatCircle,
  Check,
  Database,
  EnvelopeSimple,
  FileArrowUp,
  House,
  LinkSimple,
  LockKey,
  Microphone,
  MicrophoneSlash,
  Quotes,
  ShieldCheck,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChipInput } from "@/components/ChipInput";
import { SuccessCheck } from "@/components/transitions/SuccessCheck";
import { api, isAbortError } from "@/lib/api";
import {
  createDictationSession,
  detectDictationCapability,
  type DictationSession,
  type DictationState,
} from "@/lib/dictation";
import type { SetupStatus } from "@/types";

const steps: { id: SetupStatus["phase"]; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "you", label: "You" },
  { id: "contacts", label: "Contacts" },
  { id: "conversations", label: "Conversations" },
  { id: "complete", label: "Ready" },
];

type WhatsAppStatus = Awaited<ReturnType<typeof api.whatsappStatus>>;
type PlatformStatus = Awaited<ReturnType<typeof api.platformStatus>>;

export function SetupPage({
  initialStatus,
  onChanged,
}: {
  initialStatus: SetupStatus;
  onChanged: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(initialStatus);
  const [ownerName, setOwnerName] = useState(initialStatus.ownerDisplayName || "");
  const [hometowns, setHometowns] = useState(initialStatus.ownerHometowns || []);
  const [interests, setInterests] = useState(initialStatus.ownerInterests || []);
  const [selfNote, setSelfNote] = useState(initialStatus.ownerCaptureTranscript || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const messagesInput = useRef<HTMLInputElement>(null);
  const spreadsheetInput = useRef<HTMLInputElement>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus | null>(null);
  const [platform, setPlatform] = useState<PlatformStatus | null>(null);
  const [bundledGmail, setBundledGmail] = useState<string | null>(null);
  const [gmailClientId, setGmailClientId] = useState("");
  const [gmailSecret, setGmailSecret] = useState("");
  const [gmailOpen, setGmailOpen] = useState(false);

  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === status.phase));
  const gmailAccount = platform?.accounts.find((item) => item.connectorId === "gmail");
  const gmailReady = gmailAccount?.authState === "authorized" || gmailAccount?.authState === "ready"
    || status.milestones.gmail.synced;

  async function update(input: Parameters<typeof api.updateSetup>[0]) {
    const next = await api.updateSetup(input);
    setStatus(next);
    await onChanged();
    return next;
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup could not continue");
    } finally {
      setBusy(null);
    }
  }

  async function refreshConversationSources() {
    const [whatsapp, platformStatus, defaults] = await Promise.all([
      api.whatsappStatus().catch(() => null),
      api.platformStatus().catch(() => null),
      api.gmailDefaults().catch(() => null),
    ]);
    setWhatsappStatus(whatsapp);
    setPlatform(platformStatus);
    setBundledGmail(defaults?.bundledClientId ?? null);
    if (defaults?.bundledClientId || platformStatus?.accounts.find((item) => item.connectorId === "gmail")?.settings.clientId) {
      setGmailOpen(false);
    }
  }

  useEffect(() => {
    if (status.phase !== "conversations") return;
    void refreshConversationSources();
  }, [status.phase]);

  useEffect(() => {
    if (searchParams.get("gmail") !== "connected") return;
    setSearchParams({}, { replace: true });
    void run("gmail", async () => {
      setProgress("Gmail authorized. Importing recent mail…");
      const result = await api.sync("gmail");
      setProgress(result.message);
      setStatus(await api.setupStatus());
      await onChanged();
      await refreshConversationSources();
    });
  }, [searchParams, setSearchParams, onChanged]);

  async function importContacts() {
    await run("contacts", async () => {
      setProgress("Requesting Contacts access…");
      const result = await api.sync("apple-contacts");
      setProgress(result.message);
      await update({ phase: "conversations" });
    });
  }

  async function importMessages() {
    stopRequested.current = false;
    await run("messages", async () => {
      let done = false;
      while (!done && !stopRequested.current) {
        const result = await api.sync("messages", undefined, 50);
        done = result.done !== false;
        setProgress(result.message);
      }
    });
  }

  async function prepareMessages(file?: File) {
    await run("prepare-messages", async () => {
      const result = file ? await api.importMessagesDb(file) : await api.prepareMessagesCopy();
      setProgress(result.message);
      setStatus(await api.setupStatus());
      await onChanged();
    });
  }

  async function importWhatsApp() {
    await run("whatsapp", async () => {
      setProgress("Snapshotting WhatsApp Desktop into a private archive…");
      const prepared = await api.prepareWhatsAppArchive({ resetCursor: false });
      setProgress(prepared.message);
      let result = await api.sync("whatsapp", undefined, 50);
      while (result.done === false) {
        setProgress(result.message);
        result = await api.sync("whatsapp", undefined, 50);
      }
      setProgress(result.message);
      setStatus(await api.setupStatus());
      await onChanged();
      await refreshConversationSources();
    });
  }

  async function connectGmail(useBundled: boolean) {
    await run("gmail-auth", async () => {
      await update({ phase: "conversations", gmailReturnTo: "/setup?gmail=connected" });
      await api.configureGmail({
        accountId: gmailAccount?.accountId || "primary",
        useBundledClient: useBundled,
        clientId: useBundled ? undefined : gmailClientId,
        clientSecret: useBundled ? undefined : gmailSecret,
      });
      const result = await api.authorizeGmail(gmailAccount?.accountId || "primary");
      window.location.assign(result.url);
    });
  }

  async function importSpreadsheet(file: File) {
    await run("spreadsheet", async () => {
      const result = await api.importCsv(file);
      setProgress(
        `Reviewed ${result.rows} rows: ${result.merged} exact matches merged, ${result.created} people created, ${result.review} held for review.`,
      );
      setStatus(await api.setupStatus());
      await onChanged();
    });
  }

  async function skip(step: "you" | "contacts" | "conversations", next: SetupStatus["phase"]) {
    await run(`skip-${step}`, async () => {
      await update({ skipStep: step, phase: next });
      setProgress("");
    });
  }

  async function finish() {
    await run("complete", async () => {
      const next = await update({ complete: true });
      navigate(next.milestones.peopleCount > 0 ? "/people?missing=hometown" : "/today", { replace: true });
    });
  }

  return (
    <main className="setup-shell">
      <aside className="setup-sidebar" aria-label="Setup progress">
        <a className="setup-brand" href="/" aria-label="Nett home">
          <span>N</span>
          Nett
        </a>
        <ol className="setup-steps">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={index === currentIndex ? "is-current" : index < currentIndex ? "is-complete" : ""}
              aria-current={index === currentIndex ? "step" : undefined}
            >
              <span>{index < currentIndex ? <Check weight="bold" /> : index + 1}</span>
              {step.label}
            </li>
          ))}
        </ol>
        <div className="setup-privacy-note">
          <LockKey />
          <div>
            <strong>Local by default</strong>
            <p>Your relationship data stays in Nett’s database on this Mac.</p>
          </div>
        </div>
      </aside>

      <section className="setup-content" aria-live="polite">
        {status.phase === "welcome" && (
          <div className="setup-stage setup-welcome">
            <div className="setup-brand-hero glass-chip" aria-hidden="true">
              <span className="setup-brand-wordmark">Nett</span>
              <img className="setup-brand-crystal" src="/brand/nett-crystal-n.png" alt="" />
            </div>
            <p className="setup-eyebrow">Private. Local. Yours.</p>
            <h1>Remember everyone from records you already own.</h1>
            <p className="setup-lede">
              Tell Nett who you are, connect the conversations you already have, and review
              what it proposes. There is no account, and nothing leaves by default.
            </p>
            <label className="setup-field">
              <span>What should Nett call you? <small>Optional</small></span>
              <input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                placeholder="Your first name"
                autoComplete="name"
              />
            </label>
            <div className="setup-trust-grid">
              <div><Database /><strong>One local database</strong><span>Portable and backed up before schema changes.</span></div>
              <div><ShieldCheck /><strong>Explicit access</strong><span>You choose each source and can disconnect it later.</span></div>
              <div><Quotes /><strong>Evidence first</strong><span>Suggestions retain the records that support them.</span></div>
            </div>
            <div className="setup-actions">
              <button
                className="primary-button"
                disabled={Boolean(busy)}
                onClick={() => void run("welcome", async () => {
                  await update({ ownerDisplayName: ownerName, phase: "you" });
                })}
              >
                Continue <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status.phase === "you" && (
          <YouStage
            hometowns={hometowns}
            interests={interests}
            selfNote={selfNote}
            busy={Boolean(busy)}
            onHometowns={setHometowns}
            onInterests={setInterests}
            onSelfNote={setSelfNote}
            onError={setError}
            onContinue={() => void run("you", async () => {
              await update({
                ownerHometowns: hometowns,
                ownerInterests: interests,
                ownerCaptureTranscript: selfNote,
                phase: "contacts",
              });
            })}
            onSkip={() => void skip("you", "contacts")}
          />
        )}

        {status.phase === "contacts" && (
          <div className="setup-stage">
            <div className="setup-stage-icon"><AddressBook /></div>
            <p className="setup-eyebrow">Step 2 · Identity foundation</p>
            <h1>Start with Apple Contacts.</h1>
            <p className="setup-lede">
              Nett reads names, email addresses, and phone numbers through macOS. Your Contacts records are
              never changed. Notes remain source evidence and do not overwrite your Nett notes.
            </p>
            <div className="setup-status-row">
              <span className={status.milestones.contacts.synced ? "status-dot is-good" : "status-dot"} />
              <div>
                <strong>{status.milestones.contacts.synced ? "Contacts imported" : "Not connected yet"}</strong>
                <span>
                  {status.milestones.contacts.synced
                    ? `${status.milestones.contacts.seen.toLocaleString()} source contacts read`
                    : "macOS will ask you to approve Contacts access"}
                </span>
              </div>
            </div>
            <div className="setup-actions">
              <button className="primary-button" disabled={Boolean(busy)} onClick={() => void importContacts()}>
                {busy === "contacts" ? <SpinnerGap className="spin" /> : <AddressBook />}
                {busy === "contacts" ? "Importing contacts…" : "Import Apple Contacts"}
              </button>
              <button className="text-button" disabled={Boolean(busy)} onClick={() => void skip("contacts", "conversations")}>
                Skip for now
              </button>
            </div>
          </div>
        )}

        {status.phase === "conversations" && (
          <div className="setup-stage">
            <div className="setup-stage-icon"><Quotes /></div>
            <p className="setup-eyebrow">Step 3 · Conversations you already have</p>
            <h1>Connect Messages, WhatsApp, and Gmail.</h1>
            <p className="setup-lede">
              Nett reads them locally and links people by phone or email. You do not fill hometowns
              and interests by hand — those stay reviewable suggestions after import.
            </p>

            <ul className="setup-source-list">
              <li>
                <span className={status.milestones.messages.synced || status.milestones.messages.readable ? "status-dot is-good" : "status-dot"} />
                <div>
                  <strong>Messages</strong>
                  <span>
                    {status.milestones.messages.synced
                      ? `${status.milestones.messages.seen.toLocaleString()} records imported`
                      : status.milestones.messages.readable
                        ? `${(status.milestones.messages.messageCount || 0).toLocaleString()} records ready to import`
                        : "Grant Full Disk Access, or choose a copied chat.db"}
                  </span>
                  <div className="setup-source-actions">
                    {status.milestones.messages.readable ? (
                      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void importMessages()}>
                        {busy === "messages" ? <SpinnerGap className="spin" /> : <Quotes />}
                        {busy === "messages" ? "Importing…" : "Import Messages"}
                      </button>
                    ) : (
                      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void prepareMessages()}>
                        {busy === "prepare-messages" ? <SpinnerGap className="spin" /> : <Database />}
                        Prepare local copy
                      </button>
                    )}
                    <button className="text-button" disabled={Boolean(busy)} onClick={() => messagesInput.current?.click()}>
                      <FileArrowUp /> Choose copied database
                    </button>
                    {busy === "messages" && (
                      <button className="text-button" onClick={() => { stopRequested.current = true; }}>
                        Stop after this batch
                      </button>
                    )}
                  </div>
                </div>
              </li>
              <li>
                <span className={status.milestones.whatsapp.synced || whatsappStatus?.readable ? "status-dot is-good" : "status-dot"} />
                <div>
                  <strong>WhatsApp</strong>
                  <span>
                    {status.milestones.whatsapp.synced
                      ? `${status.milestones.whatsapp.seen.toLocaleString()} records imported`
                      : whatsappStatus?.readable
                        ? `${(whatsappStatus.archiveMessageCount || 0).toLocaleString()} archive messages ready`
                        : whatsappStatus && !whatsappStatus.binaryFound
                          ? "Install wacrawl, keep WhatsApp Desktop synced, then import"
                          : "Uses a private local snapshot of WhatsApp Desktop — never writes back"}
                  </span>
                  <div className="setup-source-actions">
                    <button
                      className="secondary-button"
                      disabled={Boolean(busy) || !whatsappStatus?.binaryFound || !whatsappStatus.desktopAvailable}
                      onClick={() => void importWhatsApp()}
                    >
                      {busy === "whatsapp" ? <SpinnerGap className="spin" /> : <ChatCircle />}
                      {busy === "whatsapp" ? "Importing…" : "Import WhatsApp"}
                    </button>
                  </div>
                </div>
              </li>
              <li>
                <span className={gmailReady ? "status-dot is-good" : "status-dot"} />
                <div>
                  <strong>Gmail</strong>
                  <span>
                    {status.milestones.gmail.synced
                      ? `${status.milestones.gmail.seen.toLocaleString()} messages imported`
                      : gmailReady
                        ? "Linked. Import recent mail when you are ready."
                        : "Read-only OAuth. Tokens stay in this Mac’s Keychain."}
                  </span>
                  <div className="setup-source-actions">
                    {gmailReady ? (
                      <button
                        className="secondary-button"
                        disabled={Boolean(busy)}
                        onClick={() => void run("gmail", async () => {
                          setProgress("Importing recent Gmail…");
                          const result = await api.sync("gmail");
                          setProgress(result.message);
                          setStatus(await api.setupStatus());
                          await onChanged();
                        })}
                      >
                        {busy === "gmail" ? <SpinnerGap className="spin" /> : <EnvelopeSimple />}
                        {busy === "gmail" ? "Importing…" : "Import Gmail"}
                      </button>
                    ) : bundledGmail ? (
                      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void connectGmail(true)}>
                        {busy === "gmail-auth" ? <SpinnerGap className="spin" /> : <LinkSimple />}
                        Connect Gmail
                      </button>
                    ) : (
                      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => setGmailOpen((open) => !open)}>
                        <EnvelopeSimple />
                        {gmailOpen ? "Hide Gmail setup" : "Set up Gmail"}
                      </button>
                    )}
                    {bundledGmail && !gmailReady && (
                      <button className="text-button" disabled={Boolean(busy)} onClick={() => setGmailOpen((open) => !open)}>
                        Use my own client ID
                      </button>
                    )}
                  </div>
                  {gmailOpen && !gmailReady && (
                    <form
                      className="setup-gmail-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void connectGmail(false);
                      }}
                    >
                      <label>
                        <span>OAuth client ID</span>
                        <input
                          value={gmailClientId}
                          onChange={(event) => setGmailClientId(event.target.value)}
                          placeholder="…apps.googleusercontent.com"
                          required
                        />
                      </label>
                      <label>
                        <span>Client secret <small>Optional</small></span>
                        <input
                          type="password"
                          value={gmailSecret}
                          onChange={(event) => setGmailSecret(event.target.value)}
                          placeholder="Stored only in Keychain"
                        />
                      </label>
                      <button className="secondary-button" disabled={Boolean(busy) || !gmailClientId.trim()}>
                        <LinkSimple /> Authorize in Google
                      </button>
                    </form>
                  )}
                </div>
              </li>
            </ul>

            <input
              ref={messagesInput}
              className="visually-hidden"
              type="file"
              accept=".db,.sqlite,.sqlite3,application/x-sqlite3"
              aria-label="Choose a copied Messages database"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void prepareMessages(file);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={spreadsheetInput}
              className="visually-hidden"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Choose a CSV or Excel spreadsheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSpreadsheet(file);
                event.currentTarget.value = "";
              }}
            />

            <p className="setup-aside-action">
              Have a spreadsheet instead?
              {" "}
              <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => spreadsheetInput.current?.click()}>
                {busy === "spreadsheet" ? "Importing…" : "Choose CSV or Excel"}
              </button>
            </p>

            <div className="setup-actions">
              <button className="primary-button" disabled={Boolean(busy)} onClick={() => void finish()}>
                Open Nett <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status.phase === "complete" && (
          <div className="setup-stage">
            <div className="setup-stage-icon is-complete">
              <SuccessCheck active size={28} variant="stage" />
            </div>
            <p className="setup-eyebrow">Workspace ready</p>
            <h1>Your private network is ready to use.</h1>
            <p className="setup-lede">
              {status.milestones.peopleCount.toLocaleString()} people are available. Connect more sources
              any time from Sources. Hometowns and interests stay reviewable — Fill gaps walks one field at a time.
            </p>
            <div className="setup-actions">
              <button
                className="primary-button"
                onClick={() => navigate(status.milestones.peopleCount > 0 ? "/people?missing=hometown" : "/today", { replace: true })}
              >
                {status.milestones.peopleCount > 0 ? "Fill hometowns" : "Open Home"} <ArrowRight />
              </button>
              <button className="text-button" onClick={() => void update({ phase: "you" })}>
                <ArrowLeft /> Update hometowns and interests
              </button>
            </div>
          </div>
        )}

        {(progress || error) && (
          <div className={error ? "setup-feedback is-error" : "setup-feedback"} role={error ? "alert" : "status"}>
            {error || progress}
          </div>
        )}
      </section>
    </main>
  );
}

function YouStage({
  hometowns,
  interests,
  selfNote,
  busy,
  onHometowns,
  onInterests,
  onSelfNote,
  onError,
  onContinue,
  onSkip,
}: {
  hometowns: string[];
  interests: string[];
  selfNote: string;
  busy: boolean;
  onHometowns: (value: string[]) => void;
  onInterests: (value: string[]) => void;
  onSelfNote: (value: string) => void;
  onError: (value: string | null) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const capability = detectDictationCapability();
  const [dictationState, setDictationState] = useState<DictationState>("idle");
  const [previewing, setPreviewing] = useState(false);
  const session = useRef<DictationSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const noteRef = useRef(selfNote);
  const hometownsRef = useRef(hometowns);
  const interestsRef = useRef(interests);
  const listening = dictationState === "listening" || dictationState === "requesting-permission";
  noteRef.current = selfNote;
  hometownsRef.current = hometowns;
  interestsRef.current = interests;

  useEffect(() => () => {
    session.current?.cancel();
    abortRef.current?.abort();
  }, []);

  const applyPreview = async (transcript: string) => {
    const text = transcript.trim();
    if (!text) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setPreviewing(true);
    onError(null);
    try {
      const result = await api.previewOwnerContext(text, abort.signal);
      if (abort.signal.aborted) return;
      if (result.hometowns.length) {
        onHometowns([...new Set([...hometownsRef.current, ...result.hometowns])]);
      }
      if (result.interests.length) {
        onInterests([...new Set([...interestsRef.current, ...result.interests])]);
      }
      if (!result.hometowns.length && !result.interests.length) {
        onError("Nothing structured yet. Type the places and interests as chips, or try “I grew up in… I’m into…”.");
      }
    } catch (reason) {
      if (isAbortError(reason) || abort.signal.aborted) return;
      onError(reason instanceof Error ? reason.message : "Could not read that note");
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setPreviewing(false);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      session.current?.stop();
      return;
    }
    if (!capability.available) {
      onError(capability.disclosure);
      return;
    }
    onError(null);
    const next = createDictationSession({
      onState: (state) => {
        setDictationState(state);
        if (state === "ready" && noteRef.current.trim()) {
          void applyPreview(noteRef.current);
        }
      },
      onTranscript: (chunk, isFinal) => {
        if (!isFinal) return;
        const next = `${noteRef.current}${noteRef.current ? " " : ""}${chunk.trim()}`;
        noteRef.current = next;
        onSelfNote(next);
      },
      onError: (message) => onError(message),
    });
    session.current = next;
    next.start();
  };

  return (
    <div className="setup-stage">
      <div className="setup-stage-icon"><House /></div>
      <p className="setup-eyebrow">Step 1 · A couple of facts about you</p>
      <h1>Hometowns and interests are enough.</h1>
      <p className="setup-lede">
        Speak or type two places and two interests. Nett uses them as a private prior — who might
        know each other, which hometowns to suggest — and never writes them onto other people
        without your review.
      </p>

      <div className={`memory-composer setup-self-note ${listening ? "is-listening" : ""}`}>
        <label className="visually-hidden" htmlFor="setup-self-note">
          Optional spoken or typed note about your hometowns and interests
        </label>
        <textarea
          id="setup-self-note"
          value={selfNote}
          onChange={(event) => onSelfNote(event.target.value)}
          placeholder="I grew up in Dallas and Austin. I’m into climbing and climate."
          disabled={busy}
        />
        <button
          type="button"
          className="voice-button"
          onClick={toggleVoice}
          aria-label={listening ? "Stop recording" : "Record hometowns and interests"}
          aria-pressed={listening}
          title={capability.disclosure}
          disabled={busy || (!capability.available && dictationState === "idle")}
        >
          {listening ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
        </button>
        {listening && (
          <span className="voice-state" role="status">
            <i />
            <i />
            <i />
            {dictationState === "requesting-permission" ? "Requesting mic" : "Listening"}
          </span>
        )}
      </div>
      {capability.mayUseRemoteService && (
        <p className="capture-privacy" role="note">{capability.disclosure}</p>
      )}
      {!capability.available && (
        <p className="capture-privacy" role="note">{capability.disclosure}</p>
      )}

      <div className="setup-you-fields">
        <ChipInput
          label="Hometowns"
          values={hometowns}
          onChange={onHometowns}
          placeholder="Dallas, then Enter"
          disabled={busy}
        />
        <ChipInput
          label="Interests"
          values={interests}
          onChange={onInterests}
          placeholder="Climbing, then Enter"
          disabled={busy}
        />
      </div>

      <div className="setup-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || previewing || !selfNote.trim()}
          onClick={() => void applyPreview(selfNote)}
        >
          {previewing ? <SpinnerGap className="spin" /> : <House />}
          {previewing ? "Reading…" : "Fill chips from this"}
        </button>
        <button type="button" className="primary-button" disabled={busy} onClick={onContinue}>
          Continue <ArrowRight />
        </button>
        <button type="button" className="text-button" disabled={busy} onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
