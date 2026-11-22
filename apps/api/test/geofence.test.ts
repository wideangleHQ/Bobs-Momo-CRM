// bun test test/geofence.test.ts  (pure, no database)
import { describe, expect, test } from 'bun:test';
import { haversineMetres, withinGeofence } from '../src/modules/workforce/geofence';

const SITES = {
  pathargadia: { latitude: 20.3661741, longitude: 85.7944251 },
  kalingaNagar: { latitude: 20.2861315, longitude: 85.7732064 },
};
const M_PER_DEG_LAT = 111_194.93;
type Point = { latitude: number; longitude: number };
const northOf = (p: Point, m: number): Point => ({
  latitude: p.latitude + m / M_PER_DEG_LAT,
  longitude: p.longitude,
});
const eastOf = (p: Point, m: number): Point => ({
  latitude: p.latitude,
  longitude: p.longitude + m / (M_PER_DEG_LAT * Math.cos((p.latitude * Math.PI) / 180)),
});

describe('haversineMetres', () => {
  test('identical points are 0 m apart', () => {
    expect(haversineMetres(SITES.pathargadia, SITES.pathargadia)).toBe(0);
  });

  test('one degree of latitude is about 111.19 km', () => {
    const d = haversineMetres({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(111_190);
    expect(d).toBeLessThan(111_200);
  });

  test('the two outlets are far apart, so neither fence admits the other', () => {
    const d = haversineMetres(SITES.pathargadia, SITES.kalingaNagar);
    expect(d).toBeGreaterThan(8_500);
    expect(d).toBeLessThan(10_500);
  });
});

describe.each(Object.entries(SITES))('500 m fence at %s', (_name, site) => {
  test.each([0, 100, 499, 499.9])('%p m north is inside', (m) => {
    expect(withinGeofence(haversineMetres(site, northOf(site, m)), 500)).toBe(true);
  });
  test.each([500.1, 501, 600, 5_000])('%p m north is outside', (m) => {
    expect(withinGeofence(haversineMetres(site, northOf(site, m)), 500)).toBe(false);
  });
  test('east offsets are measured the same way', () => {
    expect(withinGeofence(haversineMetres(site, eastOf(site, 499)), 500)).toBe(true);
    expect(withinGeofence(haversineMetres(site, eastOf(site, 501)), 500)).toBe(false);
  });
  test('exactly on the radius counts as inside', () => {
    expect(withinGeofence(500, 500)).toBe(true);
  });
});
