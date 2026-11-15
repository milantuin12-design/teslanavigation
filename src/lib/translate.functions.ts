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
    // Geen Lovable AI-gateway meer: ontbrekende vertalingen blijven Nederlands.
    return out;
  });

export const getLanguageTranslations = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ lang: z.string().min(2).max(5) }).parse(input))
  .handler(async ({ data }) => {
    if (data.lang === "nl") return {};
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows, error } = await supabaseAdmin.from("translations").select("key,value").eq("lang_code", data.lang);
      if (error) throw error;
      return Object.fromEntries((rows ?? []).map((row: {key:string;value:string}) => [row.key,row.value]));
    } catch { return {}; }
  });

export const getEnabledLanguages = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("languages")
      .select("code,name,native_name,enabled,is_default,rtl,sort_order").order("sort_order").order("name");
    if (error) throw error;
    return (data ?? []).filter((lang: {enabled:boolean}) => lang.enabled);
  } catch { return []; }
});
