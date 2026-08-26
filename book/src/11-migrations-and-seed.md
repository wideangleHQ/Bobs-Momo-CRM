# Migrations and seed data

The Prisma schema is the source of truth for the database. The migration
folder is the source of truth for how the database got there. Neither can be
edited casually, because staging and production both replay that folder from
the beginning if they ever have to be rebuilt.

## The migration workflow

Three commands do everything.

```bash
# 1. Local only. Diffs schema.prisma against your local database,
#    writes a new migration folder, applies it, regenerates the client.
bunx prisma migrate dev --name add_item_stock_reorder_level

# 2. CI, staging, production. Applies pending migrations. Never
#    generates, never resets, never prompts.
npx prisma migrate deploy

# 3. Read only. Prints what is applied and what is pending.
npx prisma migrate status
```

The local loop is: edit `schema.prisma`, run `migrate dev`, get a folder like
`prisma/migrations/20260817093012_add_item_stock_reorder_level/migration.sql`,
read the generated SQL, commit both the schema change and the folder in the
same commit. If the generated SQL is not what you expected, delete the folder,
fix the schema, and run it again. That is only safe because the database is
yours.

The deployed loop is: the CI pipeline runs `prisma migrate deploy` against
staging as a release step, the smoke tests run, and the same artifact is
promoted to production where `migrate deploy` runs again. Chapter 35 owns the
pipeline; the relevant part here is that migrations run as a separate step
before the new container serves traffic, not in the container's entrypoint,
so a failed migration fails the deploy instead of crash-looping the API.

### Why you never run migrate dev against a shared database

`migrate dev` compares the database's actual structure against the migration
history. When they disagree, it calls that drift and offers to reset the
database, which means dropping every table and replaying from migration one.
Against staging, that deletes the client's UAT data an hour before the UAT
session. Against production it ends the project.

It also generates migrations from drift, so pointing it at a database somebody
else has touched can produce a migration that encodes their half-finished
experiment. `migrate dev` is a local-only command. Treat it the way you treat
`git push --force`.

### Why DIRECT_URL exists

Two connection strings, two ports, two different jobs.

```bash
# Application traffic. Supavisor transaction-mode pooler.
DATABASE_URL="postgresql://USER:PASS@aws-0-ap-south-1.pooler.supabase.com:6543\
/postgres?pgbouncer=true&connection_limit=1"

# Migrations and introspection only. Direct to Postgres.
DIRECT_URL="postgresql://USER:PASS@db.PROJECTREF.supabase.co:5432\
/postgres?sslmode=require"
```

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Prisma uses `directUrl` for `migrate` and `db pull`, and `url` for everything
the running API does.

Point `migrate` at the pooler and it breaks in two ways. First, Prisma takes a
Postgres advisory lock for the duration of a migration so two deploys cannot
migrate at once. A transaction-mode pooler hands your next statement to a
different backend process, and advisory locks are per session, so the lock is
either lost or never released. The visible symptom is a deploy that hangs on
"Acquiring advisory lock" until it times out, and a second one that hangs
behind it. Second, the pooler rewrites and reuses sessions, so Prisma's
prepared statements collide and you get `prepared statement "s0" already
exists` partway through the DDL, leaving a half applied migration.

If you ever see a hung migration, check which URL the command used before you
touch anything else.

## Migration authoring rules

One logical change per migration. "Add the reorder level column" is one
migration. "Add the reorder level column, rename two tables and backfill task
business dates" is three, and when the third one fails at 30 percent you want
the first two already committed and durable.

Never edit a migration that has been applied anywhere shared. Prisma records a
checksum of every migration file. Change the file and `migrate deploy` refuses
to run with a failed checksum error on an environment that already applied it.
The fix is a new migration, always. This applies to a migration merged to
`main` even if you believe nobody has deployed it, because CI has.

Additive first for anything that reaches production. A change that adds a
required column with no default takes an `ACCESS EXCLUSIVE` lock and fails
outright if rows exist. Split it:

