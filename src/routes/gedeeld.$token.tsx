import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getSharedRoute } from "@/lib/share.functions";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation } from "lucide-react";

const sharedRouteQuery = (token: string) =>
  queryOptions({
    queryKey: ["shared-route", token],
    queryFn: () => getSharedRoute({ data: { token } }),
  });

export const Route = createFileRoute("/gedeeld/$token")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(sharedRouteQuery(params.token)),
  head: () => ({
    meta: [
      { title: "Gedeelde route — TeslaNavigation" },
      { name: "description", content: "Bekijk een gedeelde laadroute met voertuig, laadstops en instellingen." },
      { property: "og:title", content: "Gedeelde route — TeslaNavigation" },
      { property: "og:description", content: "Bekijk een gedeelde laadroute met voertuig, laadstops en instellingen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SharedRoutePage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Er ging iets mis</h1>
      <p className="mt-2 text-slate-400">{error.message}</p>
      <Link to="/" className="text-red-400 mt-4 inline-block">← Naar TeslaNavigation</Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Route niet gevonden</h1>
      <Link to="/" className="text-red-400 mt-4 inline-block">← Naar TeslaNavigation</Link>
    </div>
  ),
});

function SharedRoutePage() {
  const { token } = Route.useParams();
  const { data } = useSuspenseQuery(sharedRouteQuery(token));

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-8">
        <h1 className="text-2xl font-bold">Deze route is niet (meer) gedeeld</h1>
        <Link to="/" className="text-red-400 mt-4 inline-block">← Naar TeslaNavigation</Link>
      </div>
    );
  }

  const stops = Array.isArray((data.payload as { stops?: unknown[] }).stops)
    ? ((data.payload as { stops: Record<string, unknown>[] }).stops)
    : [];

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${data.startLat},${data.startLng}&destination=${data.endLat},${data.endLng}&travelmode=driving`;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <Link to="/" className="text-sm text-slate-400 hover:text-white">← Naar TeslaNavigation</Link>
        <h1 className="text-2xl md:text-3xl font-bold">{data.name}</h1>
        <p className="text-slate-300">
          {data.startAddress || "Start"} → {data.endAddress || "Bestemming"}
        </p>
        <div className="text-sm text-slate-400">
          {data.modelName} · start {data.batteryPercent}% · {data.totalDistanceKm ?? "?"} km · {data.totalTimeMin ?? "?"} min
        </div>

        {stops.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Laadstops</h2>
            {stops.map((stop, i) => (
              <div key={i} className="rounded-lg border border-slate-700 bg-slate-800 p-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-sm">{String((stop as { name?: string }).name ?? `Laadstop ${i + 1}`)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <a href={mapsUrl} target="_blank" rel="noreferrer">
            <Button className="bg-red-600 hover:bg-red-700">
              <Navigation className="w-4 h-4 mr-1" /> Open in navigatie
            </Button>
          </a>
          <Link to="/">
            <Button variant="outline" className="border-slate-700">Zelf een route plannen</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
