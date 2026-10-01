import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { translateTexts } from "@/lib/translate.functions";
import { DEFAULT_LANGUAGE, FALLBACK_LANGUAGES, getStoredLanguage, setStoredLanguage, type AppLanguage } from "@/lib/i18n";
import { Globe } from "lucide-react";

const CACHE_PREFIX = "tn-i18n-";
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "TEXTAREA", "INPUT", "SVG", "PATH"]);
const listeners = new Set<(l: string) => void>();
let currentLang = DEFAULT_LANGUAGE;

export function changeLanguage(code: string) {
  setStoredLanguage(code);
  // Bij terug naar Nederlands: pagina opnieuw laden zodat originele teksten terugkomen.
  if (code === DEFAULT_LANGUAGE && currentLang !== DEFAULT_LANGUAGE) {
    window.location.reload();
    return;
  }
  currentLang = code;
  listeners.forEach((fn) => fn(code));
}

function loadCache(lang: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + lang) || "{}"); } catch { return {}; }
}
function saveCache(lang: string, map: Record<string, string>) {
  try { localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify(map)); } catch { /* vol */ }
}

/** Vertaalt alle zichtbare teksten in de app naar de gekozen taal (Nederlands = origineel). */
export function LanguageProvider() {
  const [lang, setLang] = useState(DEFAULT_LANGUAGE);
  const original = useRef(new WeakMap<Node, string>());

  useEffect(() => {
    const stored = getStoredLanguage();
    currentLang = stored;
    setLang(stored);
    const fn = (l: string) => setLang(l);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    const rtl = lang === "ar";
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    if (lang === DEFAULT_LANGUAGE) return;

    let map = loadCache(lang);
    // Admin-aanpassingen ophalen (overschrijven cache)
    supabase.from("translations").select("key,value").eq("lang_code", lang).then(({ data }) => {
      if (data?.length) { for (const r of data) map[r.key] = r.value; saveCache(lang, map); apply(document.body); }
    });

    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    const flush = async () => {
      if (busy || pending.size === 0) return;
      busy = true;
      const batch = Array.from(pending).slice(0, 120);
      batch.forEach((t) => pending.delete(t));
      try {
        const res = await translateTexts({ data: { lang, texts: batch } });
        // markeer onvertaalbare zodat we niet blijven vragen
        for (const t of batch) map[t] = res[t] ?? map[t] ?? t;
        saveCache(lang, map);
        apply(document.body);
      } catch { for (const t of batch) map[t] = t; }
      busy = false;
      if (pending.size) timer = setTimeout(flush, 300);
    };

    const translateNode = (node: Text) => {
      const raw = node.nodeValue ?? "";
      const known = original.current.get(node);
      // React kan de tekst vervangen: dan is dat het nieuwe origineel
      const src = known !== undefined && (raw === known || raw === map[known.trim()]) ? known : raw;
      original.current.set(node, src);
      const key = src.trim();
      if (key.length < 2 || !/[a-zA-Z]/.test(key)) return;
      const tr = map[key];
      if (tr === undefined) { pending.add(key); return; }
      const next = src.replace(key, tr);
      if (node.nodeValue !== next) node.nodeValue = next;
    };

    const translateAttr = (el: Element) => {
      for (const attr of ["placeholder", "title", "aria-label"]) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        const srcAttr = `data-i18n-${attr}`;
        let src = el.getAttribute(srcAttr);
        if (!src || (v !== src && v !== map[src])) { src = v; el.setAttribute(srcAttr, v); }
        const tr = map[src.trim()];
        if (tr === undefined) { if (/[a-zA-Z]/.test(src)) pending.add(src.trim()); }
        else if (v !== tr) el.setAttribute(attr, tr);
      }
    };

    function apply(root: Node) {
      if (root.nodeType === Node.TEXT_NODE) { translateNode(root as Text); }
      else if (root.nodeType === Node.ELEMENT_NODE) {
        const el = root as Element;
        if (SKIP.has(el.tagName.toUpperCase()) || el.closest("[data-no-translate],.leaflet-tile-pane")) return;
        translateAttr(el);
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
          acceptNode: (n) => n.nodeType === Node.ELEMENT_NODE && SKIP.has((n as Element).tagName.toUpperCase()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        let n: Node | null = walker.nextNode();
        while (n) {
          if (n.nodeType === Node.TEXT_NODE) translateNode(n as Text); else translateAttr(n as Element);
          n = walker.nextNode();
        }
      }
      if (pending.size && !timer) timer = setTimeout(() => { timer = null; flush(); }, 250);
    }

    apply(document.body);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") apply(m.target);
        else if (m.type === "attributes") translateAttr(m.target as Element);
        else m.addedNodes.forEach((n) => apply(n));
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
    return () => { obs.disconnect(); if (timer) clearTimeout(timer); };
  }, [lang]);

  return null;
}

/** Taalkiezer met alleen de door de admin geactiveerde talen. */
export function LanguageSwitcher() {
  const [langs, setLangs] = useState<AppLanguage[]>(FALLBACK_LANGUAGES);
  const [lang, setLang] = useState(DEFAULT_LANGUAGE);
  useEffect(() => {
    setLang(getStoredLanguage());
    const fn = (l: string) => setLang(l);
    listeners.add(fn);
    supabase.from("languages").select("code,name,native_name,enabled,is_default,rtl,sort_order").order("sort_order").then(({ data }) => {
      if (data?.length) setLangs(data.filter((l) => l.enabled).map((l) => ({ code: l.code, name: l.name, nativeName: l.native_name, enabled: l.enabled, isDefault: l.is_default, rtl: l.rtl, sortOrder: l.sort_order })));
    });
    return () => { listeners.delete(fn); };
  }, []);
  return (
    <label className="glass-panel flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs" data-no-translate>
      <Globe className="h-3.5 w-3.5 opacity-70" />
      <select value={lang} onChange={(e) => changeLanguage(e.target.value)} className="bg-transparent outline-none" aria-label="Language">
        {langs.map((l) => <option key={l.code} value={l.code} className="text-black">{l.nativeName}</option>)}
      </select>
    </label>
  );
}
