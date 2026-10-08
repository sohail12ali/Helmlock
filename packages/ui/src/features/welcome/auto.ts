// The console opens /welcome by itself only when this machine has no author or no usable engine (GET /setup), and only
// once per browser session; otherwise the wizard is reachable from the Overview card and Settings.
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSetup } from "@/api/m5";
import { AUTO_KEY } from "./draft";

export function useAutoWelcome(): void {
  const q = useSetup();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const steps = q.data?.steps;
    if (!steps || pathname === "/welcome") return;
    if (!steps.some((s) => (s.id === "you" || s.id === "engine") && !s.done)) return;
    try {
      if (sessionStorage.getItem(AUTO_KEY)) return;
      sessionStorage.setItem(AUTO_KEY, "1");
    } catch {
      return; // without session storage it could loop: never open by itself then
    }
    navigate("/welcome");
  }, [q.data, pathname, navigate]);
}
