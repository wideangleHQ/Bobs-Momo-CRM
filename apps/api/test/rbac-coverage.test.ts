// bun test apps/api
// Walks the Nest route table at boot. Any handler that is neither @Public()
// nor decorated with @Permissions fails by name. This is the only thing
// stopping an under-protected endpoint from reaching production quietly:
// forgetting the decorator does not fail the type checker.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PERMISSION_KEYS } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '../src/common/decorators/permissions.decorator';

interface RouteInfo {
  label: string;
  keys: string[] | undefined;
  isPublic: boolean;
}

let app: INestApplication;
let routes: RouteInfo[];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const { MetadataScanner } = await import('@nestjs/core/metadata-scanner');
  const { Reflector } = await import('@nestjs/core');
  // A controller class also carries private helpers. Only methods that Nest
  // stamped with a route path are endpoints.
  const { PATH_METADATA } = await import('@nestjs/common/constants');
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const container = (app as unknown as { container: { getModules(): Map<string, {
    controllers: Map<string, { instance: object; metatype: new (...a: never[]) => object }>;
  }> } }).container;

  routes = [];
  for (const module of container.getModules().values()) {
    for (const wrapper of module.controllers.values()) {
      const instance = wrapper.instance;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const classPublic = reflector.get<boolean>(IS_PUBLIC_KEY, wrapper.metatype) ?? false;

      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (instance as Record<string, unknown>)[name] as (...a: never[]) => unknown;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes.push({
          label: `${wrapper.metatype.name}.${name}`,
          keys: reflector.get<string[]>(PERMISSIONS_KEY, handler),
          isPublic: classPublic || (reflector.get<boolean>(IS_PUBLIC_KEY, handler) ?? false),
        });
      }
    }
  }
});

afterAll(async () => {
  await app?.close();
});

test('the route table is not empty', () => {
  expect(routes.length).toBeGreaterThan(0);
});

test('every handler is either public or carries a permission key', () => {
  const naked = routes.filter((r) => !r.isPublic && !r.keys?.length).map((r) => r.label);
  expect(naked).toEqual([]);
});

test('every permission key used on a route exists in the matrix', () => {
  const known = new Set<string>(PERMISSION_KEYS);
  const unknown = routes
    .flatMap((r) => (r.keys ?? []).map((k) => `${r.label} -> ${k}`))
    .filter((entry) => !known.has(entry.split(' -> ')[1] as string));
  expect(unknown).toEqual([]);
});
