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

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Ingelogd");
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account aangemaakt — check je mail voor verificatie");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error(result.error instanceof Error ? result.error.message : "Google login mislukt");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    toast.success("Ingelogd met Google");
    navigate({ to: "/" });
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
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-600" /></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-800 px-2 text-slate-400">of</span></div>
        </div>
        <Button type="button" variant="outline" onClick={onGoogle} disabled={busy} className="w-full bg-white text-slate-900 hover:bg-slate-100 border-white">
          Verder met Google
        </Button>
        <p className="text-center mt-6 text-sm text-slate-400">
          {mode === "login" ? "Nog geen account?" : "Al een account?"}{" "}
          <button className="text-red-400 hover:text-red-300" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Registreren" : "Inloggen"}
          </button>
        </p>
      </div>
    </div>
  );
}
