export interface Supercharger {
  name: string;
  lat: number;
  lng: number;
  totalStalls?: number;
  occupiedStalls?: number;
  stallTypes?: string;
  country?: string;
}

export interface ChargingStop {
  charger: Supercharger;
  batteryBefore: number;
  batteryAfter: number;
  distanceFromStart: number;
  chargeDurationMin: number;
  stopNumber?: number;
}

export interface RouteResult {
  coordinates: [number, number][];
  totalDistanceKm: number;
  totalTimeMin: number;
}

export type ChargerStatus = 'Beschikbaar' | 'Druk' | 'Vol' | 'Onbekend';

/** Weather/season only (summer = normal, winter = -20%). */
export type WeatherMode = 'summer' | 'winter';
/** Time of day (night = -5% range from heaters/lights). */
export type TimeMode = 'day' | 'night';

/** Max DC charge speed in kW per model (caps the supercharger output). */
export const teslaMaxChargeKw: Record<string, number> = {
  'Model 3 RWD': 170,
  'Model 3 Long Range RWD': 250,
  'Model 3 Long Range AWD': 250,
  'Model 3 Performance': 250,
  'Model Y RWD': 170,
  'Model Y Long Range RWD': 250,
  'Model Y Long Range AWD': 250,
  'Model Y Performance': 250,
  'Model S': 250,
  'Model S Plaid': 250,
  'Model X': 250,
  'Model X Plaid': 250,
};

export const teslaModels: Record<string, number> = {
  'Model 3 RWD': 385,
  'Model 3 Long Range RWD': 580,
  'Model 3 Long Range AWD': 495,
  'Model 3 Performance': 410,
  'Model Y RWD': 340,
  'Model Y Long Range RWD': 490,
  'Model Y Long Range AWD': 440,
  'Model Y Performance': 410,
  'Model S': 540,
  'Model S Plaid': 485,
  'Model X': 480,
  'Model X Plaid': 430,
};

export const teslaBatteryKWh: Record<string, number> = {
  'Model 3 RWD': 60,
  'Model 3 Long Range RWD': 79,
  'Model 3 Long Range AWD': 79,
  'Model 3 Performance': 79,
  'Model Y RWD': 60,
  'Model Y Long Range RWD': 79,
  'Model Y Long Range AWD': 79,
  'Model Y Performance': 79,
  'Model S': 100,
  'Model S Plaid': 100,
  'Model X': 100,
  'Model X Plaid': 100,
};
