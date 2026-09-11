import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/gebruikers")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Gebruikers beheren — TeslaNavigation" },
      { name: "description", content: "Bekijk alle gebruikers van TeslaNavigation, hun rol, activiteit en aantal opgeslagen routes." },
    ],
  }),
  component: UsersPage,
});

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  blocked: boolean;
  last_active_at: string | null;
  route_count: number;
  created_at: string;
};

function UsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,blocked,last_active_at,route_count,created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setProfiles((data as Profile[] | null) ?? []);
    const { data: roleRows } = await supabase.from("user_roles").select("user_id,role");
    const map: Record<string, string[]> = {};
    for (const row of (roleRows as { user_id: string; role: string }[] | null) ?? []) {
      map[row.user_id] = [...(map[row.user_id] ?? []), row.role];
    }
    setRoles(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBlocked = async (profile: Profile) => {
    const { error } = await supabase.from("profiles").update({ blocked: !profile.blocked }).eq("id", profile.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(profile.blocked ? "Gebruiker gedeblokkeerd" : "Gebruiker geblokkeerd");
    load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => (p.email ?? "").toLowerCase().includes(q) || (p.display_name ?? "").toLowerCase().includes(q));
  }, [profiles, search]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <Link to="/admin" className="text-sm text-slate-400 hover:text-white">← Terug naar beheer</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Gebruikers</h1>
          <p className="text-sm text-slate-400">{profiles.length} gebruikers</p>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoek op e-mail of naam…"
          className="bg-slate-800 border-slate-700"
        />
        {loading ? (
          <div>Laden…</div>
        ) : (
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 sticky top-0">
                  <tr className="text-left">
                    <th className="p-3">E-mail</th>
                    <th className="p-3">Naam</th>
                    <th className="p-3">Rol</th>
                    <th className="p-3">Routes</th>
                    <th className="p-3">Laatst actief</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                      <td className="p-3">{p.email ?? "—"}</td>
                      <td className="p-3">{p.display_name ?? "—"}</td>
                      <td className="p-3">{(roles[p.id] ?? ["user"]).join(", ")}</td>
                      <td className="p-3">{p.route_count}</td>
                      <td className="p-3 text-slate-300">
                        {p.last_active_at ? new Date(p.last_active_at).toLocaleString("nl-NL") : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="outline" className="border-slate-700" onClick={() => toggleBlocked(p)}>
                          {p.blocked ? "Deblokkeren" : "Blokkeren"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td className="p-4 text-slate-400" colSpan={6}>
                        Geen gebruikers gevonden.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