```text
  migration 1   ALTER TABLE ... ADD COLUMN "note" text NULL;
                deploy, ship the code that writes it
  migration 2   UPDATE ... SET "note" = '...' WHERE "note" IS NULL;
                run in batches, no lock held across the whole table
  migration 3   ALTER TABLE ... ALTER COLUMN "note" SET NOT NULL;
                deploy only after migration 2 reports zero remaining
```

Each step is separately revertible and each one is safe to run while the API
is serving traffic.

### Writing a data backfill in raw SQL

Prisma generates DDL, not data changes. For a backfill, create the migration
empty and write the SQL yourself:

```bash
bunx prisma migrate dev --create-only --name backfill_task_business_date
```

Then edit the generated `migration.sql`:

```sql
-- Backfill Task.businessDate for rows created before the 04:00 rule.
-- Batched so no single statement locks the table for long.
DO $$
DECLARE
  touched integer;
BEGIN
  LOOP
    UPDATE "Task" t
    SET    "businessDate" =
             (("createdAt" AT TIME ZONE 'Asia/Kolkata')
                - interval '4 hours')::date
    WHERE  t."id" IN (
      SELECT "id" FROM "Task"
      WHERE  "businessDate" IS NULL
      LIMIT  2000
    );
    GET DIAGNOSTICS touched = ROW_COUNT;
    EXIT WHEN touched = 0;
  END LOOP;
END $$;
```

Two rules for backfill SQL. Write literal column names, never Prisma model
names, and quote them, because Prisma creates camelCase identifiers that
Postgres folds to lowercase without quotes. And make it idempotent, so a retry
after a timeout does not double-apply.

### Adding an enum value safely

Postgres allows `ALTER TYPE ... ADD VALUE` inside a transaction block, but the
new value cannot be used until that transaction commits. Prisma wraps each
migration file in one transaction. So a single migration that adds
`StockTxnType.SPOILAGE` and then writes rows using it fails at the second
statement.

Split it. Migration one contains only the `ALTER TYPE`. Migration two, in a
later commit, uses the value. Prisma generates the `ALTER TYPE` for you when
you add the value to the enum in `schema.prisma` and change nothing else.

Removing an enum value is not a migration, it is a project. Postgres cannot
drop a value from an enum type. You create a new type, migrate the column, and
drop the old type, holding a table lock throughout. Add values freely, remove
them never, and let the application stop producing a value it no longer wants.

## Expand and contract, worked

Renaming `ItemStock.reorderLevel` to `reorderQty` looks like a one line schema
edit. Prisma would generate `ALTER TABLE "ItemStock" RENAME COLUMN`, which is
instant and atomic and also breaks every running instance of the old API code
the moment it commits. During a rolling deploy both versions run at once, so
the old pods start throwing `column "reorderLevel" does not exist` on the
inventory screen.

Five steps, three deploys.

```text
  step 1  EXPAND      migration: ADD COLUMN "reorderQty" numeric(14,3) NULL
                      deploy: no code change
  step 2  DUAL WRITE  code: every write sets both columns
                      deploy: reads still use reorderLevel
  step 3  BACKFILL    migration: UPDATE "ItemStock"
                        SET "reorderQty" = "reorderLevel"
                        WHERE "reorderQty" IS NULL
  step 4  SWITCH      code: all reads use reorderQty, writes still dual
                      deploy, watch for one release cycle
  step 5  CONTRACT    code: stop writing reorderLevel
                      migration: DROP COLUMN "reorderLevel"
```

Steps 1 to 3 can share a day. Step 5 waits until you are sure no rollback
target still reads the old column, which in practice means one full release
behind. If that sounds slow for a rename, it is, which is the argument for
getting column names right the first time rather than for skipping the
process.

## Migration checklist

Run this before merging any schema change.

