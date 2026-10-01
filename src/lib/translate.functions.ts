import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Vertaalt Nederlandse teksten naar een doeltaal. Eerst uit de database
 * (admin-aanpassingen winnen), ontbrekende teksten via AI en daarna opgeslagen.
 * Faalt alles, dan komt de Nederlandse tekst terug — nooit een crash.
 */
export const translateTexts = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ lang: z.string().min(2).max(5), texts: z.array(z.string().min(1).max(400)).max(150) }).parse(input),
  )
  .handler(async ({ data }): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    if (data.lang === "nl" || data.texts.length === 0) return out;
    const texts = Array.from(new Set(data.texts));
    let admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"] | null = null;
    try {
      admin = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
      const q = admin.from("translations").select("key,value").eq("lang_code", data.lang).in("key", texts);
      const timeout = new Promise<{ data: null }>((r) => setTimeout(() => r({ data: null }), 2500));
      const { data: rows } = (await Promise.race([q, timeout])) as { data: { key: string; value: string }[] | null };
      for (const r of rows ?? []) out[r.key] = r.value;
    } catch {
      /* database niet bereikbaar: ga door met AI */
    }
    const missing = texts.filter((t) => !(t in out));
    if (missing.length === 0) return out;
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return out;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You translate UI texts of an EV/Tesla route planner app from Dutch to the language with ISO code "${data.lang}". Keep numbers, units (kW, km, %), brand names (Tesla, Supercharger, TeslaNavigation) and emoji unchanged. Reply ONLY with a JSON object mapping each original string to its translation.`,
            },
            { role: "user", content: JSON.stringify(missing) },
          ],
        }),
      });
      if (!res.ok) return out;
      const json = await res.json();
      const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
      const toSave: { lang_code: string; key: string; value: string }[] = [];
      for (const src of missing) {
        const v = parsed[src];
        if (typeof v === "string" && v.trim()) {
          out[src] = v;
          toSave.push({ lang_code: data.lang, key: src, value: v });
        }
      }
      if (admin && toSave.length) {
        void admin.from("translations").upsert(toSave, { onConflict: "lang_code,key", ignoreDuplicates: true }).then(() => {}, () => {});
      }
    } catch {
      /* AI niet beschikbaar: Nederlands blijft staan */
    }
    return out;
  });
