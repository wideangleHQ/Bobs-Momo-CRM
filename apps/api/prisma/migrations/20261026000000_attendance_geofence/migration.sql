-- Additive only: nullable columns, no defaults, no data touched.
ALTER TABLE "Outlet"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "geofenceRadiusM" INTEGER;

ALTER TABLE "AttendancePunch"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "accuracyM" DOUBLE PRECISION,
  ADD COLUMN "distanceM" DOUBLE PRECISION;

-- Outlet coordinates must be all-or-nothing and in range. The IS NOT NULL terms
-- matter: a CHECK passes on NULL, so without them a half-set outlet got through.
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_geofence_complete" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL AND "geofenceRadiusM" IS NULL)
  OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "geofenceRadiusM" IS NOT NULL
      AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "geofenceRadiusM" > 0)
);