1. `bunx prisma migrate dev` was run locally and the generated SQL was read,
   not just accepted.
2. The migration folder and the `schema.prisma` change are in the same commit.
3. No previously applied migration file was edited.
4. The change is additive, or it is split into add, backfill and enforce.
5. Any new required column has a default or is added as nullable first.
6. Every new index has a named query that needs it, stated in the PR
   description.
7. Any new unique constraint was checked against production-shaped data for
   existing violations, because the migration fails on the first duplicate.
8. A backfill, if present, is batched and idempotent.
9. An enum value addition is alone in its migration.
10. `prisma generate` output compiles: `bun run build` passes with the new
    client types.
11. The seed still runs against a fresh database: `bun run db:reset` locally.
12. Rollback is stated in the PR: either "revert the code, leave the column"
    or a named down migration written by hand.

Prisma has no automatic down migrations. Item 12 is not a formality.

## Seed strategy

Three tiers, one entry point, controlled by `SEED_TIER`.

| Tier | Runs in | Contains |
|---|---|---|
| reference | local, test, staging, production | Data the business cannot operate without |
| demo | local, staging | Fake employees, purchases, tasks and sales for screenshots and UAT rehearsal |
| fixtures | test database only | Per-suite rows created and torn down by the test itself |

Reference data ships to production and must be idempotent, because it runs on
every deploy that touches it. It covers the two outlets and their departments,
the six units, the item categories, the four checklist templates with their
items, and the role permission rows. Demo data never runs against production
and the seed refuses if `NODE_ENV === "production"` and the tier is not
`reference`. Fixtures are not in the seed at all; they live in
`apps/api/test/factories` and are described in chapter 34.

### seed.ts structure

```ts
// apps/api/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { seedUnits } from './seed/units';
import { seedCategories } from './seed/categories';
import { seedOutlets } from './seed/outlets';
import { seedDepartments } from './seed/departments';
import { seedItems } from './seed/items';
import { seedChecklistTemplates } from './seed/checklist-templates';
import { seedRolePermissions } from './seed/role-permissions';
import { seedDemo } from './seed/demo';

const prisma = new PrismaClient();

async function main() {
  const tier = process.env.SEED_TIER ?? 'reference';

  if (tier !== 'reference' && process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to run SEED_TIER=${tier} in production`);
  }

  // Order matters. Each function only depends on the ones above it.
  await seedUnits(prisma);              // no dependencies
  await seedCategories(prisma);         // no dependencies
  await seedOutlets(prisma);            // no dependencies
  await seedDepartments(prisma);        // needs outlets
  await seedItems(prisma);              // needs units + categories
  await seedChecklistTemplates(prisma); // needs nothing, outletId is null
  await seedRolePermissions(prisma);    // no dependencies

  if (tier === 'demo') await seedDemo(prisma);  // needs everything
}

main()
  .then(() => console.log('seed ok'))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

Every seed function upserts on a natural key. Never on `id`, because a UUID
generated at seed time differs per environment and you would insert duplicates
on the second run.

```ts
// apps/api/prisma/seed/outlets.ts
export async function seedOutlets(prisma: PrismaClient) {
  const outlets = [
    { code: 'BM-SAHEED', name: "Bob's Momo, Saheed Nagar",
      address: 'Saheed Nagar, Bhubaneswar, Odisha 751007' },
    { code: 'BM-PATIA',  name: "Bob's Momo, Patia",
      address: 'Patia, Bhubaneswar, Odisha 751024' },
  ];

  for (const o of outlets) {
    await prisma.outlet.upsert({
      where:  { code: o.code },
      update: { name: o.name, address: o.address },
      create: { ...o, timezone: 'Asia/Kolkata' },
    });
  }
}
```

The same shape applies to units (`where: { code }`), categories
(`where: { name }`), items (`where: { sku }`) and checklist templates
(`where: { code }`). Departments upsert on the compound
`{ outletId_name: { outletId, name } }`.

