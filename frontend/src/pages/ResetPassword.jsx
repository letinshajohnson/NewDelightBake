import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errMsg } from "@/lib/api";
import { Field } from "@/components/common";

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const save = async () => {
    try { await api.post("/auth/reset", { token: sp.get("token"), password: pw }); toast.success("Password changed — sign in with the new one"); nav("/login"); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 fade-up" data-testid="reset-password-page">
        <h1 className="font-display text-3xl font-semibold">Choose a new password</h1>
        <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-password-input" /></Field>
        <Field label="Repeat password"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="reset-password-repeat" /></Field>
        <Button className="w-full" disabled={pw.length < 6 || pw !== pw2} onClick={save} data-testid="reset-password-submit">Save password</Button>
      </div>
    </div>
  );
}
