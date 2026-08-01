import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ReportTarget {
  id: string | null;
  name: string;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "wrong_data", label: "Verkeerde gegevens (aantal/snelheid)" },
  { value: "wrong_location", label: "Verkeerde locatie" },
  { value: "closed", label: "Lader is dicht / buiten gebruik" },
  { value: "opening_hours", label: "Openingstijden kloppen niet" },
  { value: "missing", label: "Supercharger ontbreekt" },
  { value: "other", label: "Anders" },
];

export default function ReportChargerDialog({
  target,
  onClose,
}: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("wrong_data");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < 3) {
      toast.error("Beschrijf kort wat er niet klopt.");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("charger_reports").insert({
      charger_id: target?.id ?? null,
      charger_name: target?.name ?? null,
      user_id: userData.user?.id ?? null,
      contact_email: email.trim() || userData.user?.email || null,
      category,
      message: trimmed.slice(0, 2000),
      status: "new",
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bedankt! Je melding is verstuurd.");
    setMessage("");
    setEmail("");
    onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Fout melden</DialogTitle>
          <DialogDescription className="text-slate-400">
            {target?.name ? `Over: ${target.name}` : "Over een Supercharger"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Soort melding</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Wat klopt er niet?</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Bijv. hier staan 12 laders van 250kW, niet 8."
              className="bg-slate-800 border-slate-700 mt-1"
            />
          </div>
          <div>
            <Label>E-mail (optioneel)</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              placeholder="voor een reactie"
              className="bg-slate-800 border-slate-700 mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuleren</Button>
          <Button onClick={submit} disabled={saving} className="bg-red-600 hover:bg-red-700">
            {saving ? "Versturen…" : "Versturen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
