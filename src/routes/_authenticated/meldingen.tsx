import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { listReports, updateReportStatus, type ReportRow } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/meldingen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Meldingen beheren — Admin" },
      { name: "description", content: "Bekijk en behandel meldingen van gebruikers over Superchargers, inclusief foto's en statussen." },
    ],
  }),
  component: MeldingenPage,
  errorComponent: MeldingenError,
  notFoundComponent: MeldingenNotFound,
});

function MeldingenError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Er ging iets mis</h1>
      <p className="mt-2 text-slate-400">{error.message}</p>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  );
}

function MeldingenNotFound() {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Niet gevonden</h1>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  );
}

const STATUS_FILTERS = [
  { key: "all", label: "Alle" },
  { key: "new", label: "Nieuw" },
  { key: "seen", label: "Gezien" },
  { key: "in_progress", label: "In behandeling" },
  { key: "resolved", label: "Opgelost" },
] as const;

const STATUS_OPTIONS = ["new", "seen", "in_progress", "resolved"] as const;
const statusLabels: Record<string, string> = { new: "Nieuw", seen: "Gezien", in_progress: "In behandeling", resolved: "Opgelost" };

function ReportPhotos({ photos }: { photos: string[] | null }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!photos || photos.length === 0) {
      setUrls([]);
      return;
    }
    (async () => {
      const results: string[] = [];
      for (const path of photos) {
        try {
          const { data, error } = await supabase.storage.from("charger-media").createSignedUrl(path, 3600);
          if (!error && data?.signedUrl) results.push(data.signedUrl);
        } catch {
          // ignore failures
        }
      }
      if (!cancelled) setUrls(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  if (!photos || photos.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-2">
      {urls.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={`Foto ${i + 1}`} className="w-20 h-20 object-cover rounded border border-slate-700" />
        </a>
      ))}
    </div>
  );
}

function ReportCard({ report, onSaved }: { report: ReportRow; onSaved: () => void }) {
  const updateStatusFn = useServerFn(updateReportStatus);
  const [status, setStatus] = useState(report.status);
  const [note, setNote] = useState(report.admin_note || "");

  const mutation = useMutation({
    mutationFn: () =>
      updateStatusFn({ data: { id: report.id, status: status as (typeof STATUS_OPTIONS)[number], adminNote: note || null } }),
    onSuccess: () => {
      toast.success("Melding bijgewerkt");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold">{report.charger_name || "Onbekende lader"}</div>
          <div className="text-xs text-slate-400">
            {report.category} · {new Date(report.created_at).toLocaleString("nl-NL")}
          </div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-slate-700">{statusLabels[report.status] || report.status}</span>
      </div>
      <p className="text-sm text-slate-200">{report.message}</p>
      {report.contact_email && <p className="text-xs text-slate-400">Contact: {report.contact_email}</p>}
      <ReportPhotos photos={report.photos} />

      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-start pt-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-md px-2 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{statusLabels[s]}</option>
          ))}
        </select>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Interne notitie…"
          className="bg-slate-900 border-slate-700"
          rows={2}
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          Opslaan
        </Button>
      </div>
    </div>
  );
}

function MeldingenPage() {
  const qc = useQueryClient();
  const listReportsFn = useServerFn(listReports);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]["key"]>("all");

  const reportsQuery = useQuery({ queryKey: ["admin", "reports"], queryFn: () => listReportsFn() });
  const reports = reportsQuery.data || [];

  const filtered = useMemo(() => {
    if (filter === "all") return reports;
    return reports.filter((r) => r.status === filter);
  }, [reports, filter]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "reports"] });

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Link to="/admin" className="text-sm text-slate-400 hover:text-white">← Terug naar admin</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Meldingen</h1>
          <p className="text-sm text-slate-400">{reports.length} meldingen totaal</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                filter === f.key ? "bg-blue-600 border-blue-600" : "bg-slate-800 border-slate-700 text-slate-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {reportsQuery.isLoading ? (
          <div>Laden…</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((report) => (
              <ReportCard key={report.id} report={report} onSaved={refresh} />
            ))}
            {filtered.length === 0 && <p className="text-slate-400">Geen meldingen gevonden.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
