// Sets the attendance geofence on an EXISTING outlet. Dry run unless --apply.
//   bun run prisma/set-outlet-geofence.ts <OUTLET_CODE> <lat> <lng> <radiusM> [--apply]
// It never creates an outlet: if the code does not match, nothing is written.
import { PrismaClient } from '@prisma/client';

const [code, latRaw, lngRaw, radiusRaw] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const latitude = Number(latRaw);
const longitude = Number(lngRaw);
const geofenceRadiusM = Number(radiusRaw);

if (
  !code ||
  !Number.isFinite(latitude) ||
  Math.abs(latitude) > 90 ||
  !Number.isFinite(longitude) ||
  Math.abs(longitude) > 180 ||
  !Number.isInteger(geofenceRadiusM) ||
  geofenceRadiusM <= 0
) {
  console.error('usage: set-outlet-geofence.ts <OUTLET_CODE> <lat> <lng> <radiusM> [--apply]');
  process.exit(2);
}

const prisma = new PrismaClient();

async function main(): Promise<number> {
  const outlet = await prisma.outlet.findUnique({ where: { code } });
  if (!outlet) {
    const known = await prisma.outlet.findMany({ select: { code: true, name: true } });
    console.error(`No outlet with code "${code}". Existing outlets:`);
    for (const o of known) console.error(`  ${o.code}  ${o.name}`);
    return 1;
  }
  console.log(`Outlet : ${outlet.code} | ${outlet.name} | ${outlet.address ?? 'no address'}`);
  console.log(`Current: ${outlet.latitude}, ${outlet.longitude}, ${outlet.geofenceRadiusM} m`);
  console.log(`New    : ${latitude}, ${longitude}, ${geofenceRadiusM} m`);
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return 0;
  }
  await prisma.outlet.update({
    where: { id: outlet.id },
    data: { latitude, longitude, geofenceRadiusM },
  });
  console.log('Written.');
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
