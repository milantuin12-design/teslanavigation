-- Add separate real-world summer and winter driving ranges to each year-specific vehicle variant.
-- Existing WLTP range and consumption values remain intact for backward compatibility.
ALTER TABLE vehicle_models ADD COLUMN summer_range_km INTEGER;
ALTER TABLE vehicle_models ADD COLUMN winter_range_km INTEGER;
