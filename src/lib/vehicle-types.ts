export interface VehicleModel {
  id: string;
  brand: string;
  model: string;
  trim?: string | null;
  batteryKWh?: number | null;
  usableKWh?: number | null;
  rangeKm?: number | null;
  consumptionKWh100?: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  maxChargeKw?: number | null;
  connectors: string[];
  imageUrl?: string | null;
  notes?: string | null;
  published: boolean;
}

/** Sleutel zoals gebruikt in de routeplanner ("Model 3 Long Range AWD"). */
export function vehicleKey(v: Pick<VehicleModel, 'model' | 'trim'>): string {
  return v.trim ? `${v.model} ${v.trim}`.trim() : v.model;
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
