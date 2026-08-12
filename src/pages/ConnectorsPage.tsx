import {
  AddressBook,
  ArrowClockwise,
  CalendarBlank,
  CaretDown,
  Check,
  Clock,
  Database,
  DownloadSimple,
  FileCsv,
  GearSix,
  LinkSimple,
  PaperPlaneTilt,
  Plus,
  Quotes,
  ShieldCheck,
  SpinnerGap,
  Users,
  WarningCircle,
} from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Avatar, friendlyDate, SourceBadge, type ToastKind } from "@/components/Primitives";
import { api } from "@/lib/api";
import type { Overview } from "@/types";

const liveConnectors = [
  {
    id: "apple-contacts",
    label: "Apple Contacts",
    blurb: "Identity fields via macOS Automation",
    icon: AddressBook,
  },
  {
    id: "messages",
    label: "Messages",
    blurb: "Local chat.db evidence",
    icon: Quotes,
  },
  {
    id: "gmail",
    label: "Gmail",
    blurb: "Read-only OAuth · Keychain tokens",
    icon: PaperPlaneTilt,
  },
  {
    id: "telegram",
    label: "Telegram",
    blurb: "Local MTProto session",
    icon: PaperPlaneTilt,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    blurb: "Desktop archive via wacrawl",
    icon: Quotes,
  },
];

const futureConnectors = [
  { label: "Calendar", icon: CalendarBlank },
  { label: "MCP plugins", icon: GearSix },
];

type Freshness = Awaited<ReturnType<typeof api.freshness>>;

function formatInterval(ms?: number) {
  if (!ms || ms <= 0) return null;
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1) return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
  const minutes = Math.round(ms / 60_000);
  return `${minutes}m`;
}

