import { WeatherMode, TimeMode, teslaBatteryKWh, teslaModels } from './tesla-types';

/** Ruwe weersituatie langs de route (gemiddelden). */
export interface RouteWeather {
  tempC: number;
  windMs: number;
  /** Tegenwindcomponent in m/s (positief = tegenwind). */
  headwindMs?: number;
  precipitationMm: number;
  snowfallCm: number;
  /** 0..1 aandeel van de route met mist/laag zicht. */
  fogFraction: number;
}

export interface ConsumptionInputs {
  /** Naam van het Tesla-model (of 'Handmatig'). */
  modelName: string;
  /** Bruikbare accucapaciteit in kWh. */
  batteryKWh: number;
  /** WLTP-bereik in km (voor het basisverbruik). */
  rangeKm: number;
  /** Gemiddelde snelheid van de route in km/u (wegtype-indicatie). */
  avgSpeedKmh: number;
  weatherMode: WeatherMode;
  timeMode: TimeMode;
  /** Extra verbruik door een aanhanger, in procenten (0 = geen aanhanger). */
  trailerReductionPercent: number;
  /** Hoogteprofielfactor: >1 klimmen, <1 dalen. */
  elevationMultiplier?: number;
  /** Actueel weer langs de route, indien beschikbaar. */
  weather?: RouteWeather | null;
}

export interface ConsumptionResult {
  /** Verbruik in kWh per 100 km. */
  kWh100: number;
  /** Opsomming van de invloeden, voor uitleg in de UI. */
  factors: { label: string; effectPercent: number }[];
}

/** Basisverbruik uit WLTP-bereik en accucapaciteit (kWh/100 km). */
export function baseConsumptionKWh100(batteryKWh: number, rangeKm: number): number {
  if (!batteryKWh || !rangeKm) return 17;
  return Math.min(30, Math.max(11, (batteryKWh / rangeKm) * 100));
}

/**
 * Automatisch verbruik op basis van wegtype/snelheid, temperatuur, wind,
 * neerslag, mist, hoogteverschil en aanhangerbelasting.
 * Alle externe gegevens zijn optioneel: zonder weerdata blijft de schatting werken.
 */
export function estimateConsumption(input: ConsumptionInputs): ConsumptionResult {
  const base = baseConsumptionKWh100(input.batteryKWh, input.rangeKm);
  const factors: { label: string; effectPercent: number }[] = [];
  let multiplier = 1;

  const add = (label: string, factor: number) => {
    if (Math.abs(factor - 1) < 0.005) return;
    multiplier *= factor;
    factors.push({ label, effectPercent: Math.round((factor - 1) * 100) });
  };

  // Wegtype/snelheid: luchtweerstand groeit kwadratisch met de snelheid.
  const v = Math.min(140, Math.max(30, input.avgSpeedKmh || 90));
  add('Snelheid & wegtype', 0.78 + Math.pow(v / 100, 2) * 0.28);

  // Temperatuur: koud kost verwarming + slechtere accuchemie.
  const tempC = input.weather?.tempC ?? (input.weatherMode === 'winter' ? 0 : input.weatherMode === 'fog' ? 8 : 18);
  if (tempC <= 20) add('Temperatuur', 1 + Math.min(0.35, (20 - tempC) * 0.014));
  else add('Temperatuur (airco)', 1 + Math.min(0.08, (tempC - 20) * 0.006));

  // Wind: tegenwind kost energie.
  const wind = input.weather?.headwindMs ?? (input.weather?.windMs ?? 0) * 0.4;
  if (wind > 0.5) add('Wind', 1 + Math.min(0.2, wind * 0.022));

  // Neerslag / sneeuw: hogere rolweerstand.
  const rain = input.weather?.precipitationMm ?? (input.weatherMode === 'winter' ? 0.4 : 0);
  const snow = input.weather?.snowfallCm ?? 0;
  if (rain > 0.05) add('Regen', 1 + Math.min(0.1, rain * 0.03));
  if (snow > 0.05) add('Sneeuw', 1 + Math.min(0.18, snow * 0.05));

  // Mist: lagere snelheid maar continu licht/ruitenverwarming.
  const fog = input.weather?.fogFraction ?? (input.weatherMode === 'fog' ? 1 : 0);
  if (fog > 0.05) add('Mist', 1 + fog * 0.04);

  if (input.timeMode === 'night') add('Nacht (verlichting/klimaat)', 1.03);

  if (input.trailerReductionPercent > 0) {
    const t = Math.min(60, input.trailerReductionPercent);
    add('Aanhanger', 1 / (1 - t / 100));
  }

  const elev = input.elevationMultiplier ?? 1;
  if (Math.abs(elev - 1) > 0.005) add(elev > 1 ? 'Klimmen' : 'Dalen (regeneratie)', elev);

  return {
    kWh100: Math.round(Math.min(60, Math.max(9, base * multiplier)) * 10) / 10,
    factors,
  };
}

/** Bereik in km bij een gegeven bruikbare energie en verbruik. */
export function rangeFromEnergy(usableKWh: number, kWh100: number): number {
  if (kWh100 <= 0) return 0;
  return (usableKWh / kWh100) * 100;
}

/** Bruikbare accucapaciteit (kWh) voor een model, met optionele override. */
export function batteryCapacityFor(modelName: string, overrideKWh?: number): number {
  if (overrideKWh && overrideKWh > 0) return overrideKWh;
  return teslaBatteryKWh[modelName] || 79;
}

/** WLTP-bereik voor een model, met optionele override. */
export function rangeFor(modelName: string, overrideKm?: number): number {
  if (overrideKm && overrideKm > 0) return overrideKm;
  return teslaModels[modelName] || 450;
}

/* ------------------------------------------------------------------ */
/* Laadstekkers                                                        */
/* ------------------------------------------------------------------ */

export type ConnectorType = 'Type 2' | 'CCS';

/** Alleen Type 2 en CCS worden ondersteund. */
export const supportedConnectors: ConnectorType[] = ['Type 2', 'CCS'];

export function normalizeConnectors(value?: unknown): ConnectorType[] {
  const list = Array.isArray(value) ? value : [];
  const out = new Set<ConnectorType>();
  for (const raw of list) {
    const s = String(raw).toLowerCase();
    if (s.includes('ccs') || s.includes('combo')) out.add('CCS');
    if (s.includes('type 2') || s.includes('type2') || s.includes('mennekes')) out.add('Type 2');
  }
  // Standaard: Europese Superchargers hebben CCS (en vaak Type 2 AC).
  if (out.size === 0) return ['CCS'];
  return Array.from(out);
}

/** Model S/X van vóór 2019 heeft een CCS-adapter nodig. */
export function needsCcsAdapter(modelName: string, modelYear?: number | null): boolean {
  const isSX = /model\s*(s|x)/i.test(modelName);
  if (!isSX) return false;
  if (typeof modelYear === 'number' && modelYear > 0) return modelYear < 2019;
  return false;
}

/** Kan deze auto laden op een laadpunt met deze stekkers? */
export function canUseConnectors(
  connectors: ConnectorType[],
  opts: { ccsBlocked: boolean },
): boolean {
  const usable = connectors.filter((c) => (c === 'CCS' ? !opts.ccsBlocked : true));
  return usable.length > 0;
}
