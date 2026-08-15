import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AskNett } from "@/components/AskNett";
import "@/styles/dashboard.css";

export function DashboardPage({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const location = useLocation();

  useEffect(() => {
    if (location.hash && location.hash !== "#ask") return;
    const field = document.getElementById("ask-nett-query");
    field?.focus();
  }, [location.hash]);

  return (
    <div className="ask-home">
      <AskNett onOpen={onOpen} />
    </div>
  );
}
