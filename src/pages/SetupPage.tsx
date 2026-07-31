import {
  AddressBook,
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  FileArrowUp,
  LockKey,
  Quotes,
  ShieldCheck,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { SetupStatus } from "@/types";

const steps: { id: SetupStatus["phase"]; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "contacts", label: "Contacts" },
  { id: "messages", label: "Messages" },
  { id: "optional", label: "Optional" },
  { id: "complete", label: "Ready" },
];

export function SetupPage({
  initialStatus,
  onChanged,
}: {
  initialStatus: SetupStatus;
  onChanged: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(initialStatus);
  const [ownerName, setOwnerName] = useState(initialStatus.ownerDisplayName || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const messagesInput = useRef<HTMLInputElement>(null);
  const spreadsheetInput = useRef<HTMLInputElement>(null);

  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === status.phase));

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

  async function importContacts() {
    await run("contacts", async () => {
      setProgress("Requesting Contacts access…");
      const result = await api.sync("apple-contacts");
      setProgress(result.message);
      await update({ phase: "messages" });
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
      if (done) await update({ phase: "optional" });
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

  async function skip(step: "contacts" | "messages" | "optional", next: SetupStatus["phase"]) {
    await run(`skip-${step}`, async () => {
      await update({ skipStep: step, phase: next });
      setProgress("");
    });
  }

  async function finish() {
    await run("complete", async () => {
      await update({ complete: true });
      navigate("/", { replace: true });
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
          <div className="setup-stage">
            <p className="setup-eyebrow">Private relationship workspace</p>
            <h1>Build your network from records you already own.</h1>
            <p className="setup-lede">
              Nett brings contacts, conversations, and notes into one local, evidence-backed workspace.
              There is no account to create and nothing is uploaded by default.
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
                  await update({ ownerDisplayName: ownerName, phase: "contacts" });
                })}
              >
                Continue <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status.phase === "contacts" && (
          <div className="setup-stage">
            <div className="setup-stage-icon"><AddressBook /></div>
            <p className="setup-eyebrow">Step 1 · Identity foundation</p>
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
              <button className="text-button" disabled={Boolean(busy)} onClick={() => void skip("contacts", "messages")}>
                Skip for now
              </button>
            </div>
          </div>
        )}

        {status.phase === "messages" && (
          <div className="setup-stage">
            <div className="setup-stage-icon"><Quotes /></div>
            <p className="setup-eyebrow">Step 2 · Communication history</p>
            <h1>Connect Messages without touching the original.</h1>
            <p className="setup-lede">
              Nett first creates and validates a private SQLite backup. Imports are resumable and the source
              chat database remains read-only.
            </p>
            <div className="setup-status-row">
              <span className={status.milestones.messages.readable ? "status-dot is-good" : "status-dot"} />
              <div>
                <strong>{status.milestones.messages.readable ? "Private copy ready" : "Messages copy needed"}</strong>
                <span>
                  {status.milestones.messages.messageCount !== null
                    ? `${status.milestones.messages.messageCount.toLocaleString()} records available`
                    : "Grant Full Disk Access to the app running Nett, or choose a copied chat.db"}
                </span>
              </div>
            </div>
            <input
              ref={messagesInput}
              className="visually-hidden"
              type="file"
              accept=".db,.sqlite,.sqlite3,application/x-sqlite3"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void prepareMessages(file);
                event.currentTarget.value = "";
              }}
            />
            <div className="setup-actions">
              {status.milestones.messages.readable ? (
                <button className="primary-button" disabled={Boolean(busy)} onClick={() => void importMessages()}>
                  {busy === "messages" ? <SpinnerGap className="spin" /> : <Quotes />}
                  {busy === "messages" ? "Importing in batches…" : "Import Messages"}
                </button>
              ) : (
                <button className="primary-button" disabled={Boolean(busy)} onClick={() => void prepareMessages()}>
                  {busy === "prepare-messages" ? <SpinnerGap className="spin" /> : <Database />}
                  Prepare local copy
                </button>
              )}
              <button className="secondary-button" disabled={Boolean(busy)} onClick={() => messagesInput.current?.click()}>
                <FileArrowUp /> Choose copied database
              </button>
              {busy === "messages" ? (
                <button className="text-button" onClick={() => { stopRequested.current = true; }}>
                  Stop after this batch
                </button>
              ) : (
                <button className="text-button" disabled={Boolean(busy)} onClick={() => void skip("messages", "optional")}>
                  Skip for now
                </button>
              )}
            </div>
          </div>
        )}

        {status.phase === "optional" && (
          <div className="setup-stage">
            <div className="setup-stage-icon"><FileArrowUp /></div>
            <p className="setup-eyebrow">Optional · Existing context</p>
            <h1>Add a spreadsheet, or continue with what you have.</h1>
            <p className="setup-lede">
              CSV and Excel rows merge automatically only on exact email, exact phone, or a unique identical
              name. Ambiguous rows wait for your review.
            </p>
            <input
              ref={spreadsheetInput}
              className="visually-hidden"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSpreadsheet(file);
                event.currentTarget.value = "";
              }}
            />
            <div className="setup-actions">
              <button className="secondary-button" disabled={Boolean(busy)} onClick={() => spreadsheetInput.current?.click()}>
                {busy === "spreadsheet" ? <SpinnerGap className="spin" /> : <FileArrowUp />}
                Choose CSV or Excel file
              </button>
              <button className="primary-button" disabled={Boolean(busy)} onClick={() => void finish()}>
                Open Nett <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status.phase === "complete" && (
          <div className="setup-stage">
            <div className="setup-stage-icon is-complete"><Check weight="bold" /></div>
            <p className="setup-eyebrow">Workspace ready</p>
            <h1>Your private network is ready to use.</h1>
            <p className="setup-lede">
              {status.milestones.peopleCount.toLocaleString()} people are available. You can add or reconnect
              sources at any time from Settings.
            </p>
            <div className="setup-actions">
              <button className="primary-button" onClick={() => navigate("/", { replace: true })}>
                Open dashboard <ArrowRight />
              </button>
              <button className="text-button" onClick={() => void update({ phase: "contacts" })}>
                <ArrowLeft /> Review setup
              </button>
            </div>
          </div>
        )}

        {(progress || error) && (
          <div className={error ? "setup-feedback is-error" : "setup-feedback"}>
            {error || progress}
          </div>
        )}
      </section>
    </main>
  );
}
