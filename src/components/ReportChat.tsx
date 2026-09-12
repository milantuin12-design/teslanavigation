import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Send } from "lucide-react";

export type ReportMessage = {
  id: string;
  report_id: string;
  sender_id: string | null;
  is_admin: boolean;
  body: string;
  created_at: string;
};

/** Gesprek tussen melder en admin over één melding. */
export function ReportChat({ reportId, asAdmin }: { reportId: string; asAdmin: boolean }) {
  const [messages, setMessages] = useState<ReportMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("report_messages")
      .select("id,report_id,sender_id,is_admin,body,created_at")
      .eq("report_id", reportId)
      .order("created_at", { ascending: true });
    if (error) return;
    setMessages((data as ReportMessage[]) || []);
  }, [reportId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`report-messages-${reportId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "report_messages", filter: `report_id=eq.${reportId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reportId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      toast.error("Je bent niet ingelogd.");
      setSending(false);
      return;
    }
    const { error } = await supabase.from("report_messages").insert({
      report_id: reportId,
      sender_id: uid,
      is_admin: asAdmin,
      body,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    load();
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">Gesprek</div>
      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
        {messages.length === 0 && <p className="text-sm text-slate-500">Nog geen berichten.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.is_admin === asAdmin ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.is_admin ? "bg-blue-600/80 text-white" : "bg-slate-700 text-slate-100"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <div className="text-[10px] opacity-70 mt-1">
                {m.is_admin ? "Beheer" : "Melder"} · {new Date(m.created_at).toLocaleString("nl-NL")}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 items-end">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Schrijf een bericht…"
          className="bg-slate-900 border-slate-700"
        />
        <Button size="sm" onClick={send} disabled={sending || !text.trim()} className="bg-blue-600 hover:bg-blue-700">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
