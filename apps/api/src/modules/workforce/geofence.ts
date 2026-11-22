const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function haversineMetres(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Inside means distance <= radius. No accuracy allowance: none has been approved. */
export function withinGeofence(distanceM: number, radiusM: number): boolean {
  return distanceM <= radiusM;
}
