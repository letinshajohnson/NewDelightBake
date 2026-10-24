import { NavLink, Outlet, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { LayoutDashboard, Package, Boxes, BadgePercent, Users, Receipt, Wallet, BarChart3, Settings, MonitorSmartphone, ChefHat, LogOut, Menu, X, Truck, Contact, Landmark, Scale, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, isManager } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { ThemeToggle, LangSelect, Pill } from "@/components/common";

const NAV = [
  ["dashboard", "Dashboard", LayoutDashboard, true], ["catalog", "Catalog", Package, true], ["purchasing", "Purchasing", Truck, true],
  ["sales", "Sales", Receipt, false], ["crm", "CRM", Contact, false], ["finance", "Finance", Landmark, true], ["payables", "Payables & receivables", Scale, true],
  ["stock", "Stock manager", Boxes, true], ["promotions", "Promotions", BadgePercent, true], ["shifts", "Shifts", Wallet, false],
  ["reports", "Reports", BarChart3, true], ["settings", "Settings", Settings, true], ["users", "Users", UserCog, true],
];

function SideNav({ onNav }) {
  const { user, business, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const sub = business?.subscription;
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-6 border-b">
        <div className="font-display text-2xl font-bold tracking-tight">POS<span className="text-primary">Hub</span></div>
        <div className="text-xs text-muted-foreground mt-1 truncate" data-testid="sidebar-business-name">{business?.name}</div>
        {sub && <div className="mt-2"><Pill tone={sub.status === "active" ? "ok" : "warn"} testid="subscription-status">{sub.plan} · {sub.status}</Pill></div>}
      </div>
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV.filter(([, , , m]) => !m || isManager(user)).map(([k, label, Icon]) => (
          <NavLink key={k} to={`/app/${k}`} onClick={onNav} data-testid={`nav-${k}`}
            className={({ isActive }) => `flex items-center gap-3 px-6 py-2.5 text-sm border-s-2 transition-colors ${isActive ? "border-primary bg-accent text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}>
            <Icon className="w-4 h-4" />{["dashboard", "sales", "reports", "settings", "promotions"].includes(k) ? t(k) : label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t space-y-2">
        <Link to="/pos" data-testid="nav-open-pos"><Button className="w-full justify-start"><MonitorSmartphone className="w-4 h-4 me-2" />{t("cashier")}</Button></Link>
        {business?.restaurant_mode && <Link to="/kitchen" data-testid="nav-open-kitchen"><Button variant="outline" className="w-full justify-start mt-2"><ChefHat className="w-4 h-4 me-2" />{t("kitchen")}</Button></Link>}
        <div className="flex items-center gap-2 pt-2">
          <LangSelect compact /><ThemeToggle />
          <Button variant="ghost" size="icon" onClick={async () => { await logout(); nav("/login"); }} data-testid="logout-btn" aria-label="Sign out"><LogOut className="w-4 h-4 rtl-flip" /></Button>
        </div>
        <div className="text-xs text-muted-foreground truncate" data-testid="current-user">{user?.name} · {user?.role}</div>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen flex">
      <aside className="hidden lg:block w-64 shrink-0 border-e bg-card sticky top-0 h-screen"><SideNav /></aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-card border-e"><SideNav onNav={() => setOpen(false)} /></aside>
        </div>
      )}
      <main className="flex-1 min-w-0">
        <div className="lg:hidden flex items-center justify-between px-4 h-14 border-b bg-card sticky top-0 z-40">
          <Button variant="ghost" size="icon" onClick={() => setOpen(!open)} data-testid="mobile-menu-btn">{open ? <X /> : <Menu />}</Button>
          <div className="font-display font-bold">POS<span className="text-primary">Hub</span></div>
          <ThemeToggle />
        </div>
        <div className="px-4 sm:px-8 lg:px-12 py-8 max-w-[1500px]"><Outlet /></div>
      </main>
    </div>
  );
}
