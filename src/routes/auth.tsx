import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Inloggen — Tesla Routeplanner" },
      { name: "description", content: "Log in of maak een account om je routes op te slaan." },
    ],
  }),
  component: AuthPage,
});

function describeAuthError(err: unknown): string {
  if (err && typeof err === "object") {
    const value = err as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
    const message = typeof value.message === "string" ? value.message : "Onbekende fout";
    const code = typeof value.code === "string" ? value.code : null;
    const status = typeof value.status === "number" ? value.status : null;
    return [message, code ? `Code: ${code}` : null, status ? `HTTP: ${status}` : null].filter(Boolean).join(" · ");
  }
  return typeof err === "string" ? err : "Onbekende fout bij het verbinden met de inlogserver.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (active && data.user) await navigate({ to: "/" });
      } catch (err) {
        if (active) setAuthError(`Verbindingscontrole mislukt: ${describeAuthError(err)}`);
      }
    })();
    return () => { active = false; };
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setAuthError("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        toast.success("Ingelogd");
        await navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account aangemaakt — check je mail voor verificatie");
      }
    } catch (err) {
      const message = describeAuthError(err);
      setAuthError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setBusy(true);
    setAuthError("");
    try {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) throw result.error;
      if (result.redirected) return;
      toast.success("Ingelogd met Google");
      await navigate({ to: "/" });
    } catch (err) {
      const message = describeAuthError(err);
      setAuthError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{mode === "login" ? "Inloggen" : "Registreren"}</h1>
          <Link to="/" className="text-sm text-slate-400 hover:text-white">← Terug</Link>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-slate-700 border-slate-600" />
          </div>
          <div>
            <Label htmlFor="password">Wachtwoord</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-slate-700 border-slate-600" />
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-red-600 hover:bg-red-700">
            {mode === "login" ? "Inloggen" : "Account aanmaken"}
          </Button>
        </form>
        {authError && (
          <div role="alert" className="mt-4 rounded-lg border border-red-500/50 bg-red-950/50 p-3 text-sm text-red-200 break-words">
            <strong>Inloggen mislukt</strong>
            <p className="mt-1">{authError}</p>
            <p className="mt-2 text-xs text-red-200/80">Deze foutmelding bevat geen wachtwoord of toegangstoken. Stuur de volledige melding door om de oorzaak gericht te kunnen oplossen.</p>
          </div>
        )}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-600" /></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-800 px-2 text-slate-400">of</span></div>
        </div>
        <Button type="button" variant="outline" onClick={onGoogle} disabled={busy} className="w-full bg-white text-slate-900 hover:bg-slate-100 border-white">
          Verder met Google
        </Button>
        <p className="text-center mt-6 text-sm text-slate-400">
          {mode === "login" ? "Nog geen account?" : "Al een account?"}{" "}
          <button type="button" className="text-red-400 hover:text-red-300" onClick={() => { setAuthError(""); setMode(mode === "login" ? "register" : "login"); }}>
            {mode === "login" ? "Registreren" : "Inloggen"}
          </button>
        </p>
      </div>
    </div>
  );
}
