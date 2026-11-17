import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { listMyReports, listMyNotifications, markMyNotificationRead } from "@/lib/account.functions";
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
  errorComponent: ({ error }: { error: any }) => (
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

type PersonalNotification = { id: string; title: string; body: string; event_type: string; delivery_status: string; created_at: string; };

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
  const [notifications, setNotifications] = useState<PersonalNotification[]>([]);

  const load = useCallback(async () => {
    try {
      const [data, inbox] = await Promise.all([listMyReports(), listMyNotifications()]);
      setReports(data as MyReport[]);
      setNotifications(inbox as PersonalNotification[]);
    } catch (error) {
      console.error("Meldingen laden mislukt:", error);
      setReports([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:text-white">← Terug naar kaart</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Mijn meldingen</h1>
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Persoonlijke meldingen</h2>
          {notifications.length === 0 ? <p className="text-sm text-slate-400">Er zijn nog geen persoonlijke meldingen.</p> : notifications.map((n) => (
            <div key={n.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-medium">{n.title}</div><p className="mt-1 text-sm text-slate-300">{n.body}</p><div className="mt-1 text-xs text-slate-500">{new Date(n.created_at).toLocaleString("nl-NL")}</div></div>
                {n.delivery_status !== "read" && <button className="shrink-0 text-xs text-blue-300 hover:text-white" onClick={async () => { try { await markMyNotificationRead({ data: { id: n.id } }); setNotifications(old => old.map(x => x.id === n.id ? { ...x, delivery_status: "read" } : x)); } catch { /* keep inbox visible */ } }}>Gelezen</button>}
              </div>
            </div>
          ))}
        </section>
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
