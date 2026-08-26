import type { PrismaClient } from '@prisma/client';
import {
  CATEGORIES,
  CHECKLIST_TEMPLATES,
  DEPARTMENTS,
  ITEMS,
  OUTLETS,
  PERISHABLE_CATEGORIES,
  UNITS,
} from './reference-data';

// Everything here upserts on a natural key, never on id. A uuid generated at
// seed time differs per environment, so keying on id duplicates rows on the
// second run.
export async function seedReference(prisma: PrismaClient): Promise<void> {
  for (const u of UNITS) {
    await prisma.unit.upsert({
      where: { code: u.code },
      update: { name: u.name },
      create: { code: u.code, name: u.name },
    });
  }

  for (const name of CATEGORIES) {
    await prisma.itemCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const o of OUTLETS) {
    const outlet = await prisma.outlet.upsert({
      where: { code: o.code },
      update: { name: o.name, address: o.address },
      create: { code: o.code, name: o.name, address: o.address, timezone: 'Asia/Kolkata' },
    });
    for (const name of DEPARTMENTS) {
      await prisma.department.upsert({
        where: { outletId_name: { outletId: outlet.id, name } },
        update: {},
        create: { outletId: outlet.id, name },
      });
    }
  }

  const units = new Map((await prisma.unit.findMany()).map((u) => [u.code, u.id]));
  const cats = new Map((await prisma.itemCategory.findMany()).map((c) => [c.name, c.id]));

  for (const item of ITEMS) {
    const unitId = units.get(item.unit);
    const categoryId = cats.get(item.category);
    if (!unitId || !categoryId) {
      throw new Error(`${item.sku}: unknown unit "${item.unit}" or category "${item.category}"`);
    }
    await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      // unitId is deliberately not updated. Changing an item's unit after the
      // ledger has rows would mix KG and G in one balance. Chapter 10.
      update: { name: item.name, categoryId },
      create: {
        sku: item.sku,
        name: item.name,
        categoryId,
        unitId,
        isPerishable: PERISHABLE_CATEGORIES.has(item.category),
      },
    });
  }

  const outlets = await prisma.outlet.findMany({ where: { isActive: true } });

  for (const t of CHECKLIST_TEMPLATES) {
    const template = await prisma.checklistTemplate.upsert({
      where: { code: t.code },
      update: { name: t.name, isAudit: t.isAudit },
      create: { code: t.code, name: t.name, isAudit: t.isAudit, outletId: null },
    });

    // Items are replaced wholesale: the template is ours, not user-edited, and
    // sortOrder is the unique key so an edit that reorders would collide.
    await prisma.checklistTemplateItem.deleteMany({ where: { templateId: template.id } });
    await prisma.checklistTemplateItem.createMany({
      data: t.items.map((item, i) => ({
        templateId: template.id,
        sortOrder: i + 1,
        label: item.label,
        requiresPhoto: item.requiresPhoto ?? false,
        requiresNote: item.requiresNote ?? false,
        failCreatesTask: item.failCreatesTask ?? false,
      })),
    });

    // One recurrence per template per outlet. TaskRecurrence has no natural
    // unique key, so match on the tuple that makes it unique in practice.
    for (const outlet of outlets) {
      const name = `${t.name} (${outlet.code})`;
      const existing = await prisma.taskRecurrence.findFirst({
        where: { templateId: template.id, outletId: outlet.id },
      });
      const data = {
        name,
        cronExpr: t.cronExpr,
        templateId: template.id,
        outletId: outlet.id,
        dueAfterMins: t.dueAfterMins,
        priority: t.isAudit ? ('HIGH' as const) : ('NORMAL' as const),
      };
      if (existing) {
        await prisma.taskRecurrence.update({ where: { id: existing.id }, data });
      } else {
        await prisma.taskRecurrence.create({ data });
      }
    }
  }
}
