import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, ExternalLink } from "lucide-react";
import {
  listOwners,
  upsertOwner,
  deleteOwner,
  listSiteUpdates,
  upsertSiteUpdate,
  deleteSiteUpdate,
} from "@/lib/admin.functions";
import type { ChargerOwner, SiteUpdate } from "@/lib/tesla-types";

export const Route = createFileRoute("/_authenticated/eigenaren")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Eigenaren & nieuws beheren — Admin" },
      { name: "description", content: "Beheer laadpaaleigenaren zoals Tesla, Fastned en Ionity en publiceer nieuwsupdates voor gebruikers." },
    ],
  }),
  component: EigenarenPage,
  errorComponent: EigenarenError,
  notFoundComponent: EigenarenNotFound,
});

function EigenarenError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Er ging iets mis</h1>
      <p className="mt-2 text-slate-400">{error.message}</p>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  );
}

function EigenarenNotFound() {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Niet gevonden</h1>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  );
}

const emptyOwner: Partial<ChargerOwner> = { name: "", logoUrl: "", website: "", contact: "", description: "", notes: "" };
const emptyUpdate: Partial<SiteUpdate> = { title: "", body: "", imageUrl: "", importance: "normal", visible: true };

const importanceOptions = ["low", "normal", "high", "critical"] as const;
const importanceLabels: Record<string, string> = { low: "Laag", normal: "Normaal", high: "Hoog", critical: "Kritiek" };

