import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyAccountSettings, updateMyAccountSettings } from "@/lib/account.functions";
import { changePassword } from "@/lib/auth.functions";
import { toast } from "sonner";

type Settings = {
  email: string;
  display_name: string;
  gender: "male" | "female" | "other" | "unspecified";
  preferences: {
    vehicle_model?: string | null;
    vehicle_year?: number | null;
    consumption_kwh100?: number | null;
    notifications: { favorite_status: boolean; price_changes: boolean; new_locations: boolean };
    map: { show_development_chargers: boolean; remember_filters: boolean };
  };
};

const defaults: Settings = {
  email: "",
  display_name: "",
  gender: "unspecified",
  preferences: {
    vehicle_model: "",
    vehicle_year: null,
    consumption_kwh100: null,
    notifications: { favorite_status: true, price_changes: true, new_locations: false },
    map: { show_development_chargers: false, remember_filters: true },
  },
};

export function AccountSettingsDialog({ open, onOpenChange, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (displayName: string | null, gender: Settings["gender"]) => void;
}) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const saveSettingsFn = useServerFn(updateMyAccountSettings);
  const changePasswordFn = useServerFn(changePassword);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void getMyAccountSettings().then((data) => {
      if (active) setSettings({ ...defaults, ...data, preferences: {
        ...defaults.preferences,
        ...data.preferences,
        notifications: { ...defaults.preferences.notifications, ...data.preferences?.notifications },
        map: { ...defaults.preferences.map, ...data.preferences?.map },
      } } as Settings);
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Accountinstellingen laden mislukt"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  const updatePreference = (section: "notifications" | "map", key: string, value: boolean) => {
    setSettings((old) => ({
      ...old,
      preferences: { ...old.preferences, [section]: { ...old.preferences[section], [key]: value } },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveSettingsFn({ data: {
        display_name: settings.display_name.trim() || null,
        gender: settings.gender,
        preferences: {
          vehicle_model: settings.preferences.vehicle_model?.trim() || null,
          vehicle_year: settings.preferences.vehicle_year ?? null,
          consumption_kwh100: settings.preferences.consumption_kwh100 ?? null,
          notifications: settings.preferences.notifications,
          map: settings.preferences.map,
        },
      } });
      onSaved(settings.display_name.trim() || null, settings.gender);
      window.dispatchEvent(new CustomEvent("tn-preferences-updated", { detail: settings.preferences }));
      toast.success("Accountinstellingen opgeslagen");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Opslaan mislukt");
    } finally { setSaving(false); }
  };

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("De nieuwe wachtwoorden komen niet overeen.");
      return;
    }
    try {
      await changePasswordFn({ data: { currentPassword, newPassword } });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast.success("Wachtwoord gewijzigd. Je huidige sessie blijft actief.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wachtwoord wijzigen mislukt");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto bg-slate-900 border-slate-700 text-white">
        <DialogHeader><DialogTitle>Accountinstellingen</DialogTitle></DialogHeader>
        {loading ? <p className="py-8 text-sm text-slate-400">Instellingen laden…</p> : (
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="font-semibold">Persoonlijk profiel</h3>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Naam die in TeslaNavigation wordt getoond</label>
                <Input value={settings.display_name} maxLength={80} onChange={(e) => setSettings((s) => ({ ...s, display_name: e.target.value }))} placeholder="Vul je naam in" className="bg-slate-800 border-slate-700" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Aanspreekvorm</label>
                <select value={settings.gender} onChange={(e) => setSettings((s) => ({ ...s, gender: e.target.value as Settings["gender"] }))} className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                  <option value="male">Man</option>
                  <option value="female">Vrouw</option>
                  <option value="other">Anders</option>
                  <option value="unspecified">Niet instellen</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">Deze keuze wordt gebruikt voor de persoonlijke begroeting en aanspreekvorm.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Account-e-mailadres</label>
                <Input value={settings.email} disabled className="bg-slate-800/60 border-slate-700 text-slate-400" />
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-700 pt-4">
              <h3 className="font-semibold">Mijn voertuig</h3>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Model / uitvoering</label>
                <Input value={settings.preferences.vehicle_model ?? ""} maxLength={120} onChange={(e) => setSettings((s) => ({ ...s, preferences: { ...s.preferences, vehicle_model: e.target.value } }))} placeholder="Bijv. Model Y Long Range AWD" className="bg-slate-800 border-slate-700" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Bouwjaar</label>
                  <Input type="number" min="1990" max="2100" value={settings.preferences.vehicle_year ?? ""} onChange={(e) => setSettings((s) => ({ ...s, preferences: { ...s.preferences, vehicle_year: e.target.value ? Number(e.target.value) : null } }))} placeholder="2025" className="bg-slate-800 border-slate-700" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Verbruik (kWh/100 km)</label>
                  <Input type="number" min="1" max="100" step="0.1" value={settings.preferences.consumption_kwh100 ?? ""} onChange={(e) => setSettings((s) => ({ ...s, preferences: { ...s.preferences, consumption_kwh100: e.target.value ? Number(e.target.value) : null } }))} placeholder="17.5" className="bg-slate-800 border-slate-700" />
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-700 pt-4">
              <h3 className="font-semibold">Meldingsvoorkeuren</h3>
              {([
                ["favorite_status", "Wijzigingen bij mijn favoriete Superchargers"],
                ["price_changes", "Wijzigingen in laadprijzen"],
                ["new_locations", "Nieuwe Superchargerlocaties"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 text-sm text-slate-300">
                  <input type="checkbox" className="accent-red-500" checked={settings.preferences.notifications[key]} onChange={(e) => updatePreference("notifications", key, e.target.checked)} />
                  {label}
                </label>
              ))}
              <p className="text-xs text-slate-500">Laadprijswijzigingen bij favorieten kunnen in de app worden gemeld. Meldingen voor statuswijzigingen en nieuwe locaties en pushmeldingen zijn nog niet actief.</p>
            </section>

            <section className="space-y-3 border-t border-slate-700 pt-4">
              <h3 className="font-semibold">Kaartvoorkeuren</h3>
              {([
                ["show_development_chargers", "Toon plannen en bouwlocaties standaard"],
                ["remember_filters", "Mijn kaartfilters onthouden op dit apparaat"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 text-sm text-slate-300">
                  <input type="checkbox" className="accent-red-500" checked={settings.preferences.map[key]} onChange={(e) => updatePreference("map", key, e.target.checked)} />
                  {label}
                </label>
              ))}
            </section>

            <section className="space-y-3 border-t border-slate-700 pt-4">
              <h3 className="font-semibold">Wachtwoord wijzigen</h3>
              <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Huidig wachtwoord" className="bg-slate-800 border-slate-700" />
              <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nieuw wachtwoord (minimaal 10 tekens)" className="bg-slate-800 border-slate-700" />
              <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Herhaal nieuw wachtwoord" className="bg-slate-800 border-slate-700" />
              <Button variant="outline" className="border-slate-600" disabled={!currentPassword || newPassword.length < 10 || !confirmPassword} onClick={savePassword}>Wachtwoord wijzigen</Button>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Sluiten</Button>
          <Button disabled={loading || saving} className="bg-red-600 hover:bg-red-700" onClick={save}>{saving ? "Opslaan…" : "Instellingen opslaan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
