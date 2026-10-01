import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Trash2, Route as RouteIcon, Share2, Car } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/mijn-routes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Mijn routes" }] }),
  component: MyRoutesPage,
});

type SavedRoute = {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
  model_name: string;
  route_type: string;
  total_distance_km: number | null;
  total_time_min: number | null;
  created_at: string;
};

function MyRoutesPage() {
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("saved_routes")
      .select("id,name,start_address,end_address,model_name,route_type,total_distance_km,total_time_min,created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRoutes((data as SavedRoute[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const share = async (id: string) => {
    try {
      const { data: row } = await supabase.from("saved_routes").select("share_token").eq("id", id).maybeSingle();
      let token = row?.share_token as string | null | undefined;
      if (!token) token = crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabase.from("saved_routes").update({ share_token: token, shared: true }).eq("id", id);
      if (error) throw error;
      const link = `${window.location.origin}/gedeeld/${token}`;
      if (navigator.share) await navigator.share({ title: "TeslaNavigation route", url: link }).catch(() => {});
      else { await navigator.clipboard.writeText(link); toast.success("Link gekopieerd"); }
    } catch (e) {
      toast.error("Delen mislukt: " + (e as Error).message);
    }
  };

  const sendToTesla = async (id: string) => {
    try {
      const { data: r } = await supabase.from("saved_routes").select("end_lat,end_lng,end_address").eq("id", id).maybeSingle();
      if (!r) throw new Error("Route niet gevonden");
      // Geen officiële directe koppeling: deel de bestemming met de Tesla-app via het deelmenu.
      const url = `https://www.google.com/maps/dir/?api=1&destination=${r.end_lat},${r.end_lng}`;
      if (navigator.share) {
        await navigator.share({ title: r.end_address ?? "Bestemming", text: r.end_address ?? "", url }).catch(() => {});
        toast.message("Kies de Tesla-app in het deelmenu om de bestemming naar je auto te sturen.");
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Bestemmingslink gekopieerd. Open hem op je telefoon en deel met de Tesla-app.");
      }
    } catch (e) {
      toast.error("Versturen mislukt: " + (e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Route verwijderen?")) return;
    const { error } = await supabase.from("saved_routes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRoutes((r) => r.filter((x) => x.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <Link to="/" className="text-sm text-slate-400 hover:text-white">← Terug naar kaart</Link>
        <h1 className="text-2xl md:text-3xl font-bold mt-1 mb-6">Mijn opgeslagen routes</h1>
        {loading ? <div>Laden…</div> : routes.length === 0 ? (
          <div className="text-slate-400">Nog geen opgeslagen routes. Bereken een route en klik op "Route opslaan".</div>
        ) : (
          <div className="space-y-3">
            {routes.map((r) => (
              <div key={r.id} className="bg-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-sm text-slate-400 truncate">{r.start_address || "?"} → {r.end_address || "?"}</div>
                  <div className="text-xs text-slate-500 mt-1">{r.model_name} · {r.route_type} · {r.total_distance_km ?? "?"} km · {r.total_time_min ?? "?"} min</div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button size="sm" onClick={() => navigate({ to: "/", search: { load: r.id } as never })} className="bg-red-600 hover:bg-red-700"><RouteIcon className="w-4 h-4 mr-1" /> Openen</Button>
                  <Button size="sm" variant="outline" className="border-slate-600" onClick={() => share(r.id)}><Share2 className="w-4 h-4 mr-1" /> Delen</Button>
                  <Button size="sm" variant="outline" className="border-slate-600" onClick={() => sendToTesla(r.id)}><Car className="w-4 h-4 mr-1" /> Stuur naar Tesla</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
