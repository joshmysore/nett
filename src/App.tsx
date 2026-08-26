import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import {
  AppSkeleton,
  ServerError,
  ToastMessage,
  type Toast,
  type ToastKind,
} from "@/components/Primitives";
import { api } from "@/lib/api";
import { AboutPage } from "@/pages/AboutPage";
import { LandingPage } from "@/pages/LandingPage";
import type { Overview } from "@/types";
import type { CommandPaletteAction } from "@/components/Overlays";
const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const PeoplePage = lazy(() =>
  import("@/pages/PeoplePage").then((module) => ({
    default: module.PeoplePage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/pages/ProfilePage").then((module) => ({
    default: module.ProfilePage,
  })),
);
const ConnectorsPage = lazy(() =>
  import("@/pages/ConnectorsPage").then((module) => ({
    default: module.ConnectorsPage,
  })),
);
const ReviewPage = lazy(() =>
  import("@/pages/ReviewPage").then((module) => ({
    default: module.ReviewPage,
  })),
);
const PersonDrawer = lazy(() =>
  import("@/components/PersonDrawer").then((module) => ({ default: module.PersonDrawer })),
);
const CaptureDialog = lazy(() =>
  import("@/components/Overlays").then((module) => ({ default: module.CaptureDialog })),
);
const CommandPalette = lazy(() =>
  import("@/components/Overlays").then((module) => ({ default: module.CommandPalette })),
);
const ImportDialog = lazy(() =>
  import("@/components/Overlays").then((module) => ({ default: module.ImportDialog })),
);

const initialOverview: Overview = {
  total: 0,
  strongTies: 0,
  cold: 0,
  due: 0,
  locations: [],
  industries: [],
  people: [],
  coldPeople: [],
  duePeople: [],
  connectors: [],
  setup: {
    phase: "welcome",
    isFirstRun: true,
    isUsable: false,
    ownerDisplayName: null,
    ownerHometowns: [],
    ownerInterests: [],
    ownerCaptureTranscript: null,
    completedAt: null,
    skippedSteps: [],
    milestones: {
      hasPeople: false,
      peopleCount: 0,
      contacts: { permission: "unknown", status: "idle", synced: false, seen: 0, error: null },
      messages: { readable: false, usingLocalCopy: false, messageCount: null, status: "idle", synced: false, seen: 0, error: null },
      gmail: { permission: "unknown", status: "idle", synced: false, seen: 0, error: null },
      whatsapp: { permission: "unknown", status: "idle", synced: false, seen: 0, error: null },
    },
    nextAction: { step: "welcome", label: "Ask a question", route: "/today" },
  },
};

type Dialog = "capture" | "import" | null;

function NettApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview>(initialOverview);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<Toast>(null);

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.bootstrap());
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not reach the local server",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => setToast({ kind, message }),
    [],
  );

  const openCommandPalette = useCallback(() => {
    // Preload overlays that ⌘K may open so Suspense does not keep the
    // palette mounted while a lazy drawer/dialog chunk loads.
    void import("@/components/PersonDrawer");
    void import("@/components/Overlays");
    setCommandOpen(true);
  }, []);

  const runCommandAction = useCallback(
    (action: CommandPaletteAction) => {
      setCommandOpen(false);
      if (action.type === "person") {
        setDrawerId(action.id);
        return;
      }
      if (action.type === "remember") {
        setDialog("capture");
        return;
      }
      if (action.type === "import") {
        setDialog("import");
        return;
      }
      const [pathname, hash] = action.path.split("#");
      navigate({ pathname, hash: hash ? `#${hash}` : undefined });
    },
    [navigate],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const landing = location.pathname === "/" || location.pathname === "/about";
    document.documentElement.classList.toggle("on-landing", landing);
    document.body.classList.toggle("on-landing", landing);
    if (!landing) document.documentElement.style.removeProperty("background");
  }, [location.pathname]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => {
          if (!open) {
            void import("@/components/PersonDrawer");
            void import("@/components/Overlays");
          }
          return !open;
        });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setCommandOpen(false);
        setDialog("capture");
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) {
          return;
        }
        event.preventDefault();
        openCommandPalette();
      }
      if (event.key === "Escape") {
        // Modals consume Escape in the capture phase. Only clear the drawer
        // here when no dialog or command palette is open.
        if (dialog || commandOpen) return;
        setDrawerId(null);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [dialog, commandOpen, openCommandPalette]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Public marketing routes stay available while imports or connector work run.
  // Never hold them behind API bootstrap.
  if (location.pathname === "/" || location.pathname === "") {
    return (
      <>
        <LandingPage />
        <AnimatePresence>{toast && <ToastMessage toast={toast} />}</AnimatePresence>
      </>
    );
  }
  if (location.pathname === "/about") {
    return (
      <>
        <AboutPage />
        <AnimatePresence>{toast && <ToastMessage toast={toast} />}</AnimatePresence>
      </>
    );
  }

  if (loading) return <AppSkeleton />;
  if (error && overview.total === 0) {
    return <ServerError message={error} onRetry={() => void refresh()} />;
  }
  return (
    <>
      <AppShell
        onSearch={openCommandPalette}
        onCapture={() => setDialog("capture")}
        ownerName={overview.setup.ownerDisplayName}
      >
        <Suspense fallback={<AppSkeleton />}>
          <Routes>
              <Route
                path="/today"
                element={<DashboardPage onOpen={setDrawerId} />}
              />
              <Route
                path="/people"
                element={<PeoplePage onOpen={setDrawerId} />}
              />
              <Route
                path="/people/:id"
                element={<ProfilePage onChanged={refresh} notify={notify} />}
              />
              <Route
                path="/review"
                element={<ReviewPage refresh={refresh} notify={notify} />}
              />
              <Route
                path="/settings/connectors"
                element={
                  <ConnectorsPage
                    overview={overview}
                    refresh={refresh}
                    notify={notify}
                    onImport={() => setDialog("import")}
                  />
                }
              />
              <Route path="/setup" element={<Navigate to="/today" replace />} />
              <Route path="/connectors" element={<Navigate to="/settings/connectors" replace />} />
              <Route path="/settings" element={<Navigate to="/settings/connectors" replace />} />
              <Route path="/sources" element={<Navigate to="/settings/connectors" replace />} />
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </Suspense>
      </AppShell>

      <Suspense fallback={null}>
        <AnimatePresence>
          {drawerId && (
            <PersonDrawer
              id={drawerId}
              onClose={() => setDrawerId(null)}
              onChanged={refresh}
              notify={notify}
            />
          )}
        </AnimatePresence>
      </Suspense>
      <Suspense fallback={null}>
        <AnimatePresence>
          {commandOpen && (
            <CommandPalette
              people={overview.people || []}
              onClose={() => setCommandOpen(false)}
              onAction={runCommandAction}
            />
          )}
        </AnimatePresence>
      </Suspense>
      <Suspense fallback={null}>
        <AnimatePresence>
          {dialog === "capture" && (
            <CaptureDialog
              people={overview.people || []}
              onClose={() => setDialog(null)}
              onSaved={() => {
                setDialog(null);
                void refresh();
                notify("success", "Saved to the person");
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {dialog === "import" && (
            <ImportDialog
              onClose={() => setDialog(null)}
              onImported={() => void refresh()}
            />
          )}
        </AnimatePresence>
      </Suspense>
      <AnimatePresence>{toast && <ToastMessage toast={toast} />}</AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <NettApp />
    </BrowserRouter>
  );
}
