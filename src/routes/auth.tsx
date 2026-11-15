import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser, signIn, signUp } from "@/lib/auth.functions";
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

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let active = true;
    void getCurrentUser().then((user) => {
      if (active && user) void navigate({ to: "/" });
    }).catch(() => {
      if (active) setAuthError("De Cloudflare-inlogserver is nog niet beschikbaar. Probeer het later opnieuw.");
    });
    return () => { active = false; };
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setAuthError("");
    try {
      if (mode === "login") {
        await signIn({ data: { email: email.trim(), password } });
        toast.success("Ingelogd");
        await navigate({ to: "/" });
      } else {
        await signUp({ data: { email: email.trim(), password } });
        toast.success("Account aangemaakt en ingelogd");
        await navigate({ to: "/" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Inloggen is mislukt.";
      setAuthError(message);
      toast.error(message);
    } finally {
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
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-slate-700 border-slate-600" />
          </div>
          <div>
            <Label htmlFor="password">Wachtwoord</Label>
            <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 10} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-slate-700 border-slate-600" />
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-red-600 hover:bg-red-700">
            {busy ? "Bezig…" : mode === "login" ? "Inloggen" : "Account aanmaken"}
          </Button>
          {mode === "register" && <p className="text-xs text-slate-400">Gebruik minimaal 10 tekens voor je wachtwoord.</p>}
        </form>
        {authError && (
          <div role="alert" className="mt-4 rounded-lg border border-red-500/50 bg-red-950/50 p-3 text-sm text-red-200 break-words">
            <strong>Inloggen mislukt</strong>
            <p className="mt-1">{authError}</p>
          </div>
        )}
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
