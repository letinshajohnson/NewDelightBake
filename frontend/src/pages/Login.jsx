import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WifiOff, Calculator, ChefHat, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errMsg } from "@/lib/api";
import { useAuth, homeFor } from "@/context/AuthContext";
import { useI18n } from "@/lib/i18n";
import { Field, ThemeToggle, LangSelect } from "@/components/common";

const FEATURES = [[WifiOff, "Keeps selling offline", "Sales queue on the device and sync themselves — never twice."],
  [Calculator, "One total everywhere", "Discount → tax → fees → rounding, same on till and server."],
  [ChefHat, "Shops and restaurants", "Barcode counter, tables and a live kitchen display."],
  [ShieldCheck, "Profit you can trust", "Stock ledger + moving-average cost snapshotted per sale."]];

function GoogleBtn() {
  const go = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/app/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };
  return (
    <Button type="button" variant="outline" className="w-full h-12" onClick={go} data-testid="google-login-btn">
      <svg className="w-4 h-4 me-2" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Continue with Google
    </Button>
  );
}

export default function Login() {
  const { user, reload } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "", name: "", business_name: "", currency: "INR" });
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user)} replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = (path) => async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(path, f);
      const d = await reload();
      nav(homeFor(d?.user));
    } catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-black text-white">
        <img src="/img/hero.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 grain" />
        <div className="relative font-display text-3xl font-bold">POS<span className="text-[#0A84FF]">Hub</span></div>
        <div className="relative max-w-lg">
          <h1 className="font-display text-5xl font-semibold tracking-tight leading-[1.05]">The till that holds up in a real shop.</h1>
          <div className="grid grid-cols-2 gap-px bg-white/10 mt-10 border border-white/10">
            {FEATURES.map(([I, h, d]) => (
              <div key={h} className="bg-black/70 backdrop-blur-xl p-5">
                <I className="w-5 h-5 text-[#0A84FF]" />
                <div className="font-medium mt-3">{h}</div>
                <div className="text-sm text-white/60 mt-1">{d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-white/50">Retail · Restaurants · Multi-branch · 7 languages</div>
      </div>
      <div className="flex flex-col p-6 sm:p-12">
        <div className="flex justify-between items-center">
          <div className="font-display text-2xl font-bold lg:invisible">POS<span className="text-primary">Hub</span></div>
          <div className="flex gap-2"><LangSelect compact /><ThemeToggle /></div>
        </div>
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-md fade-up">
            <Tabs defaultValue="login">
              <TabsList className="mb-8">
                <TabsTrigger value="login" data-testid="tab-login">{t("sign_in")}</TabsTrigger>
                <TabsTrigger value="register" data-testid="tab-register">Start a business</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <h2 className="font-display text-3xl font-semibold tracking-tight mb-6">Welcome back</h2>
                <form onSubmit={submit("/auth/login")} className="space-y-4">
                  <Field label={t("email")}><Input type="email" required value={f.email} onChange={set("email")} className="h-12" data-testid="login-email-input" /></Field>
                  <Field label={t("password")}><Input type="password" required value={f.password} onChange={set("password")} className="h-12" data-testid="login-password-input" /></Field>
                  <Button type="submit" className="w-full h-12 active:scale-[0.98]" disabled={busy} data-testid="login-submit-btn">{busy ? "…" : t("sign_in")}</Button>
                </form>
              </TabsContent>
              <TabsContent value="register">
                <h2 className="font-display text-3xl font-semibold tracking-tight mb-6">Open your shop</h2>
                <form onSubmit={submit("/auth/register")} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Your name"><Input required value={f.name} onChange={set("name")} data-testid="register-name-input" /></Field>
                    <Field label="Currency">
                      <Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })}>
                        <SelectTrigger data-testid="register-currency-select"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="INR">₹ Indian Rupee</SelectItem><SelectItem value="USD">$ US Dollar</SelectItem></SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Business name"><Input required value={f.business_name} onChange={set("business_name")} data-testid="register-business-input" /></Field>
                  <Field label={t("email")}><Input type="email" required value={f.email} onChange={set("email")} data-testid="register-email-input" /></Field>
                  <Field label={t("password")}><Input type="password" required minLength={6} value={f.password} onChange={set("password")} data-testid="register-password-input" /></Field>
                  <Button type="submit" className="w-full h-12" disabled={busy} data-testid="register-submit-btn">Create business</Button>
                </form>
              </TabsContent>
            </Tabs>
            <div className="flex items-center gap-3 my-6 text-xs text-muted-foreground"><div className="h-px bg-border flex-1" />or<div className="h-px bg-border flex-1" /></div>
            <GoogleBtn />
            <p className="text-xs text-muted-foreground mt-6">Staff on a shared till can switch in with their PIN from the cashier screen.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
