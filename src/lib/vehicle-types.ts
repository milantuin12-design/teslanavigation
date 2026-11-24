export interface VehicleModel {
  id: string;
  brand: string;
  model: string;
  trim?: string | null;
  batteryKWh?: number | null;
  usableKWh?: number | null;
  rangeKm?: number | null;
  summerRangeKm?: number | null;
  winterRangeKm?: number | null;
  summerConsumptionKWh100?: number | null;
  consumptionKWh100?: number | null;
  winterConsumptionKWh100?: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  productionYearTo?: number | null;
  maxChargeKw?: number | null;
  connectors: string[];
  imageUrl?: string | null;
  notes?: string | null;
  published: boolean;
}

/** Verwijder jaartallen uit model-/uitvoeringsnamen; het aparte bouwjaarveld bepaalt de variant. */
export function cleanVehicleName(value: string | null | undefined): string {
  return (value ?? "").replace(/\b(?:19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
}

/** Sleutel zoals gebruikt in de routeplanner (zonder jaartallen in de naam). */
export function vehicleKey(v: Pick<VehicleModel, 'model' | 'trim'>): string {
  return [cleanVehicleName(v.model), cleanVehicleName(v.trim)].filter(Boolean).join(" ");
}

export function vehicleLabel(v: VehicleModel): string {
  const parts = [v.brand, vehicleKey(v)];
  return parts.filter(Boolean).join(' ');
}

export interface PlateLookupResult {
  found: boolean;
  plate: string;
  brand?: string;
  tradeName?: string;
  year?: number;
  /** Beste match uit de voertuigdatabase, indien gevonden. */
  matchedVehicleId?: string | null;
  message?: string;
}