Run it with `bun run db:seed`, which is `prisma db seed` under the hood, and
reset plus reseed a local database with `bun run db:reset`.

### Reference content: outlets, departments, units

Two outlets, `BM-SAHEED` and `BM-PATIA`. Each gets four departments: Kitchen,
Counter, Store, Admin.

| Unit code | Name |
|---|---|
| KG | Kilogram |
| G | Gram |
| L | Litre |
| ML | Millilitre |
| PCS | Pieces |
| PKT | Packet |

Item categories: Vegetables, Meat and Poultry, Flour and Dry Goods, Sauces and
Condiments, Packaging, Beverages, Cleaning and Consumables.

### Reference content: starter item list

Thirty eight items, enough to run both kitchens on day one. The client extends
this through the week 1 CSV import.

| SKU | Name | Category | Unit |
|---|---|---|---|
| ITM-CABBAGE | Cabbage | Vegetables | KG |
| ITM-ONION | Onion | Vegetables | KG |
| ITM-GARLIC | Garlic | Vegetables | KG |
| ITM-GINGER | Ginger | Vegetables | KG |
| ITM-SPRING-ONION | Spring Onion | Vegetables | KG |
| ITM-CARROT | Carrot | Vegetables | KG |
| ITM-GREEN-CHILLI | Green Chilli | Vegetables | KG |
| ITM-CORIANDER | Coriander Leaves | Vegetables | KG |
| ITM-CHICKEN-MINCE | Chicken Mince | Meat and Poultry | KG |
| ITM-CHICKEN-BONELESS | Chicken Boneless | Meat and Poultry | KG |
| ITM-MUTTON-MINCE | Mutton Mince | Meat and Poultry | KG |
| ITM-EGG | Egg | Meat and Poultry | PCS |
| ITM-MAIDA | Refined Flour (Maida) | Flour and Dry Goods | KG |
| ITM-CORNFLOUR | Cornflour | Flour and Dry Goods | KG |
| ITM-MUNG-STARCH | Mung Bean Starch | Flour and Dry Goods | KG |
| ITM-NOODLE-THUKPA | Thukpa Noodles | Flour and Dry Goods | PKT |
| ITM-REFINED-OIL | Refined Oil | Flour and Dry Goods | L |
| ITM-SALT | Salt | Flour and Dry Goods | KG |
| ITM-SUGAR | Sugar | Flour and Dry Goods | KG |
| ITM-BLACK-PEPPER | Black Pepper Powder | Flour and Dry Goods | G |
| ITM-GARAM-MASALA | Garam Masala | Flour and Dry Goods | G |
| ITM-SOY-SAUCE | Soy Sauce | Sauces and Condiments | L |
| ITM-VINEGAR | Vinegar | Sauces and Condiments | L |
| ITM-CHILLI-SAUCE | Red Chilli Sauce | Sauces and Condiments | L |
| ITM-SCHEZWAN-PASTE | Schezwan Paste | Sauces and Condiments | KG |
| ITM-KETCHUP | Tomato Ketchup | Sauces and Condiments | KG |
| ITM-SESAME-OIL | Sesame Oil | Sauces and Condiments | ML |
| ITM-BOX-MOMO-6 | Momo Box 6 Piece | Packaging | PCS |
| ITM-BOX-MOMO-10 | Momo Box 10 Piece | Packaging | PCS |
| ITM-CHUTNEY-CUP | Chutney Cup 30 ml | Packaging | PCS |
| ITM-CARRY-BAG | Carry Bag | Packaging | PCS |
| ITM-TISSUE | Tissue Paper | Packaging | PKT |
| ITM-WATER-1L | Packaged Water 1 L | Beverages | PCS |
| ITM-COLA-250 | Cola 250 ml | Beverages | PCS |
| ITM-DISHWASH | Dishwash Liquid | Cleaning and Consumables | L |
| ITM-FLOOR-CLEAN | Floor Cleaner | Cleaning and Consumables | L |
| ITM-GLOVES | Hand Gloves | Cleaning and Consumables | PKT |
| ITM-GARBAGE-BAG | Garbage Bag | Cleaning and Consumables | PKT |

