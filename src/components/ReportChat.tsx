import { useCallback, useEffect, useRef, useState } from "react";
import { listReportMessages, sendReportMessage } from "@/lib/account.functions";
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
    try {
      const data = await listReportMessages({ data: { reportId } });
      setMessages(data as ReportMessage[]);
    } catch { /* geen toegang of tijdelijk offline */ }
  }, [reportId]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => { void load(); }, 10000);
    return () => window.clearInterval(refresh);
  }, [reportId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendReportMessage({ data: { reportId, body } });
    } catch (error) {
      setSending(false);
      toast.error(error instanceof Error ? error.message : "Bericht versturen mislukt");
      return;
    }
    setSending(false);
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