function EigenarenPage() {
  const qc = useQueryClient();
  const listOwnersFn = useServerFn(listOwners);
  const upsertOwnerFn = useServerFn(upsertOwner);
  const deleteOwnerFn = useServerFn(deleteOwner);
  const listUpdatesFn = useServerFn(listSiteUpdates);
  const upsertUpdateFn = useServerFn(upsertSiteUpdate);
  const deleteUpdateFn = useServerFn(deleteSiteUpdate);

  const ownersQuery = useQuery({ queryKey: ["admin", "owners"], queryFn: () => listOwnersFn() });
  const updatesQuery = useQuery({ queryKey: ["admin", "site-updates"], queryFn: () => listUpdatesFn() });

  const [editingOwner, setEditingOwner] = useState<Partial<ChargerOwner> | null>(null);
  const [editingUpdate, setEditingUpdate] = useState<Partial<SiteUpdate> | null>(null);

  const ownerMutation = useMutation({
    mutationFn: (data: Partial<ChargerOwner>) =>
      upsertOwnerFn({
        data: {
          id: data.id,
          name: data.name || "",
          logoUrl: data.logoUrl ?? null,
          description: data.description ?? null,
          website: data.website ?? null,
          contact: data.contact ?? null,
          notes: data.notes ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Eigenaar opgeslagen");
      setEditingOwner(null);
      qc.invalidateQueries({ queryKey: ["admin", "owners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteOwnerMutation = useMutation({
    mutationFn: (id: string) => deleteOwnerFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Eigenaar verwijderd");
      qc.invalidateQueries({ queryKey: ["admin", "owners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<SiteUpdate>) =>
      upsertUpdateFn({
        data: {
          id: data.id,
          title: data.title || "",
          body: data.body ?? null,
          imageUrl: data.imageUrl ?? null,
          importance: (data.importance as "low" | "normal" | "high" | "critical") || "normal",
          visible: data.visible !== false,
        },
      }),
    onSuccess: () => {
      toast.success("Update opgeslagen");
      setEditingUpdate(null);
      qc.invalidateQueries({ queryKey: ["admin", "site-updates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteUpdateMutation = useMutation({
    mutationFn: (id: string) => deleteUpdateFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Update verwijderd");
      qc.invalidateQueries({ queryKey: ["admin", "site-updates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const owners = ownersQuery.data || [];
  const updates = updatesQuery.data || [];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-10">
        <div>
          <Link to="/admin" className="text-sm text-slate-400 hover:text-white">← Terug naar admin</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Eigenaren & nieuws</h1>
          <p className="text-sm text-slate-400">Beheer laadpaaleigenaren en publiceer nieuwsupdates</p>
        </div>

        {/* Owners section */}
        <section>
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
            <h2 className="text-xl font-semibold">Eigenaren</h2>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setEditingOwner({ ...emptyOwner })}>
              <Plus className="w-4 h-4 mr-1" /> Nieuwe eigenaar
            </Button>
          </div>

          {ownersQuery.isLoading ? (
            <div>Laden…</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {owners.map((owner) => (
                <div key={owner.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    {owner.logoUrl ? (
                      <img src={owner.logoUrl} alt={owner.name} className="w-10 h-10 rounded object-contain bg-white/10" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-slate-700" />
                    )}
                    <div>
                      <div className="font-semibold">{owner.name}</div>
                      {owner.website && (
                        <a href={owner.website} target="_blank" rel="noreferrer" className="text-xs text-blue-400 flex items-center gap-1 hover:underline">
                          {owner.website} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  {owner.description && <p className="text-sm text-slate-300 line-clamp-3">{owner.description}</p>}
                  <div className="mt-auto flex justify-end gap-1 pt-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingOwner(owner)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Eigenaar "${owner.name}" verwijderen?`)) deleteOwnerMutation.mutate(owner.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              ))}
              {owners.length === 0 && <p className="text-slate-400">Nog geen eigenaren toegevoegd.</p>}
            </div>
          )}

          {editingOwner && (
            <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3 max-w-lg">
              <h3 className="font-semibold">{editingOwner.id ? "Eigenaar bewerken" : "Nieuwe eigenaar"}</h3>
              <div><Label>Naam</Label><Input value={editingOwner.name || ""} onChange={(e) => setEditingOwner({ ...editingOwner, name: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Logo URL</Label><Input value={editingOwner.logoUrl || ""} onChange={(e) => setEditingOwner({ ...editingOwner, logoUrl: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Website</Label><Input value={editingOwner.website || ""} onChange={(e) => setEditingOwner({ ...editingOwner, website: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Contact</Label><Input value={editingOwner.contact || ""} onChange={(e) => setEditingOwner({ ...editingOwner, contact: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Beschrijving</Label><Textarea value={editingOwner.description || ""} onChange={(e) => setEditingOwner({ ...editingOwner, description: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Notities</Label><Textarea value={editingOwner.notes || ""} onChange={(e) => setEditingOwner({ ...editingOwner, notes: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setEditingOwner(null)}>Annuleren</Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => ownerMutation.mutate(editingOwner)} disabled={ownerMutation.isPending}>
                  Opslaan
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Site updates section */}
        <section>
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
            <h2 className="text-xl font-semibold">Nieuwsupdates</h2>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setEditingUpdate({ ...emptyUpdate })}>
              <Plus className="w-4 h-4 mr-1" /> Nieuwe update
            </Button>
          </div>

          {updatesQuery.isLoading ? (
            <div>Laden…</div>
          ) : (
            <div className="space-y-3">
              {updates.map((update) => (
                <div key={update.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4 flex flex-col sm:flex-row gap-3">
                  {update.imageUrl && <img src={update.imageUrl} alt="" className="w-24 h-16 object-cover rounded" />}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{update.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-700">{importanceLabels[update.importance] || update.importance}</span>
                      {!update.visible && <span className="text-xs px-2 py-0.5 rounded bg-red-900 text-red-300">Verborgen</span>}
                    </div>
                    {update.body && <p className="text-sm text-slate-300 mt-1 line-clamp-2">{update.body}</p>}
                    <p className="text-xs text-slate-500 mt-1">{new Date(update.publishedAt).toLocaleString("nl-NL")}</p>
                  </div>
                  <div className="flex sm:flex-col justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditingUpdate(update)}><Pencil className="w-4 h-4" /></Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Update "${update.title}" verwijderen?`)) deleteUpdateMutation.mutate(update.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              ))}
              {updates.length === 0 && <p className="text-slate-400">Nog geen updates gepubliceerd.</p>}
            </div>
          )}

          {editingUpdate && (
            <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3 max-w-lg">
              <h3 className="font-semibold">{editingUpdate.id ? "Update bewerken" : "Nieuwe update"}</h3>
              <div><Label>Titel</Label><Input value={editingUpdate.title || ""} onChange={(e) => setEditingUpdate({ ...editingUpdate, title: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Inhoud</Label><Textarea value={editingUpdate.body || ""} onChange={(e) => setEditingUpdate({ ...editingUpdate, body: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Afbeelding URL</Label><Input value={editingUpdate.imageUrl || ""} onChange={(e) => setEditingUpdate({ ...editingUpdate, imageUrl: e.target.value })} className="bg-slate-900 border-slate-700" /></div>
              <div>
                <Label>Belangrijkheid</Label>
                <select
                  value={editingUpdate.importance || "normal"}
                  onChange={(e) => setEditingUpdate({ ...editingUpdate, importance: e.target.value })}
                  className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm"
                >
                  {importanceOptions.map((opt) => <option key={opt} value={opt}>{importanceLabels[opt]}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editingUpdate.visible !== false} onCheckedChange={(v) => setEditingUpdate({ ...editingUpdate, visible: v })} />
                <Label>Zichtbaar voor gebruikers</Label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setEditingUpdate(null)}>Annuleren</Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => updateMutation.mutate(editingUpdate)} disabled={updateMutation.isPending}>
                  Opslaan
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