Everything in Vegetables and Meat and Poultry is seeded with
`isPerishable: true`. Nothing is seeded with a `reorderLevel`, because
thresholds are per outlet and the client supplies them in week 1. Null means no
alert, so a missing threshold is quiet rather than noisy.

### Reference content: checklist templates

Four templates, seeded with `outletId: null` so both outlets use them. These
are what UAT exercises on day one, so the item text is the client's language,
not ours.

`KITCHEN_OPEN`, name "Kitchen opening checklist", `isAudit: false`:

| # | Item | Flags |
|---|---|---|
| 1 | Deep freezer temperature recorded, below -18 C | note |
| 2 | Chiller temperature recorded, between 0 and 4 C | note |
| 3 | Gas connection and burners checked, no leak smell | fail creates task |
| 4 | Last night's closing stock matches physical count | fail creates task |
| 5 | Steamers washed and water refilled | |
| 6 | Chutney and sauce batches labelled with prep date | photo |
| 7 | Staff in clean uniform, hair covered, nails checked | |
| 8 | Prep counters and floor sanitised before first prep | photo |
| 9 | Opening stock entered in the system for tracked items | |

`KITCHEN_CLOSE`, name "Kitchen closing checklist", `isAudit: false`:

| # | Item | Flags |
|---|---|---|
| 1 | Closing stock count entered for all tracked items | |
| 2 | Day's wastage recorded with reason | note |
| 3 | Steamers, tawa and fryer cleaned and dried | photo |
| 4 | Perishables moved to chiller, freezer door sealed | |
| 5 | Gas turned off at the regulator | fail creates task |
| 6 | Chutney containers washed, leftovers discarded | |
| 7 | Bins emptied and liners replaced | |
| 8 | Exhaust and lights off, shutter locked | fail creates task |
| 9 | Daily sales entry submitted for the day | |

`CLEANING_DAILY`, name "Daily cleaning checklist", `isAudit: false`:

| # | Item | Flags |
|---|---|---|
| 1 | Dining tables and chairs wiped | |
| 2 | Customer washroom cleaned and stocked | photo |
| 3 | Floor mopped with sanitiser | photo |
| 4 | Chiller and freezer handles sanitised | |
| 5 | Prep counters degreased | |
| 6 | Waste segregated, wet and dry separated | |
| 7 | Dishwash area cleared, no utensils left soaking | |

`EQUIPMENT_WEEKLY`, name "Weekly equipment audit", `isAudit: true`:

| # | Item | Flags |
|---|---|---|
| 1 | Steamer descaled, gasket checked | photo, fail creates task |
| 2 | Fryer oil filtered or replaced, condition noted | note |
| 3 | Week's chiller and freezer temperature log reviewed | note |
| 4 | Exhaust hood filters degreased | photo |
| 5 | Gas pipe and regulator inspected for cracks | fail creates task |
| 6 | Weighing scale checked against a 1 KG test weight | fail creates task |
| 7 | Fire extinguisher gauge in green, service date valid | fail creates task |
| 8 | First aid box stocked and in date | |
| 9 | Electrical points and wiring visually checked | fail creates task |

`EQUIPMENT_WEEKLY` is also seeded with a `TaskRecurrence` on
`cronExpr: "0 11 * * 1"`, Monday at 11:00 IST, one per outlet. The three daily
templates get recurrences at 07:00, 23:00 and 15:00 respectively.

## Client data onboarding

The client owes three CSV files in week 1. The importer lives behind
`POST /api/v1/admin/import/{items|vendors|employees}`, requires
`admin.import.run`, and always runs in dry-run mode first.