export function ConnectorsPage({
  overview,
  refresh,
  notify,
  onImport,
}: {
  overview: Overview;
  refresh: () => void;
  notify: (kind: ToastKind, message: string) => void;
  onImport: () => void;
}) {
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncStage, setSyncStage] = useState("");
  const [setup, setSetup] = useState<"gmail" | "telegram" | "whatsapp" | "whatsapp-export" | "messages" | null>(null);
  const [platform, setPlatform] = useState<Awaited<ReturnType<typeof api.platformStatus>> | null>(null);
  const [intelligence, setIntelligence] = useState<Awaited<ReturnType<typeof api.intelligenceStatus>> | null>(null);
  const [messagesStatus, setMessagesStatus] = useState<Awaited<ReturnType<typeof api.messagesStatus>> | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<Awaited<ReturnType<typeof api.whatsappStatus>> | null>(null);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [togglingFreshness, setTogglingFreshness] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => timers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );
  const loadPlatform = useCallback(() => {
    api.platformStatus().then(setPlatform).catch(() => setPlatform(null));
    api.intelligenceStatus().then(setIntelligence).catch(() => setIntelligence(null));
    api.messagesStatus().then(setMessagesStatus).catch(() => setMessagesStatus(null));
    api.whatsappStatus().then(setWhatsappStatus).catch(() => setWhatsappStatus(null));
    api.freshness().then(setFreshness).catch(() => setFreshness(null));
  }, []);
  useEffect(() => loadPlatform(), [loadPlatform]);

  const sync = async (id: string) => {
    if (id === "gmail" || id === "telegram") {
      const account = platform?.accounts.find((item) => item.connectorId === id);
      if (!account || account.authState !== "authenticated") {
        setSetup(id);
        return;
      }
    }
    if (id === "messages" && messagesStatus && !messagesStatus.readable) {
      setSetup("messages");
      return;
    }
    if (id === "whatsapp" && whatsappStatus && !whatsappStatus.readable) {
      setSetup("whatsapp");
      return;
    }
    timers.current.forEach((timer) => window.clearTimeout(timer));
    setSyncing(id);
    setSyncStage("Requesting source access");
    timers.current = [
      window.setTimeout(() => setSyncStage("Reading permissioned records"), 700),
      window.setTimeout(() => setSyncStage("Resolving source identities"), 1700),
    ];
    try {
      const batched = id === "messages" || id === "whatsapp";
      let result = await api.sync(id, undefined, batched ? 50 : undefined);
      while (batched && result.done === false) {
        setSyncStage(result.message);
        result = await api.sync(id, undefined, 50);
      }
      setSyncStage("Refreshing relationship indexes");
      await Promise.resolve(refresh());
      loadPlatform();
      notify("success", result.message);
    } catch (error) {
      if (id === "messages" || id === "whatsapp") setSetup(id);
      notify("error", error instanceof Error ? error.message : "Sync failed");
      refresh();
      loadPlatform();
    } finally {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      setSyncing(null);
      setSyncStage("");
    }
  };

  const pullNewMessages = async () => {
    if (messagesStatus && !messagesStatus.readable) {
      setSetup("messages");
      return;
    }
    timers.current.forEach((timer) => window.clearTimeout(timer));
    setSyncing("messages");
    setSyncStage("Copying new Messages into Nett’s private database");
    try {
      const prepared = await api.prepareMessagesCopy({ resetCursor: false });
      setSyncStage(prepared.message);
      let result = await api.sync("messages", undefined, 50);
      while (result.done === false) {
        setSyncStage(result.message);
        result = await api.sync("messages", undefined, 50);
      }
      await Promise.resolve(refresh());
      loadPlatform();
      notify(
        "success",
        result.seen
          ? `Pulled ${result.seen.toLocaleString()} new Messages records.`
          : "Messages copy is current. No new records since the last import.",
      );
    } catch (error) {
      setSetup("messages");
      notify("error", error instanceof Error ? error.message : "Could not pull new messages");
      refresh();
      loadPlatform();
    } finally {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      setSyncing(null);
      setSyncStage("");
    }
  };

  const pullNewWhatsApp = async () => {
    if (whatsappStatus && !whatsappStatus.readable) {
      setSetup("whatsapp");
      return;
    }
    timers.current.forEach((timer) => window.clearTimeout(timer));
    setSyncing("whatsapp");
    setSyncStage("Syncing WhatsApp Desktop through wacrawl");
    try {
      const prepared = await api.prepareWhatsAppArchive({ resetCursor: false });
      setSyncStage(prepared.message);
      let result = await api.sync("whatsapp", undefined, 50);
      while (result.done === false) {
        setSyncStage(result.message);
        result = await api.sync("whatsapp", undefined, 50);
      }
      await Promise.resolve(refresh());
      loadPlatform();
      notify(
        "success",
        result.seen
          ? `Pulled ${result.seen.toLocaleString()} new WhatsApp records.`
          : "WhatsApp archive is current. No new records since the last import.",
      );
    } catch (error) {
      setSetup("whatsapp");
      notify("error", error instanceof Error ? error.message : "Could not pull WhatsApp messages");
      refresh();
      loadPlatform();
    } finally {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      setSyncing(null);
      setSyncStage("");
    }
  };

  const toggleFreshness = async (enabled: boolean) => {
    setTogglingFreshness(true);
    try {
      const next = await api.setFreshness(enabled);
      setFreshness(next);
      notify(
        "success",
        enabled
          ? "Auto-pull on. Messages and WhatsApp refresh about every 6 hours while Nett is open."
          : "Auto-pull off. Refresh sources manually when you need them.",
      );
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not update auto-pull");
    } finally {
      setTogglingFreshness(false);
    }
  };

  const whatsappInterval = formatInterval(freshness?.intervalsMs?.whatsapp) || "6h";

  return (
    <div className="connectors-page">
      <nav className="settings-nav" aria-label="Settings sections">
        <span>Settings</span>
        <a href="#sources" className="is-active">
          Sources
        </a>
        <a href="#merge-review">Merge review</a>
        <a href="#more">More</a>
      </nav>

      <section className="page-heading sources-heading">
        <div>
          <h1>Sources</h1>
          <p>Status and last refresh. Pull only when something is stale.</p>
        </div>
      </section>

      <section className="sources-autopull" aria-label="Automatic local refresh">
        <div>
          <strong>Auto-pull while Nett is open</strong>
          <p>
            Messages and WhatsApp every {whatsappInterval}. Needs this Mac awake — sleep or quit
            skips a cycle. Not a cloud agent.
          </p>
        </div>
        <label className="sources-toggle">
          <input
            type="checkbox"
            checked={Boolean(freshness?.enabled)}
            disabled={togglingFreshness || freshness == null}
            onChange={(event) => void toggleFreshness(event.target.checked)}
          />
          <span>{freshness?.enabled ? "On" : "Off"}</span>
        </label>
        {freshness?.running && (
          <p className="sync-progress" role="status" aria-live="polite">
            <SpinnerGap className="spin" size={13} />
            Syncing {freshness.running}…
          </p>
        )}
      </section>

      <section className="sources-meta-row" aria-label="Local intelligence">
        <div className="sources-meta-main">
          <span className={`permission-state ${intelligence?.ok ? "state-granted" : "state-blocked"}`}>
            {intelligence?.ok ? <Check size={13} /> : <WarningCircle size={13} />}
            {intelligence?.ok ? "Ollama ready" : "Ollama unavailable"}
          </span>
          <span className="sources-meta-copy">
            {intelligence?.selectedModel
              ? `${intelligence.selectedModel} · ${(intelligence.evidenceDocuments || 0).toLocaleString()} evidence · ${(intelligence.embeddedDocuments || 0).toLocaleString()} embedded`
              : "Start Ollama locally for cited answers"}
          </span>
        </div>
        <button
          className="quiet-action sources-compact-btn"
          disabled={indexing || !intelligence?.ok}
          onClick={() => {
            setIndexing(true);
            api.refreshIntelligence(500)
              .then((result) => {
                notify("success", `Indexed ${result.indexed} records and embedded ${result.embedded}`);
                loadPlatform();
              })
              .catch((error) => notify("error", error instanceof Error ? error.message : "Indexing failed"))
              .finally(() => setIndexing(false));
          }}
        >
          {indexing ? <SpinnerGap className="spin" /> : <ArrowClockwise />}
          {indexing ? "Indexing" : "Index"}
        </button>
      </section>

      <section id="sources" className="connector-group">
        <div className="section-heading sources-section-heading">
          <div>
            <h2>Connectors</h2>
          </div>
        </div>
        <div className="connector-ledger">
          {liveConnectors.map(({ id, label, blurb, icon: Icon }) => {
            const state = overview.connectors?.find(
              (connector) => connector.connector_id === id,
            );
            const account = platform?.accounts.find((item) => item.connectorId === id);
            const active = syncing === id;
            const autoResult = freshness?.lastResults?.[id];
            const refreshedAt = state?.last_sync_at || autoResult?.at;
            return (
              <article key={id}>
                <div className="connector-icon" aria-hidden="true">
                  <Icon size={18} weight="regular" />
                </div>
                <div className="connector-info">
                  <h2>{label}</h2>
                  <p>{blurb}</p>
                  {active && (
                    <div className="sync-progress" role="status" aria-live="polite">
                      <SpinnerGap className="spin" size={13} />
                      {syncStage}
                    </div>
                  )}
                  {state?.last_error && (
                    <small className="connector-error">{state.last_error}</small>
                  )}
                </div>
                <div className="connector-stats">
                  <span
                    className={`permission-state state-${state?.permission_state || "unknown"}`}
                  >
                    {state?.permission_state === "granted" ? (
                      <Check size={13} />
                    ) : state?.permission_state === "blocked" ? (
                      <WarningCircle size={13} />
                    ) : (
                      <Clock size={13} />
                    )}
                    {state?.permission_state || "Unchecked"}
                  </span>
                  <small className="connector-refreshed">
                    {refreshedAt
                      ? `Refreshed ${friendlyDate(refreshedAt)}`
                      : "Never refreshed"}
                    {typeof state?.records_seen === "number" && state.records_seen > 0
                      ? ` · ${state.records_seen.toLocaleString()} seen`
                      : ""}
                  </small>
                  {freshness?.enabled
                    && (id === "messages" || id === "whatsapp" || (id === "gmail" && state?.last_sync_at))
                    && freshness.nextDue?.[id] && (
                    <small className="connector-next-due">
                      Next auto {friendlyDate(freshness.nextDue[id] || undefined)}
                    </small>
                  )}
                </div>
                <div className="connector-actions">
                  {id === "messages" && messagesStatus?.readable ? (
                    <>
                      <button
                        className="primary-button sources-compact-btn"
                        onClick={() => void pullNewMessages()}
                        disabled={Boolean(syncing)}
                      >
                        {active ? <SpinnerGap className="spin" /> : <DownloadSimple />}
                        {active ? "Pulling" : "Pull"}
                      </button>
                      <button
                        className="secondary-button sources-compact-btn"
                        onClick={() => setSetup("messages")}
                        disabled={Boolean(syncing)}
                        aria-label="Messages setup options"
                      >
                        <GearSix />
                        Options
                      </button>
                    </>
                  ) : id === "whatsapp" && whatsappStatus?.readable ? (
                    <>
                      <button
                        className="primary-button sources-compact-btn"
                        onClick={() => void pullNewWhatsApp()}
                        disabled={Boolean(syncing)}
                      >
                        {active ? <SpinnerGap className="spin" /> : <DownloadSimple />}
                        {active ? "Pulling" : "Pull"}
                      </button>
                      <button
                        className="secondary-button sources-compact-btn"
                        onClick={() => setSetup("whatsapp")}
                        disabled={Boolean(syncing)}
                        aria-label="WhatsApp setup options"
                      >
                        <GearSix />
                        Options
                      </button>
                    </>
                  ) : id === "gmail" || id === "telegram" ? (
                    <>
                      <button
                        className="primary-button sources-compact-btn"
                        onClick={() => void sync(id)}
                        disabled={Boolean(syncing)}
                      >
                        {active ? <SpinnerGap className="spin" /> : <ArrowClockwise />}
                        {active
                          ? "Syncing"
                          : account?.authState === "authenticated" || state?.last_sync_at
                            ? "Refresh"
                            : "Connect"}
                      </button>
                      <button
                        className="secondary-button sources-compact-btn"
                        onClick={() => setSetup(id)}
                        disabled={Boolean(syncing)}
                        aria-label={`${label} setup options`}
                      >
                        <GearSix />
                        Options
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary-button sources-compact-btn"
                      onClick={() => {
                        if (id === "messages" && messagesStatus && !messagesStatus.readable) {
                          setSetup("messages");
                          return;
                        }
                        if (id === "whatsapp" && whatsappStatus && !whatsappStatus.readable) {
                          setSetup("whatsapp");
                          return;
                        }
                        void sync(id);
                      }}
                      disabled={Boolean(syncing)}
                    >
                      {active ? (
                        <SpinnerGap className="spin" />
                      ) : (
                        <ArrowClockwise />
                      )}
                      {active
                        ? "Syncing"
                        : (id === "messages" && messagesStatus && !messagesStatus.readable)
                          || (id === "whatsapp" && whatsappStatus && !whatsappStatus.readable)
                          ? "Set up"
                          : account?.authState === "authenticated" || state?.last_sync_at
                            ? "Refresh"
                            : "Set up"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {setup === "messages" && (
        <MessagesSetup
          status={messagesStatus}
          onClose={() => setSetup(null)}
          onReady={async () => {
            loadPlatform();
            setSetup(null);
            await sync("messages");
          }}
          notify={notify}
        />
      )}
      {setup === "gmail" && (
        <GmailSetup
          account={platform?.accounts.find((item) => item.connectorId === "gmail")}
          onClose={() => setSetup(null)}
          onChanged={() => { loadPlatform(); refresh(); }}
          notify={notify}
        />
      )}
      {setup === "telegram" && (
        <TelegramSetup
          account={platform?.accounts.find((item) => item.connectorId === "telegram")}
          onClose={() => setSetup(null)}
          onChanged={() => { loadPlatform(); refresh(); }}
          notify={notify}
        />
      )}
      {setup === "whatsapp" && (
        <WhatsAppDesktopSetup
          status={whatsappStatus}
          onClose={() => setSetup(null)}
          onReady={async () => {
            loadPlatform();
            setSetup(null);
            await sync("whatsapp");
          }}
          notify={notify}
        />
      )}

      <section className="sources-imports" aria-label="One-time imports">
        <button type="button" className="sources-import-action" onClick={onImport}>
          <FileCsv size={16} />
          <span>
            <strong>Spreadsheet</strong>
            <small>CSV or Excel</small>
          </span>
        </button>
        <button type="button" className="sources-import-action" onClick={() => setSetup("whatsapp-export")}>
          <Quotes size={16} />
          <span>
            <strong>WhatsApp export</strong>
            <small>Fallback .txt / .zip</small>
          </span>
        </button>
      </section>
      {setup === "whatsapp-export" && (
        <WhatsAppExportSetup
          onClose={() => setSetup(null)}
          onChanged={() => { loadPlatform(); refresh(); }}
          notify={notify}
        />
      )}

      <div id="merge-review">
        <MergeReview refresh={refresh} notify={notify} />
      </div>

      <details id="more" className="sources-more">
        <summary>
          <CaretDown size={14} />
          Permissions, LinkedIn assist, and planned connectors
        </summary>
        <section className="sources-more-block">
          <h3>LinkedIn public profile assist</h3>
          <p>
            Open a person, choose Edit fields, then paste a public profile URL and visible text.
            Local parse with field-by-field review before saving.
          </p>
          <span className="permission-state state-granted">
            <Users size={13} /> User assisted
          </span>
        </section>
        <section id="permissions" className="permission-guide">
          <div>
            <ShieldCheck size={20} weight="duotone" />
            <h2>macOS permissions</h2>
          </div>
          <div>
            <strong>Contacts</strong>
            <p>
              Allow the process running Nett to control Contacts when macOS prompts. Review
              access under System Settings, Privacy &amp; Security, Automation.
            </p>
          </div>
          <div>
            <strong>Messages</strong>
            <p>
              Prefer Sources → Messages → Options → Prepare local copy. That uses Terminal
              sqlite3 without giving Node Full Disk Access. You can also upload a copied chat.db.
            </p>
          </div>
          <div>
            <strong>WhatsApp</strong>
            <p>
              Install{" "}
              <a href="https://github.com/openclaw/wacrawl" target="_blank" rel="noreferrer">
                wacrawl
              </a>
              , keep WhatsApp Desktop synced, then Pull. Nett reads a local snapshot only.
            </p>
          </div>
        </section>
        <section className="future-connectors">
          <div className="section-heading">
            <div>
              <h2>Planned</h2>
              <p>Visible for planning only. These cannot read or sync yet.</p>
            </div>
          </div>
          <div>
            {futureConnectors.map(({ label, icon: Icon }) => (
              <span key={label} aria-disabled="true">
                <Icon size={18} />
                <strong>{label}</strong>
                <small>Planned</small>
              </span>
            ))}
          </div>
        </section>
        <section className="merge-clear">
          <LinkSimple size={17} />
          <span>
            <strong>Local MCP bridge</strong>
            <small>
              {platform?.mcp.configured
                ? `${platform.mcp.servers.filter((server) => server.enabled).length} local plugin server(s) enabled`
                : "Optional connector manifest not configured"}
            </small>
          </span>
        </section>
      </details>
    </div>
  );
}

type PlatformAccount = Awaited<ReturnType<typeof api.platformStatus>>["accounts"][number];

function SetupShell({
  title,
  detail,
  onClose,
  children,
}: {
  title: string;
  detail: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="connector-setup panel" aria-label={`${title} setup`}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
        <button className="text-button" onClick={onClose}>Close</button>
      </div>
      {children}
    </section>
  );
}

function MessagesSetup({
  status,
  onClose,
  onReady,
  notify,
}: {
  status: Awaited<ReturnType<typeof api.messagesStatus>> | null;
  onClose: () => void;
  onReady: () => void | Promise<void>;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const prepare = async () => {
    setWorking(true);
    try {
      const result = await api.prepareMessagesCopy({ resetCursor: true });
      notify("success", result.message);
      await onReady();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not prepare Messages copy");
    } finally {
      setWorking(false);
    }
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setWorking(true);
    try {
      const result = await api.importMessagesDb(file);
      notify("success", result.message);
      await onReady();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Messages database import failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <SetupShell
      title="Messages access"
      detail="macOS protects ~/Library/Messages/chat.db. Grant Full Disk Access to the app running Nett, prepare a validated local copy, or choose a chat.db you already copied."
      onClose={onClose}
    >
      <div className="connector-setup-form">
        <div className="full-field">
          <span>Current status</span>
          <p>
            {status?.readable
              ? `Readable · ${(status.messageCount || 0).toLocaleString()} messages · ${status.usingLocalCopy ? "local copy" : "system database"}`
              : status?.error || "Messages database is not readable yet"}
          </p>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="primary-button"
            disabled={working}
            onClick={() => void prepare()}
          >
            {working ? <SpinnerGap className="spin" /> : <Database />}
            Prepare local copy
          </button>
        </div>
        <form className="full-field" onSubmit={upload}>
          <label>
            <span>Or upload chat.db / messages.db</span>
            <input
              type="file"
              accept=".db,application/x-sqlite3,application/octet-stream"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <div className="modal-actions">
            <button className="secondary-button" disabled={working || !file}>
              {working ? <SpinnerGap className="spin" /> : <Plus />}
              Import database
            </button>
          </div>
        </form>
      </div>
    </SetupShell>
  );
}

function GmailSetup({
  account,
  onClose,
  onChanged,
  notify,
}: {
  account?: PlatformAccount;
  onClose: () => void;
  onChanged: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [clientId, setClientId] = useState(String(account?.settings.clientId || ""));
  const [clientSecret, setClientSecret] = useState("");
  const [bundledClientId, setBundledClientId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(account?.settings.clientId ? 3 : 1);
  const [working, setWorking] = useState(false);
  const configured = Boolean(clientId || account?.settings.clientId || bundledClientId);
  const authState = account?.authState || "missing";

  useEffect(() => {
    let current = true;
    api.gmailDefaults()
      .then((defaults) => {
        if (!current) return;
        setBundledClientId(defaults.bundledClientId);
        if (defaults.bundledClientId && !account?.settings.clientId) setStep(3);
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [account?.settings.clientId]);

  const configure = async (event?: FormEvent, useBundled = false) => {
    event?.preventDefault();
    setWorking(true);
    try {
      const result = await api.configureGmail({
        clientId: useBundled ? undefined : clientId,
        clientSecret: useBundled ? undefined : clientSecret,
        accountId: account?.accountId || "primary",
        useBundledClient: useBundled,
      });
      setClientId(result.clientId);
      setClientSecret("");
      setStep(3);
      onChanged();
      notify("success", "Google OAuth configuration saved to this Mac");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Gmail setup failed");
    } finally {
      setWorking(false);
    }
  };

  const connectBundled = async () => {
    setWorking(true);
    try {
      await api.configureGmail({
        accountId: account?.accountId || "primary",
        useBundledClient: true,
      });
      const result = await api.authorizeGmail(account?.accountId || "primary");
      window.location.assign(result.url);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Gmail authorization failed");
      setWorking(false);
    }
  };

  const authorize = async () => {
    setWorking(true);
    try {
      if (!account?.settings.clientId && clientId.trim()) {
        await api.configureGmail({
          clientId,
          clientSecret,
          accountId: account?.accountId || "primary",
        });
      }
      const result = await api.authorizeGmail(account?.accountId || "primary");
      window.location.assign(result.url);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Gmail authorization failed");
      setWorking(false);
    }
  };

  const statusCopy = (() => {
    if (authState === "authorized" || authState === "ready") return "Gmail linked. Refresh to sync up to 2,000 recent messages.";
    if (authState === "pending-user") return "Authorization started — finish consent in Google, then refresh.";
    if (authState === "expired") return "Authorization expired. Connect again.";
    if (configured) return "Configured. Authorize in Google to start a read-only sync.";
    return "Not configured yet.";
  })();

  return (
    <SetupShell
      title="Gmail"
      detail="Read-only OAuth. Tokens stay in macOS Keychain. Mail is normalized into the same local conversation model as Messages."
      onClose={onClose}
    >
      <div className="gmail-wizard">
        <p className="gmail-wizard-status" role="status">{statusCopy}</p>
        {bundledClientId ? (
          <div className="modal-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void connectBundled()}
              disabled={working}
            >
              {working ? <SpinnerGap className="spin" /> : <LinkSimple />}
              Connect Gmail
            </button>
            <button type="button" className="secondary-button" onClick={() => setStep(2)} disabled={working}>
              Use my own client ID
            </button>
          </div>
        ) : null}
        {(!bundledClientId || step !== 3) && (
          <>
            <ol className="gmail-wizard-steps">
              <li>
                In Google Cloud Console, enable the Gmail API and create a Desktop OAuth client.
                {step === 1 && !bundledClientId ? " Add yourself as a test user if the app is in Testing." : ""}
              </li>
              <li>Paste the client ID below. Client secret is optional for desktop PKCE.</li>
              <li>Authorize in Google, then refresh Gmail (bounded to 2,000 recent messages).</li>
            </ol>
            <form className="connector-setup-form" onSubmit={(event) => void configure(event, false)}>
              <label>
                <span>OAuth client ID</span>
                <input
                  value={clientId}
                  onChange={(event) => {
                    setClientId(event.target.value);
                    setStep(2);
                  }}
                  placeholder="…apps.googleusercontent.com"
                  required={!bundledClientId}
                />
              </label>
              <label>
                <span>Client secret (optional)</span>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder={account ? "Leave blank to keep saved secret" : "Stored only in Keychain"}
                />
              </label>
              <div className="modal-actions">
                <button className="secondary-button" disabled={working || !clientId.trim()}>
                  {working ? <SpinnerGap className="spin" /> : <Check />}
                  Save configuration
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void authorize()}
                  disabled={working || !configured}
                >
                  <LinkSimple />
                  Authorize in Google
                </button>
              </div>
            </form>
          </>
        )}
        {bundledClientId && step === 3 && authState !== "authorized" && authState !== "ready" ? (
          <p className="person-capture-note">
            One click uses Nett&apos;s desktop OAuth client. Advanced setup is still available above.
          </p>
        ) : null}
      </div>
    </SetupShell>
  );
}

function TelegramSetup({
  account,
  onClose,
  onChanged,
  notify,
}: {
  account?: PlatformAccount;
  onClose: () => void;
  onChanged: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [apiId, setApiId] = useState(String(account?.settings.apiId || ""));
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState(String(account?.settings.phone || ""));
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"configure" | "phone" | "otp" | "password">(
    account?.settings.apiId ? "phone" : "configure",
  );
  const [working, setWorking] = useState(false);
  const accountId = account?.accountId || "primary";

  const run = async (work: () => Promise<void>) => {
    setWorking(true);
    try { await work(); }
    catch (error) { notify("error", error instanceof Error ? error.message : "Telegram setup failed"); }
    finally { setWorking(false); }
  };
  const configure = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.configureTelegram({ accountId, apiId: Number(apiId), apiHash });
      setApiHash("");
      setStep("phone");
      onChanged();
      notify("success", "Telegram API credentials saved to macOS Keychain");
    });
  };
  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.authorizeTelegram(accountId, phone);
      setStep("otp");
      onChanged();
    });
  };
  const verifyCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api.submitTelegramOtp(accountId, otp);
      if (result.step === "password") setStep("password");
      else {
        onChanged();
        onClose();
        notify("success", "Telegram connected locally");
      }
    });
  };
  const verifyPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.submitTelegramPassword(accountId, password);
      setPassword("");
      onChanged();
      onClose();
      notify("success", "Telegram connected locally");
    });
  };

  return (
    <SetupShell
      title="Telegram"
      detail="Use the api_id and api_hash from my.telegram.org. The authenticated MTProto session never leaves this Mac."
      onClose={onClose}
    >
      {step === "configure" && (
        <form className="connector-setup-form" onSubmit={configure}>
          <label><span>API ID</span><input inputMode="numeric" value={apiId} onChange={(event) => setApiId(event.target.value)} required /></label>
          <label><span>API hash</span><input type="password" value={apiHash} onChange={(event) => setApiHash(event.target.value)} required /></label>
          <div className="modal-actions"><button className="primary-button" disabled={working}>Save and continue</button></div>
        </form>
      )}
      {step === "phone" && (
        <form className="connector-setup-form" onSubmit={sendCode}>
          <label><span>Phone number with country code</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1…" required /></label>
          <div className="modal-actions"><button className="primary-button" disabled={working}>Send Telegram code</button></div>
        </form>
      )}
      {step === "otp" && (
        <form className="connector-setup-form" onSubmit={verifyCode}>
          <label><span>Verification code</span><input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} required autoFocus /></label>
          <div className="modal-actions"><button className="primary-button" disabled={working}>Verify code</button></div>
        </form>
      )}
      {step === "password" && (
        <form className="connector-setup-form" onSubmit={verifyPassword}>
          <label><span>Telegram two-step password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></label>
          <div className="modal-actions"><button className="primary-button" disabled={working}>Finish connection</button></div>
        </form>
      )}
    </SetupShell>
  );
}

