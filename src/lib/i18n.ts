/**
 * Meertaligheid. Nederlands is de hoofdtaal en tevens de fallback:
 * ontbreekt een vertaling, dan tonen we gewoon de Nederlandse tekst.
 * Actieve talen en aangepaste vertalingen komen uit de database, met een
 * lokale kopie zodat de app ook zonder verbinding blijft werken.
 */
import { LOCAL_KEYS, readLocal, writeLocal } from "./local-store";

export interface AppLanguage {
  code: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
  rtl: boolean;
  sortOrder: number;
}

export const DEFAULT_LANGUAGE = "nl";

/** Alle ondersteunde talen (fallback als de database niet bereikbaar is). */
export const FALLBACK_LANGUAGES: AppLanguage[] = [
  ["nl", "Nederlands", "Nederlands"],
  ["en", "Engels", "English"],
  ["de", "Duits", "Deutsch"],
  ["fr", "Frans", "Français"],
  ["es", "Spaans", "Español"],
  ["it", "Italiaans", "Italiano"],
  ["sv", "Zweeds", "Svenska"],
  ["no", "Noors", "Norsk"],
  ["fi", "Fins", "Suomi"],
  ["da", "Deens", "Dansk"],
  ["pl", "Pools", "Polski"],
  ["pt", "Portugees", "Português"],
  ["el", "Grieks", "Ελληνικά"],
  ["ga", "Iers", "Gaeilge"],
  ["is", "IJslands", "Íslenska"],
  ["lt", "Litouws", "Lietuvių"],
  ["lv", "Lets", "Latviešu"],
  ["et", "Ests", "Eesti"],
  ["sl", "Sloveens", "Slovenščina"],
  ["sk", "Slowaaks", "Slovenčina"],
  ["ro", "Roemeens", "Română"],
  ["hu", "Hongaars", "Magyar"],
  ["hr", "Kroatisch", "Hrvatski"],
  ["sr", "Servisch", "Српски"],
  ["tr", "Turks", "Türkçe"],
  ["lb", "Luxemburgs", "Lëtzebuergesch"],
  ["ar", "Arabisch", "العربية"],
  ["ca", "Catalaans", "Català"],
].map(([code, name, nativeName], i) => ({
  code: code!,
  name: name!,
  nativeName: nativeName!,
  enabled: true,
  isDefault: code === DEFAULT_LANGUAGE,
  rtl: code === "ar",
  sortOrder: i + 1,
}));

/** Landen met een afwijkende voorkeurstaal. */
export const COUNTRY_LANGUAGES: Record<string, string[]> = {
  CH: ["de", "fr", "it"],
  Zwitserland: ["de", "fr", "it"],
  LI: ["de"],
  Liechtenstein: ["de"],
  AD: ["ca"],
  Andorra: ["ca"],
};

export function languagesForCountry(country?: string | null): string[] {
  if (!country) return [DEFAULT_LANGUAGE];
  return COUNTRY_LANGUAGES[country] ?? COUNTRY_LANGUAGES[country.toUpperCase()] ?? [DEFAULT_LANGUAGE];
}

export function getStoredLanguage(): string {
  return readLocal<string>(LOCAL_KEYS.language, DEFAULT_LANGUAGE);
}

export function setStoredLanguage(code: string): void {
  writeLocal(LOCAL_KEYS.language, code);
}

/** Basisteksten in het Nederlands. Vertalingen komen uit de database. */
export const BASE_STRINGS: Record<string, string> = {
  "app.title": "TeslaNavigation",
  "nav.map": "Kaart",
  "nav.myRoutes": "Mijn routes",
  "nav.admin": "Beheer",
  "route.plan": "Route berekenen",
  "route.share": "Route delen",
  "route.sendToTesla": "Stuur naar Tesla",
  "charger.available": "Beschikbaar",
  "charger.closed": "Gesloten",
  "charger.unavailable": "Niet beschikbaar",
  "report.send": "Versturen",
  "common.save": "Opslaan",
  "common.cancel": "Annuleren",
};

export type TranslationMap = Record<string, string>;

export function translate(map: TranslationMap | undefined, key: string): string {
  return map?.[key] ?? BASE_STRINGS[key] ?? key;
}
