import { motion, useReducedMotion } from "motion/react";
import {
  ArrowClockwise,
  Check,
  CloudSlash,
  Database,
  MagnifyingGlass,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import type { Person } from "@/types";

export type Toast = { kind: "success" | "error"; message: string } | null;
export type ToastKind = NonNullable<Toast>["kind"];

export const asList = <T,>(value: T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : [];

export function initials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

export function friendlyDate(value?: string) {
  if (!value) return "No contact recorded";
  const date = parseISO(value);
  return isValid(date) ? formatDistanceToNow(date, { addSuffix: true }) : value;
}

export function calendarDate(value?: string, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = parseISO(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : value;
}

export function sourceLabel(source = "") {
  return (
    {
      nett: "Nett",
      seed: "Nett",
      csv: "CSV",
      "apple-contacts": "Apple Contacts",
      messages: "Messages",
      "linkedin-public": "LinkedIn public",
      manual: "Nett",
      voice: "Voice capture",
    } as Record<string, string>
  )[source] || source.replace(/[-_]/g, " ");
}

export function isDue(value?: string) {
  if (!value) return false;
  const due = parseISO(value);
  if (!isValid(due)) return false;
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return due <= now;
}

export function isThisWeek(value?: string) {
  if (!value) return false;
  const due = parseISO(value);
  if (!isValid(due)) return false;
  const now = new Date();
  const week = new Date(now);
  week.setDate(now.getDate() + 7);
  return due >= now && due <= week;
}

export function Avatar({
  person,
  size = "md",
}: {
  person: Pick<Person, "name" | "id">;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <div
      className={`avatar avatar-${size}`}
      data-seed={(person.id || "0").slice(-1)}
      aria-hidden="true"
    >
      <span>{initials(person.name)}</span>
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className="source-badge">
      <Database size={10} aria-hidden="true" />
      {sourceLabel(source)}
    </span>
  );
}

export function IconButton({
  label,
  children,
  onClick,
  active,
  type = "button",
  buttonRef,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  type?: "button" | "submit";
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type={type}
      className={`icon-button ${active ? "is-active" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <MagnifyingGlass size={28} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function AppSkeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading Nett">
      <div className="skeleton-title shimmer" />
      <div className="skeleton-grid">
        <div className="skeleton-large shimmer" />
        <div className="skeleton-large shimmer" />
      </div>
      <div className="skeleton-row shimmer" />
      <div className="skeleton-row shimmer" />
    </div>
  );
}

export function ServerError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="state-page" role="alert">
      <div className="state-icon">
        <CloudSlash size={30} aria-hidden="true" />
      </div>
      <h1>Local server unavailable</h1>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>
        <ArrowClockwise size={17} />
        Retry
      </button>
      <code>npm run dev</code>
    </div>
  );
}

function getFocusable(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
  bare,
  initialFocusRef,
}: {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  bare?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduced = useReducedMotion();
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const container = shell.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      initialFocusRef?.current?.focus() || getFocusable(container)[0]?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(container);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      container.removeEventListener("keydown", keydown);
      returnTo?.focus();
    };
  }, [initialFocusRef]);

  return (
    <motion.div
      className="modal-layer"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={shell}
        className={`modal-shell ${wide ? "modal-wide" : ""} ${bare ? "modal-bare" : ""}`}
        initial={reduced ? false : { opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: reduced ? 0 : 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? descriptionId : undefined}
        aria-label={title ? undefined : "Nett dialog"}
      >
        {!bare && (
          <div className="modal-header">
            <div>
              <h1 id={titleId}>{title}</h1>
              {subtitle && <p id={descriptionId}>{subtitle}</p>}
            </div>
            <IconButton label="Close" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ToastMessage({ toast }: { toast: NonNullable<Toast> }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={`toast toast-${toast.kind}`}
      initial={reduced ? false : { opacity: 0, y: 20, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      exit={{ opacity: 0, y: 12, x: "-50%" }}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {toast.kind === "success" ? (
        <Check size={17} weight="bold" />
      ) : (
        <WarningCircle size={17} />
      )}
      <span>{toast.message}</span>
    </motion.div>
  );
}

export function SignalRing({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span
      className="signal-ring"
      style={{ "--signal": `${safeValue * 3.6}deg` } as CSSProperties}
      aria-label={`${safeValue} out of 100`}
    >
      <i aria-hidden="true">{safeValue}</i>
    </span>
  );
}