function WhatsAppDesktopSetup({
  status,
  onClose,
  onReady,
  notify,
}: {
  status: Awaited<ReturnType<typeof api.whatsappStatus>> | null;
  onClose: () => void;
  onReady: () => void | Promise<void>;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [working, setWorking] = useState(false);

  const prepare = async (resetCursor: boolean, importIntoNett: boolean) => {
    setWorking(true);
    try {
      const result = await api.prepareWhatsAppArchive({ resetCursor });
      notify("success", result.message);
      if (importIntoNett) await onReady();
      else onClose();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not prepare WhatsApp archive");
    } finally {
      setWorking(false);
    }
  };

  return (
    <SetupShell
      title="WhatsApp Desktop"
      detail="Nett uses openclaw/wacrawl to snapshot WhatsApp Desktop’s local SQLite databases into a private archive, then links messages to people by phone."
      onClose={onClose}
    >
      <div className="connector-setup-form">
        <div className="full-field">
          <span>Current status</span>
          <p>
            {!status?.binaryFound
              ? status?.error || "wacrawl is not installed"
              : status.desktopAvailable
                ? `Desktop readable · ${(status.desktopMessageCount || 0).toLocaleString()} messages · ${(status.desktopChatCount || 0).toLocaleString()} chats`
                : status.error || "WhatsApp Desktop database is not available"}
          </p>
          {status?.archiveReadable && (
            <p>
              Archive · {(status.archiveMessageCount || 0).toLocaleString()} messages
              {status.syncCursor.lastRowId
                ? ` · Nett cursor at rowid ${status.syncCursor.lastRowId}`
                : " · not imported into Nett yet"}
            </p>
          )}
          {!status?.binaryFound && (
            <p>
              Install with <code>brew install openclaw/tap/wacrawl</code>, or place the binary at{" "}
              <code>tools/bin/wacrawl</code>, or set <code>NETT_WACRAWL_BIN</code>.
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button
            className="primary-button"
            disabled={working || !status?.binaryFound || !status.desktopAvailable}
            onClick={() => void prepare(!status?.syncCursor.lastRowId, true)}
          >
            {working ? <SpinnerGap className="spin" /> : <Database />}
            Sync archive and import
          </button>
          <button
            className="secondary-button"
            disabled={working || !status?.binaryFound || !status.desktopAvailable}
            onClick={() => void prepare(false, false)}
          >
            Refresh archive only
          </button>
        </div>
      </div>
    </SetupShell>
  );
}

function WhatsAppExportSetup({
  onClose,
  onChanged,
  notify,
}: {
  onClose: () => void;
  onChanged: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [selfNames, setSelfNames] = useState("");
  const [dateOrder, setDateOrder] = useState<"DMY" | "MDY" | "YMD">("DMY");
  const [working, setWorking] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setWorking(true);
    try {
      const result = await api.importWhatsApp(file, {
        conversationTitle: title,
        selfNames,
        dateOrder,
      });
      onChanged();
      onClose();
      notify("success", result.message);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "WhatsApp import failed");
    } finally {
      setWorking(false);
    }
  };
  return (
    <SetupShell
      title="WhatsApp export"
      detail="Export a chat without media from WhatsApp and choose the .txt or .zip. Prefer the Desktop connector when available."
      onClose={onClose}
    >
      <form className="connector-setup-form" onSubmit={submit}>
        <label><span>Chat export</span><input type="file" accept=".txt,.zip,text/plain,application/zip" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
        <label><span>Conversation title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional override" /></label>
        <label><span>Your name(s) in this export</span><input value={selfNames} onChange={(event) => setSelfNames(event.target.value)} placeholder="Josh; Joshua" /></label>
        <label><span>Date order</span><select value={dateOrder} onChange={(event) => setDateOrder(event.target.value as "DMY" | "MDY" | "YMD")}><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option><option value="YMD">Year / month / day</option></select></label>
        <div className="modal-actions"><button className="primary-button" disabled={working || !file}>{working ? <SpinnerGap className="spin" /> : <Plus />}Import locally</button></div>
      </form>
    </SetupShell>
  );
}

function MergeReview({
  refresh,
  notify,
}: {
  refresh: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof api.mergeQueue>>>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .mergeQueue()
      .then(setQueue)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Merge queue unavailable"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const resolve = async (
    identityId: string,
    personId?: string,
    createNew = false,
  ) => {
    setWorking(identityId);
    try {
      await api.resolveMerge(identityId, personId, createNew);
      await load();
      refresh();
      notify(
        "success",
        createNew
          ? "Created a separate canonical person"
          : "Source identity linked after review",
      );
    } catch (reason) {
      notify(
        "error",
        reason instanceof Error ? reason.message : "The match could not be resolved",
      );
    } finally {
      setWorking(null);
    }
  };

  if (loading) {
    return (
      <section className="merge-clear" aria-busy="true">
        <SpinnerGap className="spin" size={17} />
        <span>
          <strong>Checking merge review</strong>
          <small>Loading uncertain identity matches.</small>
        </span>
      </section>
    );
  }
  if (error) {
    return (
      <section className="merge-clear merge-error" role="alert">
        <WarningCircle size={17} />
        <span>
          <strong>Merge review unavailable</strong>
          <small>{error}</small>
        </span>
        <button onClick={load}>Retry</button>
      </section>
    );
  }
  if (!queue.length) {
    return (
      <section className="merge-clear">
        <Check size={17} />
        <span>
          <strong>Merge review is clear</strong>
          <small>Uncertain name matches will appear here.</small>
        </span>
      </section>
    );
  }
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filteredQueue = normalizedFilter
    ? queue.filter((item) =>
        item.displayName.toLocaleLowerCase().includes(normalizedFilter)
        || item.connectorId.toLocaleLowerCase().includes(normalizedFilter)
        || item.candidates.some((candidate) =>
          candidate.name.toLocaleLowerCase().includes(normalizedFilter)
          || String(candidate.company || "").toLocaleLowerCase().includes(normalizedFilter)
        )
      )
    : queue;
  const visibleQueue = filteredQueue.slice(0, visibleCount);

  return (
    <section className="merge-review">
      <div className="section-heading">
        <div>
          <h2>Merge review</h2>
          <p>Similar names wait here so the wrong people are never combined.</p>
        </div>
        <span>{queue.length} pending</span>
      </div>
      <div className="merge-review-tools">
        <label>
          <span className="sr-only">Filter merge review</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setVisibleCount(12);
            }}
            placeholder="Filter source identity or candidate"
          />
        </label>
        <small>Showing {visibleQueue.length} of {filteredQueue.length}</small>
      </div>
      {visibleQueue.map((item) => (
        <article key={item.sourceIdentityId}>
          <div className="merge-source">
            <SourceBadge source={item.connectorId} />
            <h3>{item.displayName}</h3>
            <small>Unlinked source identity</small>
          </div>
          <div className="merge-candidates">
            {item.candidates.map((candidate) => (
              <button
                disabled={working === item.sourceIdentityId}
                onClick={() =>
                  void resolve(item.sourceIdentityId, candidate.personId)
                }
                key={candidate.suggestionId}
              >
                <Avatar
                  person={{ id: candidate.personId, name: candidate.name }}
                  size="sm"
                />
                <span>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.company || "Company not recorded"}</small>
                </span>
                <i>
                  {candidate.reason === "ambiguous-exact-name"
                    ? "Same name"
                    : `${Math.min(99, Math.round(candidate.confidence * 100))}% name similarity`}
                </i>
              </button>
            ))}
          </div>
          <button
            className="secondary-button"
            disabled={working === item.sourceIdentityId}
            onClick={() => void resolve(item.sourceIdentityId, undefined, true)}
          >
            {working === item.sourceIdentityId ? (
              <SpinnerGap className="spin" />
            ) : (
              <Plus />
            )}
            Create separate
          </button>
        </article>
      ))}
      {!visibleQueue.length && (
        <p className="quiet-empty">No pending identities match this filter.</p>
      )}
      {visibleCount < filteredQueue.length && (
        <button
          className="secondary-button merge-show-more"
          onClick={() => setVisibleCount((count) => count + 12)}
        >
          Show 12 more
        </button>
      )}
    </section>
  );
}
