import "@/App.css";
import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { AuthProvider, useAuth, useTheme, homeFor, isManager } from "@/context/AuthContext";
import { I18nProvider } from "@/lib/i18n";
import { api, errMsg } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import Promotions from "@/pages/Promotions";
import Customers from "@/pages/Customers";
import Sales from "@/pages/Sales";
import Shifts from "@/pages/Shifts";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import POS from "@/pages/POS";
import Kitchen from "@/pages/Kitchen";

function AuthCallback() {
  const done = useRef(false);
  const nav = useNavigate();
  const { reload } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const sid = new URLSearchParams(location.hash.slice(1)).get("session_id");
    api.post("/auth/google/session", { session_id: sid })
      .then(async () => { const d = await reload(); window.history.replaceState(null, "", window.location.pathname); nav(homeFor(d?.user), { replace: true }); })
      .catch((e) => { toast.error(errMsg(e)); nav("/login", { replace: true }); });
  }, [location.hash, nav, reload]);
  return <div className="min-h-screen grid place-items-center text-muted-foreground" data-testid="auth-callback">Signing you in…</div>;
}

function Guard({ children, allow }) {
  const { user, checked } = useAuth();
  if (!checked || user === null) return <div className="min-h-screen grid place-items-center text-muted-foreground" data-testid="auth-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow(user)) return <Navigate to={homeFor(user)} replace />;
  return children;
}

const staffPanel = (u) => isManager(u) || u.role === "cashier";

function AppRouter() {
  const location = useLocation();
  useTheme();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pos" element={<Guard allow={(u) => u.role !== "kitchen"}><POS /></Guard>} />
      <Route path="/kitchen" element={<Guard><Kitchen /></Guard>} />
      <Route path="/app" element={<Guard allow={staffPanel}><AppShell /></Guard>}>
        <Route path="dashboard" element={<Guard allow={isManager}><Dashboard /></Guard>} />
        <Route path="products" element={<Guard allow={isManager}><Products /></Guard>} />
        <Route path="inventory" element={<Guard allow={isManager}><Inventory /></Guard>} />
        <Route path="promotions" element={<Guard allow={isManager}><Promotions /></Guard>} />
        <Route path="customers" element={<Customers />} />
        <Route path="sales" element={<Sales />} />
        <Route path="shifts" element={<Shifts />} />
        <Route path="reports" element={<Guard allow={isManager}><Reports /></Guard>} />
        <Route path="settings" element={<Guard allow={isManager}><Settings /></Guard>} />
      </Route>
      <Route path="*" element={<Guard><HomeRedirect /></Guard>} />
    </Routes>
  );
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user)} replace />;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
          <Toaster richColors position="top-center" />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
