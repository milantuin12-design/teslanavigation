import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, CirclePlus, History, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/recente-wijzigingen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recente Superchargerwijzigingen | TeslaNavigation" },
      { name: "description", content: "Bekijk recente wijzigingen aan gepubliceerde Superchargers op TeslaNavigation." },
      { property: "og:title", content: "Recente Superchargerwijzigingen | TeslaNavigation" },
      { property: "og:description", content: "Bekijk recente wijzigingen aan gepubliceerde Superchargers op TeslaNavigation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecentChanges,
});

type Change = {
  id: string;
  charger_id: string | null;
  charger_name: string;
  action: string;
  changed_fields: Record<string, unknown> | null;
  created_at: string;
};

const fields: Record<string, string> = {
  status: "status", is_available: "beschikbaarheid", occupied_stalls: "vrije laadplekken",
  total_stalls: "aantal laadplekken", charger_configs: "laadpunten", max_speed_kw: "laadsnelheid",
  opening_hours: "openingstijden", opening_time: "openingstijden", closing_time: "openingstijden",
  works: "werkzaamheden", construction: "bouwstatus", closure: "sluiting",
  planned_upgrade: "geplande uitbreiding", trailer_friendly: "aanhangervriendelijkheid",
  parking_fee: "parkeerkosten", in_parking_garage: "parkeergarage",
  name: "naam", lat: "locatie", lng: "locatie", city: "plaats", country: "land",
};

function description(change: Change) {
  if (change.action === "create") return "Nieuwe Supercharger toegevoegd";
  const labels = [...new Set(Object.keys(change.changed_fields ?? {}).map((key) => fields[key]).filter(Boolean))];
  return labels.length ? `${labels.slice(0, 3).join(", ")} bijgewerkt` : "Gegevens bijgewerkt";
}

function RecentChanges() {
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // Only display changes for chargers that are currently public. Draft names and
      // unpublished charger details never appear in the visitor-facing history.
      const { data: recent, error: changesError } = await supabase
        .from("charger_changes")
        .select("id,charger_id,charger_name,action,changed_fields,created_at")
        .order("created_at", { ascending: false })
        .limit(150);
      if (changesError) throw changesError;
      const ids = [...new Set((recent ?? []).map((row) => row.charger_id).filter((id): id is string => Boolean(id)))];
      if (!ids.length) { setChanges([]); return; }
      // The public read policy itself excludes drafts; do not use privileged access here.
      const { data: published, error: chargersError } = await supabase
        .from("superchargers").select("id").in("id", ids).eq("published", true);
      if (chargersError) throw chargersError;
      const visible = new Set((published ?? []).map((row) => row.id));
      setChanges((recent as Change[]).filter((row) => row.charger_id && visible.has(row.charger_id) && row.action !== "delete").slice(0, 30));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Terug naar de kaart
        </Link>
        <div className="mt-8 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><History className="size-4" /> Superchargers</div>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Recente wijzigingen</h1>
          </div>
          <Button variant="outline" size="icon" aria-label="Vernieuw wijzigingen" title="Vernieuw wijzigingen" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {loading ? <p className="mt-10 text-muted-foreground" role="status">Wijzigingen laden…</p> : error ? (
          <div className="mt-10 text-muted-foreground" role="alert">De wijzigingen konden niet geladen worden. Probeer het opnieuw.</div>
        ) : changes.length === 0 ? (
          <p className="mt-10 text-muted-foreground">Er zijn nog geen recente wijzigingen aan gepubliceerde Superchargers.</p>
        ) : (
          <ol className="mt-8 divide-y divide-border border-y border-border">
            {changes.map((change) => {
              const Icon = change.action === "create" ? CirclePlus : Wrench;
              return (
                <li key={change.id} className="flex gap-4 py-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground"><Icon className="size-4" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{change.charger_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{description(change)}</p>
                    <time dateTime={change.created_at} className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="size-3.5" aria-hidden="true" /> {new Date(change.created_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
  );
}