> **Spec note:** `admin.import.run` is not in the permission list in
> chapter 14. It belongs to `OWNER` only.

### items.csv

```text
sku,name,category,unit,is_perishable,reorder_saheed,reorder_patia
ITM-CHICKEN-MINCE,Chicken Mince,Meat and Poultry,KG,true,8.000,6.000
```

`sku` must match `^ITM-[A-Z0-9-]{2,40}$` and is the upsert key. `category` and
`unit` must already exist by exact name and code; the importer does not create
reference data, because a typo would otherwise create a category called
"Vegetabels" and split the reports. `is_perishable` accepts `true`, `false`,
`yes`, `no`, `1`, `0`. The two reorder columns are optional and accept up to
three decimals; they write `ItemStock` rows for the matching outlet, creating
the row with `qtyOnHand: 0` if it does not exist yet.

### vendors.csv

```text
name,phone,email,gstin,address,supplies_skus
Saheed Nagar Poultry,9437012345,,21ABCDE1234F1Z5,"Plot 42, Saheed Nagar",ITM-CHICKEN-MINCE|ITM-EGG
```

`name` is the upsert key and must be unique within the file as well as in the
database, so a file containing the same vendor twice is rejected on the second
occurrence rather than silently merged. `phone` must be ten digits with no
country code or spaces. `gstin` is optional and, when present, must match the
15 character GSTIN pattern. `supplies_skus` is pipe separated and every SKU
must already exist; unknown SKUs reject the row rather than being skipped,
because a partly linked vendor is worse than an unlinked one.

### employees.csv

```text
employee_code,full_name,phone,outlet_code,department,designation,joined_on,role_key,username
BM-EMP-0007,Rakesh Behera,9437098765,BM-SAHEED,Kitchen,Momo Chef,2024-11-04,KITCHEN_STAFF,rakesh.behera
```

`employee_code` matches `^BM-EMP-\d{4}$` and is the upsert key. `outlet_code`
must be `BM-SAHEED` or `BM-PATIA`. `department` must exist at that outlet.
`joined_on` is `YYYY-MM-DD` and must not be in the future. `role_key` must be
one of the nine `RoleKey` values, spelled exactly. `username` is optional: when
present the importer creates a `User` with a random password, `mustReset:
true`, and prints the temporary credential once in the import report; when
absent the employee exists with no login, which is correct for staff who will
never use the system directly.

### What the importer does with a bad row

Each row is validated in full, then written in its own transaction. A row
either lands completely or not at all. There is no state in which an employee
exists without their `User`, or an item exists without the `ItemStock` rows its
reorder columns asked for.

```text
  read row ──▶ parse ──▶ validate ──▶ resolve refs ──▶ tx: write row
                 │          │              │                 │
                 └── fail ──┴──── fail ────┴───── fail ──────┘
                                     │
                                     ▼
                   append to rejects[] with line number,
                   column name and reason, continue
```

The response is a report, never a bare 200:

```json
{
  "dryRun": true,
  "total": 214,
  "imported": 209,
  "rejected": 5,
  "rejects": [
    { "line": 17, "column": "unit", "value": "Kgs",
      "reason": "UNKNOWN_UNIT", "message": "No unit with code Kgs" },
    { "line": 42, "column": "sku", "value": "ITM CHICKEN MINCE",
      "reason": "INVALID_SKU", "message": "SKU may not contain spaces" }
  ]
}
```

Line numbers are the numbers the client sees in Excel, counting the header as
line 1, because the person fixing the file is not an engineer. The rejects
array is also returned as a downloadable CSV with the original columns plus a
`reason` column, so the client fixes that file and re-uploads it. Re-uploading
is safe: every import upserts on the natural key, so rows that already landed
are updated to the same values rather than duplicated.

The importer never partially writes a row, never guesses at a missing
reference, and never continues past 50 percent rejects. A file that bad is a
column mapping error, and importing the good half of it makes the mess harder
to clean up than starting again.
