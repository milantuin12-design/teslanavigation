// Lokale ("local-first") basisdataset van Superchargers.
// Deze data reist mee met de app: geen cloud nodig om de kaart te vullen.
// De cloud is alleen een overlay voor admin-wijzigingen.
import dataset from "@/data/superchargers.json";

export interface LocalChargerDataset {
  version: number;
  exportedAt: string;
  owners: {
    id: string;
    name: string;
    logo_url: string | null;
    description: string | null;
    website: string | null;
    contact: string | null;
    notes: string | null;
  }[];
  chargers: Record<string, unknown>[];
}

export const localChargerDataset = dataset as unknown as LocalChargerDataset;
