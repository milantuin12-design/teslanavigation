import { teslaBatteryKWh, teslaMaxChargeKw, type ChargingStop, type PriceBlock } from "./tesla-types";
import { estimatedChargePowerKw, parseMaxSpeed } from "./tesla-utils";

export interface ChargingCostEstimate {
  amount: number;
  currency: string;
  type: "kwh" | "minute";
  /** Effective charging power at the beginning of the charge. */
  initialPowerKw?: number;
}

function dayMatches(rule: string | undefined, date: Date): boolean {
  const value = (rule ?? "").toLowerCase().trim();
  if (!value || value.includes("dagelijks") || value.includes("daily")) return true;
  if (value.includes("weekend")) return date.getDay() === 0 || date.getDay() === 6;
  if (value.includes("ma-vr") || value.includes("weekdag") || value.includes("weekday")) return date.getDay() >= 1 && date.getDay() <= 5;
  if (value.includes("ma-zo")) return true;
  return true;
}

function minuteOfDay(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return hours * 60 + minutes;
}

function activeKwhPrice(blocks: PriceBlock[], at: Date): number | null {
  const minute = at.getHours() * 60 + at.getMinutes();
  for (const block of blocks) {
    if (block.type === "power" || !dayMatches(block.days, at)) continue;
    const from = minuteOfDay(block.from, 0);
    const to = minuteOfDay(block.to, 1440);
    const inTime = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
    if (inTime && typeof block.pricePerKwh === "number" && block.pricePerKwh >= 0) return block.pricePerKwh;
  }
  return null;
}

/**
 * Estimate the total cost for the charging session using the Tesla SOC taper.
 * Power-based tariffs are charged per minute at the actual estimated charging
 * power (after car and station caps). kWh tariffs are evaluated as the session
 * progresses, so a tariff boundary during charging is respected.
 */
export function estimateChargingCost(
  stop: ChargingStop,
  arrival: Date,
  modelName = "Model 3 Long Range AWD",
  batteryCapacityKWh?: number,
  carMaxKwOverride?: number,
): ChargingCostEstimate | null {
  const charger = stop.charger;
  const blocks = (charger.priceBlocks ?? []).filter((block) => block && typeof block === "object");
  const powerBlocks = blocks.filter((block) => block.type === "power" && typeof block.pricePerMinute === "number");
  const kwhBlocks = blocks.filter((block) => block.type !== "power" && typeof block.pricePerKwh === "number");
  const rawCurrency = (charger.priceCurrency || "EUR").toUpperCase();
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "EUR";
  const capacity = batteryCapacityKWh && batteryCapacityKWh > 0
    ? batteryCapacityKWh
    : (teslaBatteryKWh[modelName] ?? 79);
  const stationCap = Math.max(1, parseMaxSpeed(charger.stallTypes, charger.maxSpeedKw, charger.chargerConfigs));
  const carCap = carMaxKwOverride && carMaxKwOverride > 0
    ? carMaxKwOverride
    : (teslaMaxChargeKw[modelName] ?? 250);
  const powerCap = Math.min(stationCap, carCap);
  const start = Math.max(0, Math.min(100, stop.batteryBefore));
  const end = Math.max(start, Math.min(100, stop.batteryAfter));
  if (end <= start) return null;

  if (powerBlocks.length > 0) {
    let amount = 0;
    let elapsedMinutes = 0;
    let initialPowerKw: number | undefined;
    for (let pct = start; pct < end; pct += 1) {
      const next = Math.min(end, pct + 1);
      const midpoint = (pct + next) / 2;
      const powerKw = Math.min(powerCap, estimatedChargePowerKw(modelName, midpoint, stationCap, carMaxKwOverride));
      if (!initialPowerKw) initialPowerKw = powerKw;
      const minutes = (capacity * (next - pct) / 100 / powerKw) * 60;
      const tier = powerBlocks.find((block) =>
        powerKw >= (block.minKw ?? 0) && (block.maxKw == null || powerKw < block.maxKw)
      );
      if (!tier) return null;
      amount += minutes * (tier.pricePerMinute ?? 0);
      elapsedMinutes += minutes;
    }
    return Number.isFinite(amount) ? { amount, currency, type: "minute", initialPowerKw } : null;
  }

  const hasKwhPricing = kwhBlocks.length > 0 || (typeof charger.pricePerKwh === "number" && charger.pricePerKwh >= 0);
  if (!hasKwhPricing) return null;
  let amount = 0;
  let elapsedMinutes = 0;
  for (let pct = start; pct < end; pct += 1) {
    const next = Math.min(end, pct + 1);
    const midpoint = (pct + next) / 2;
    const powerKw = Math.min(powerCap, estimatedChargePowerKw(modelName, midpoint, stationCap, carMaxKwOverride));
    const segmentMinutes = (capacity * (next - pct) / 100 / powerKw) * 60;
    const at = new Date(arrival.getTime() + elapsedMinutes * 60000);
    const timePrice = activeKwhPrice(kwhBlocks, at);
    const price = timePrice ?? (kwhBlocks.length > 0 ? null : charger.pricePerKwh);
    if (typeof price !== "number" || price < 0) return null;
    amount += (capacity * (next - pct) / 100) * price;
    elapsedMinutes += segmentMinutes;
  }
  return Number.isFinite(amount) ? { amount, currency, type: "kwh" } : null;
}
