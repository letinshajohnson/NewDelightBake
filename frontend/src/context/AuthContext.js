import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, business: null, checked: false });

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setState({ user: data.user, business: data.business, checked: true });
      return data;
    } catch {
      setState({ user: false, business: null, checked: true });
      return null;
    }
  }, []);

  useEffect(() => {
    // Skip /me while the Google callback is exchanging its session_id.
    if (window.location.hash?.includes("session_id=")) {
      setState((s) => ({ ...s, checked: true, user: false }));
      return;
    }
    reload();
    const onUnauth = () => setState({ user: false, business: null, checked: true });
    window.addEventListener("poshub:unauth", onUnauth);
    return () => window.removeEventListener("poshub:unauth", onUnauth);
  }, [reload]);

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    setState({ user: false, business: null, checked: true });
  };

  return <AuthCtx.Provider value={{ ...state, reload, logout, setBusiness: (b) => setState((s) => ({ ...s, business: b })) }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function useTheme() {
  const [theme, setTheme] = useState(localStorage.getItem("poshub.theme") || "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("poshub.theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export const isManager = (u) => u && ["owner", "manager"].includes(u.role);
export const homeFor = (u) => (u?.role === "kitchen" ? "/kitchen" : ["cashier", "waiter"].includes(u?.role) ? "/pos" : "/app/dashboard");
