import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportChat } from "@/components/ReportChat";

export const Route = createFileRoute("/_authenticated/mijn-meldingen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mijn meldingen — TeslaNavigation" },
      { name: "description", content: "Volg je meldingen over Superchargers en chat met het beheer." },
    ],
  }),
  component: MyReportsPage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Er ging iets mis</h1>
      <p className="mt-2 text-slate-400">{error.message}</p>
      <Link to="/" className="text-red-400 mt-4 inline-block">← Terug naar de kaart</Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Niet gevonden</h1>
      <Link to="/" className="text-red-400 mt-4 inline-block">← Terug naar de kaart</Link>
    </div>
  ),
});

type MyReport = {
  id: string;
  charger_name: string | null;
  category: string;
  message: string;
  status: string;
  admin_note: string | null;
  created_at: string;
};

const statusLabels: Record<string, string> = { new: "Nieuw", seen: "Gezien", in_progress: "In behandeling", resolved: "Opgelost" };

function MyReportsPage() {
  const [reports, setReports] = useState<MyReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase
      .from("charger_reports")
      .select("id,charger_name,category,message,status,admin_note,created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });
    setReports((data as MyReport[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:text-white">← Terug naar kaart</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Mijn meldingen</h1>
        </div>
        {loading ? (
          <div>Laden…</div>
        ) : reports.length === 0 ? (
          <p className="text-slate-400">Je hebt nog geen meldingen gedaan.</p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-2">
                <div className="flex justify-between gap-2 flex-wrap">
                  <div className="font-semibold">{r.charger_name || "Onbekende lader"}</div>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700">{statusLabels[r.status] || r.status}</span>
                </div>
                <div className="text-xs text-slate-400">{r.category} · {new Date(r.created_at).toLocaleString("nl-NL")}</div>
                <p className="text-sm text-slate-200">{r.message}</p>
                <ReportChat reportId={r.id} asAdmin={false} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
