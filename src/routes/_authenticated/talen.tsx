import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/talen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Talen beheren — TeslaNavigation" },
      { name: "description", content: "Activeer talen en pas vertalingen aan voor TeslaNavigation." },
    ],
  }),
  component: LanguagesPage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Er ging iets mis</h1>
      <p className="mt-2 text-slate-400">{error.message}</p>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Niet gevonden</h1>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  ),
});

type Language = { code: string; name: string; native_name: string; enabled: boolean; is_default: boolean; rtl: boolean; sort_order: number };
type Translation = { id: string; lang_code: string; key: string; value: string };

function LanguagesPage() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selected, setSelected] = useState<string>("nl");
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [search, setSearch] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [loading, setLoading] = useState(true);

  const loadLanguages = useCallback(async () => {
    const { data, error } = await supabase
      .from("languages")
      .select("code,name,native_name,enabled,is_default,rtl,sort_order")
      .order("sort_order")
      .order("name");
    if (error) toast.error(error.message);
    else setLanguages((data as Language[]) || []);
    setLoading(false);
  }, []);

  const loadTranslations = useCallback(async (code: string) => {
    const { data, error } = await supabase
      .from("translations")
      .select("id,lang_code,key,value")
      .eq("lang_code", code)
      .order("key");
    if (error) toast.error(error.message);
    else setTranslations((data as Translation[]) || []);
  }, []);

  useEffect(() => { loadLanguages(); }, [loadLanguages]);
  useEffect(() => { loadTranslations(selected); }, [selected, loadTranslations]);

  const toggleEnabled = async (lang: Language) => {
    const { error } = await supabase.from("languages").update({ enabled: !lang.enabled }).eq("code", lang.code);
    if (error) { toast.error(error.message); return; }
    setLanguages((list) => list.map((l) => (l.code === lang.code ? { ...l, enabled: !l.enabled } : l)));
  };

  const saveTranslation = async (row: Translation, value: string) => {
    const { error } = await supabase.from("translations").update({ value }).eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Vertaling opgeslagen");
  };

  const addTranslation = async () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;
    const { error } = await supabase.from("translations").insert({ lang_code: selected, key, value });
    if (error) { toast.error(error.message); return; }
    setNewKey("");
    setNewValue("");
    loadTranslations(selected);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return translations;
    return translations.filter((t) => t.key.toLowerCase().includes(q) || t.value.toLowerCase().includes(q));
  }, [translations, search]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <Link to="/admin" className="text-sm text-slate-400 hover:text-white">← Terug naar admin</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Talen &amp; vertalingen</h1>
          <p className="text-sm text-slate-400">Nederlands is de hoofdtaal. Zet talen aan of uit en pas teksten aan.</p>
        </div>

        {loading ? (
          <div>Laden…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {languages.map((lang) => (
                <div
                  key={lang.code}
                  className={`rounded-lg border p-3 flex items-center justify-between gap-2 ${
                    selected === lang.code ? "border-blue-500 bg-slate-800" : "border-slate-700 bg-slate-800/60"
                  }`}
                >
                  <button className="text-left min-w-0" onClick={() => setSelected(lang.code)}>
                    <div className="font-medium truncate">
                      {lang.native_name} <span className="text-xs text-slate-400">({lang.code})</span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {lang.name}
                      {lang.is_default ? " · hoofdtaal" : ""}
                      {lang.rtl ? " · RTL" : ""}
                    </div>
                  </button>
                  <label className="flex items-center gap-1 text-xs text-slate-300 shrink-0">
                    <Checkbox checked={lang.enabled} onCheckedChange={() => toggleEnabled(lang)} disabled={lang.is_default} />
                    Aan
                  </label>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">Vertalingen — {selected}</h2>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek op sleutel of tekst…"
                  className="max-w-xs bg-slate-800 border-slate-700"
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="nieuwe sleutel" className="max-w-[220px] bg-slate-800 border-slate-700" />
                <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="tekst" className="max-w-sm bg-slate-800 border-slate-700" />
                <Button size="sm" onClick={addTranslation} className="bg-blue-600 hover:bg-blue-700">Toevoegen</Button>
              </div>

              {filtered.length === 0 ? (
                <p className="text-slate-400 text-sm">Nog geen vertalingen voor deze taal.</p>
              ) : (
                <div className="space-y-2">
                  {filtered.map((row) => (
                    <TranslationRow key={row.id} row={row} onSave={saveTranslation} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TranslationRow({ row, onSave }: { row: Translation; onSave: (row: Translation, value: string) => void }) {
  const [value, setValue] = useState(row.value);
  useEffect(() => setValue(row.value), [row.value]);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr_auto] gap-2 items-center">
      <div className="text-xs text-slate-400 truncate">{row.key}</div>
      <Input value={value} onChange={(e) => setValue(e.target.value)} className="bg-slate-800 border-slate-700" />
      <Button size="sm" variant="outline" className="border-slate-700" disabled={value === row.value} onClick={() => onSave(row, value)}>
        Opslaan
      </Button>
    </div>
  );
}
