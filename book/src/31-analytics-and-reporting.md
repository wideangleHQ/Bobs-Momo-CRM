# Analytics and reporting

The SRS has a second gap in the same area as the first. Its Management and
Analytics section is a six row table: a report name in one column and a
dependency sentence in the other. That is the entire specification. There are no
functional requirement ids, no field lists, no formulas and no acceptance
tests. The module list commits the dashboard, the week 3 plan commits the
reports, and the traceability matrix maps the client requirement "Business
reporting (sales, inventory, performance, rewards, P&L, waste)" onto "Section
13", which contains no analytics requirement at all.

Acceptance criterion 1 says all Must-Have functional requirements are
implemented and pass functional testing. A report with no requirement id has
nothing to pass. This chapter writes the missing specifications so that each of
the six reports and the dashboard has a definition precise enough to test
against.

## What the reports read

Every number in this chapter comes from one of six tables. None of them is a
purpose built reporting table. There is no warehouse, no materialised view and
no ETL in Phase 1.

```text
   DailySalesEntry ──────┬──▶ 1. Daily sales summary
   one row per outlet    │
   per business date     ├──▶ 5. P&L overview (revenue side)
                         │
   Purchase (RECORDED) ──┘         (cost side)
   totalAmount per PO

   StockTransaction ─────┬──▶ 2. Inventory consumption
   ISSUED + WASTAGE      │        (ISSUED + WASTAGE)
                         └──▶ 6. Waste analysis
   ItemPriceHistory ──────────▶      (WASTAGE, valued)

   Task ─────────────────┬──▶ 3. Employee performance
   AttendanceDay ────────┘

   GamePlay ─────────────┬──▶ 4. Customer game and reward trends
   RewardIssue ──────────┘        (see chapter 32 scope risk)
```

Prisma maps model names straight to table names with no `@@map` in the schema,
so every identifier in the SQL below is double quoted PascalCase. Copy the
queries as they are written or Postgres will fold them to lower case and fail.

Every query takes the caller's outlet scope as a uuid array parameter. That
array comes from `OutletGuard`, never from the query string, so a report cannot
be widened by editing a URL.

## 1. Daily sales summary

The question it answers is "what did each outlet do yesterday, and is that good
or bad". The owner reads it every morning. The operations manager reads it on
Monday against the week.

Source is `DailySalesEntry` alone. Date range is inclusive on both ends and both
bounds are business dates under the 04:00 IST rule from
[chapter 12](12-data-scoping-and-integrity.md).

```sql
WITH daily AS (
  SELECT s."businessDate"      AS business_date,
         s."outletId"          AS outlet_id,
         SUM(s."netSales")     AS net_sales,
         SUM(s."grossSales")   AS gross_sales,
         SUM(s."discounts")    AS discounts,
         SUM(s."cashAmount")   AS cash,
         SUM(s."upiAmount")    AS upi,
         SUM(s."cardAmount")   AS card,
         SUM(s."otherAmount")  AS other,
         SUM(s."orderCount")   AS order_count
  FROM "DailySalesEntry" s
  WHERE s."businessDate" BETWEEN ($1::date - 7) AND $2::date
    AND s."outletId" = ANY($3::uuid[])
  GROUP BY 1, 2
)
SELECT d.business_date, d.outlet_id,
       d.net_sales, d.gross_sales, d.discounts,
       d.cash, d.upi, d.card, d.other, d.order_count,
       ROUND(d.net_sales / NULLIF(d.order_count, 0), 2) AS avg_order_value,
       p.net_sales AS prev_day_net,
       w.net_sales AS same_day_last_week_net
FROM daily d
LEFT JOIN daily p ON p.outlet_id = d.outlet_id
                 AND p.business_date = d.business_date - 1
LEFT JOIN daily w ON w.outlet_id = d.outlet_id
                 AND w.business_date = d.business_date - 7
WHERE d.business_date BETWEEN $1::date AND $2::date
ORDER BY d.business_date DESC, d.outlet_id;
```

The CTE deliberately reads seven days further back than the requested window and
the outer `WHERE` trims the result. Without that, the first day of any window
has no comparison rows and the screen shows two empty columns for no reason the
user can see.

The combined view is the same query with `outlet_id` dropped from both
`GROUP BY` and the join conditions.

| Filter | Values |
|---|---|
| `from`, `to` | Business dates, `YYYY-MM-DD` |
| `outletId` | Single outlet, or omitted for every outlet in scope |
| `groupBy` | `outlet` (default) or `combined` |

Output shape:

```json
{
  "range": { "from": "2026-08-19", "to": "2026-08-25" },
  "rows": [
    {
      "businessDate": "2026-08-25",
      "outletId": "c1a4...", "outletCode": "BM-SAHEED",
      "netSales": "61250.00", "grossSales": "62480.00",
      "discounts": "1230.00", "orderCount": 412,
      "avgOrderValue": "148.67",
      "paymentMix": { "cash": "18400.00", "upi": "39850.00",
                      "card": "3000.00", "other": "0.00" },
      "prevDayNet": "58900.00", "prevDayChangePct": 3.99,
      "sameDayLastWeekNet": "56610.00", "sameDayLastWeekChangePct": 8.20
    }
  ],
  "missingDates": ["2026-08-21"]
}
```

On screen this is a grouped bar chart of net sales by day with one series per
outlet, a stacked bar for payment mix, and a table below carrying the
comparisons. CSV export columns are `business_date, outlet_code, gross_sales,
discounts, net_sales, order_count, avg_order_value, cash, upi, card, other`.

Caveats. A missing entry produces `null` comparisons, not zero, and the UI must
render "no data" rather than a minus 100 percent drop. `missingDates` is in the
payload so the screen can say so once at the top instead of per row. Average
order value is null wherever `orderCount` is null, and the average of the
averages is never computed; the combined figure divides combined net sales by
combined order count.

## 2. Inventory consumption

The question is "how much of each ingredient did we actually use, and is that
rising". The inventory manager reads it weekly to set reorder levels. The owner
reads it against sales when something looks off.

Source is `StockTransaction` where `type` is `ISSUED` or `WASTAGE`. Both count,
because stock that went in the bin left the shelf just as surely as stock that
went in a momo. The report separates them so the reader can see which.

```sql
SELECT t."itemId"                                            AS item_id,
       i."name"                                              AS item_name,
       i."sku"                                               AS sku,
       u."code"                                              AS unit_code,
       c."name"                                              AS category_name,
       t."outletId"                                          AS outlet_id,
       SUM(t."quantity") FILTER (WHERE t."type" = 'ISSUED')  AS issued_qty,
       SUM(t."quantity") FILTER (WHERE t."type" = 'WASTAGE') AS wastage_qty,
       SUM(t."quantity")                                     AS consumed_qty
FROM "StockTransaction" t
JOIN "InventoryItem" i ON i."id" = t."itemId"
JOIN "Unit"          u ON u."id" = i."unitId"
JOIN "ItemCategory"  c ON c."id" = i."categoryId"
WHERE t."type" IN ('ISSUED', 'WASTAGE')
  AND t."businessDate" BETWEEN $1::date AND $2::date
  AND t."outletId" = ANY($3::uuid[])
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY consumed_qty DESC
LIMIT 20;
```

The per-day series for one item, which is what the drill-through chart draws:

```sql
SELECT t."businessDate" AS business_date,
       SUM(t."quantity") FILTER (WHERE t."type" = 'ISSUED')  AS issued_qty,
       SUM(t."quantity") FILTER (WHERE t."type" = 'WASTAGE') AS wastage_qty
FROM "StockTransaction" t
WHERE t."itemId" = $4::uuid
  AND t."type" IN ('ISSUED', 'WASTAGE')
  AND t."businessDate" BETWEEN $1::date AND $2::date
  AND t."outletId" = ANY($3::uuid[])
GROUP BY 1
ORDER BY 1;
```

The category rollup keeps `unit_code` in the `GROUP BY`:

```sql
SELECT c."name" AS category_name, u."code" AS unit_code,
       SUM(t."quantity") AS consumed_qty
FROM "StockTransaction" t
JOIN "InventoryItem" i ON i."id" = t."itemId"
JOIN "Unit"          u ON u."id" = i."unitId"
JOIN "ItemCategory"  c ON c."id" = i."categoryId"
WHERE t."type" IN ('ISSUED', 'WASTAGE')
  AND t."businessDate" BETWEEN $1::date AND $2::date
  AND t."outletId" = ANY($3::uuid[])
GROUP BY 1, 2
ORDER BY 1, 2;
```

That is not a stylistic choice. Adding 40 kilograms of cabbage to 600 pieces of
packaging produces the number 640, which means nothing. Grouping by unit as well
as category makes the API return "Vegetables: 128.500 KG" and "Packaging: 4,200
PCS" as separate rows, and the screen shows them as separate rows.

| Filter | Values |
|---|---|
| `from`, `to` | Business dates. Maximum span 92 days |
| `outletId` | Single outlet or all in scope |
| `categoryId` | Optional |
| `itemId` | Optional, switches the response to the per-day series |
| `type` | `ALL` (default), `ISSUED`, `WASTAGE` |

Chart is a horizontal bar for the top 20 and a line chart for the per-day
series. CSV columns are `sku, item_name, category_name, unit_code, outlet_code,
issued_qty, wastage_qty, consumed_qty`.

Caveats. This measures what staff recorded as issued, not what the kitchen
physically used. An outlet that issues 10 kg at 11:00 and returns 2 kg to the
fridge without recording an `ADJUSTMENT` shows 10 kg of consumption. Quantities
are `Decimal(14, 3)` in each item's own unit and are never converted between
units, because the schema holds no conversion factors. `ADJUSTMENT`,
`TRANSFER_OUT` and `CLOSING` rows are excluded on purpose: an adjustment is a
correction to the count, not consumption, and a transfer moves stock rather than
consuming it.

## 3. Employee performance

The question is "who is reliable". The store manager reads it before writing a
roster. HR reads it at appraisal time. This is the report most likely to be
argued with, so its denominators are written out here in full.

Source is `Task` and `AttendanceDay`.

```sql
WITH task_stats AS (
  SELECT t."assigneeId" AS employee_id,
         COUNT(*) FILTER (
           WHERE t."status" <> 'CANCELLED')              AS assigned,
         COUNT(*) FILTER (
           WHERE t."status" IN ('COMPLETED','VERIFIED')) AS completed,
         COUNT(*) FILTER (
           WHERE t."status" IN ('COMPLETED','VERIFIED')
             AND t."dueAt" IS NOT NULL)                  AS due_bearing,
         COUNT(*) FILTER (
           WHERE t."status" IN ('COMPLETED','VERIFIED')
             AND t."dueAt" IS NOT NULL
             AND t."completedAt" <= t."dueAt")           AS on_time,
         AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."dueAt")) / 60)
           FILTER (
             WHERE t."status" IN ('COMPLETED','VERIFIED')
               AND t."dueAt" IS NOT NULL
               AND t."completedAt" > t."dueAt")          AS avg_delay_mins
  FROM "Task" t
  WHERE t."assigneeId" IS NOT NULL
    AND t."businessDate" BETWEEN $1::date AND $2::date
    AND t."outletId" = ANY($3::uuid[])
  GROUP BY 1
),
attendance_stats AS (
  SELECT a."employeeId" AS employee_id,
         COUNT(*) FILTER (
           WHERE a."status" NOT IN ('WEEKLY_OFF','ON_LEAVE'))
                                                        AS expected_days,
         SUM(CASE a."status" WHEN 'PRESENT'  THEN 1.0
                             WHEN 'HALF_DAY' THEN 0.5
                             ELSE 0 END)                 AS present_days,
         COUNT(*) FILTER (WHERE a."lateMins" > $4::int)  AS late_count
  FROM "AttendanceDay" a
  WHERE a."businessDate" BETWEEN $1::date AND $2::date
    AND a."outletId" = ANY($3::uuid[])
  GROUP BY 1
)
SELECT e."id", e."employeeCode", e."fullName",
       COALESCE(ts.assigned, 0)  AS tasks_assigned,
       COALESCE(ts.completed, 0) AS tasks_completed,
       ROUND(ts.completed::numeric / NULLIF(ts.assigned, 0), 4)
                                 AS completion_rate,
       ROUND(ts.on_time::numeric / NULLIF(ts.due_bearing, 0), 4)
                                 AS on_time_rate,
       ROUND(ts.avg_delay_mins::numeric, 1)
                                 AS avg_delay_mins,
       ROUND(ast.present_days / NULLIF(ast.expected_days, 0), 4)
                                 AS attendance_consistency,
       COALESCE(ast.late_count, 0) AS late_count
FROM "Employee" e
LEFT JOIN task_stats       ts  ON ts.employee_id  = e."id"
LEFT JOIN attendance_stats ast ON ast.employee_id = e."id"
WHERE e."outletId" = ANY($3::uuid[])
  AND e."status" = 'ACTIVE'
ORDER BY completion_rate DESC NULLS LAST;
```

`$4` is the late threshold in minutes, from `ATTENDANCE_LATE_THRESHOLD_MINS`,
default 10. It is a parameter rather than a constant because "late" is a
business judgement the client will want to move after a fortnight of real data.

The denominator rules, which are the whole report:

| Metric | Numerator | Denominator |
|---|---|---|
| Completion rate | Tasks in `COMPLETED` or `VERIFIED` | Tasks assigned to the employee in the window, excluding `CANCELLED` |
| On-time rate | Completed tasks where `completedAt <= dueAt` | Completed tasks that have a `dueAt` |
| Average delay | Sum of minutes past `dueAt` | Count of completed tasks finished after `dueAt` |
| Attendance consistency | `PRESENT` days plus half a day per `HALF_DAY` | Days with an `AttendanceDay` row that is not `WEEKLY_OFF` or `ON_LEAVE` |
| Late count | Days where `lateMins` exceeds the threshold | Not a rate, a count |

The trap is `CANCELLED`. A manager cancels a task for reasons that have nothing
to do with the assignee: the delivery did not arrive, the outlet shut early, the
task was a duplicate. If cancelled tasks stayed in the denominator, a manager
tidying up their own backlog would push a staff member's score down, and the
first person to notice would be the staff member whose appraisal it affected.
`CANCELLED` is excluded from both numerator and denominator. `OVERDUE` is not
excluded from the denominator, because an overdue task is a task the assignee
still has not done.

Tasks with no `dueAt` are counted in the completion rate and excluded from the
on-time rate. A task with no deadline cannot be late.

Output carries one row per employee. On screen it is a sortable table with a
small bar for each rate, not a chart. CSV columns are `employee_code, full_name,
outlet_code, tasks_assigned, tasks_completed, completion_rate, on_time_rate,
avg_delay_mins, attendance_consistency, late_count`.

Caveats. `AttendanceDay` rows only exist for days the rollup job created them,
so an employee who joined mid window has a shorter denominator, which is correct
but surprising. An employee with zero assigned tasks gets `null` rates, not
zero, and the table sorts nulls last. This report is not evidence for a
disciplinary process on its own; it is a prompt to go and look.

## 4. Customer game and reward trends

The question is "is the game doing anything for the business". The owner reads
it. This report depends entirely on [chapter 32](32-customer-crm-and-game.md), which documents why the customer
CRM is the largest scope risk in the project. If that module is deferred, this
report and the `GET /analytics/crm` endpoint are deferred with it.

Source is `GamePlay` and `RewardIssue`.

```sql
SELECT d::date                                  AS day,
       COUNT(p."id")                            AS plays,
       COUNT(DISTINCT p."customerId")           AS unique_customers,
       COUNT(DISTINCT p."sessionKey")           AS unique_sessions,
       COALESCE(SUM(p."coinsEarned"), 0)        AS coins_issued
FROM generate_series($1::date, $2::date, INTERVAL '1 day') d
LEFT JOIN "GamePlay" p
       ON (p."playedAt" AT TIME ZONE 'Asia/Kolkata')::date = d::date
      AND ($3::uuid IS NULL OR p."gameId" = $3::uuid)
GROUP BY 1
ORDER BY 1;
```

```sql
SELECT COUNT(*)                                             AS issued,
       COUNT(*) FILTER (WHERE r."status" = 'REDEEMED')      AS redeemed,
       COUNT(*) FILTER (WHERE r."status" = 'EXPIRED')       AS expired,
       COUNT(*) FILTER (WHERE r."status" = 'VOIDED')        AS voided,
       ROUND(COUNT(*) FILTER (WHERE r."status" = 'REDEEMED')::numeric
             / NULLIF(COUNT(*), 0), 4)                      AS redemption_rate
FROM "RewardIssue" r
WHERE (r."createdAt" AT TIME ZONE 'Asia/Kolkata')::date
      BETWEEN $1::date AND $2::date;
```

`GamePlay` has no `businessDate` column, so the day bucket comes from converting
`playedAt` to Asia/Kolkata. That bucket is a calendar day, not the 04:00 trading
day used everywhere else in this book. A customer playing at 01:30 belongs to
that calendar date, because they are not part of any outlet's trade. This is the
one place in the system where "day" means something different, and the tooltip
says so.

`generate_series` produces a row for every day in the window whether or not
anyone played, which keeps the line chart honest about quiet days.

| Filter | Values |
|---|---|
| `from`, `to` | Calendar dates in IST. Maximum span 366 days |
| `gameId` | Optional, filters plays to one game |

Chart is a dual line for plays and unique players, with coins issued as a bar
behind it, and a single donut for issued against redeemed. CSV columns are
`day, plays, unique_customers, unique_sessions, coins_issued`.

Caveats. Redemption rate on a recent window understates reality, because a
coupon issued yesterday has thirty days to be used and is counted in the
denominator today. The screen labels the figure "redemption rate to date" and
offers a second figure computed only over coupons whose `expiresAt` has passed,
which is the settled number. `unique_sessions` counts guests and identified
customers together and is always at least as large as `unique_customers`.

## 5. P&L overview

Be plain about this one. With no recipe or bill of materials, and no POS line
items, a true profit and loss statement is not possible in Phase 1. The system
does not know what a plate of steamed chicken momo costs to make. It knows what
the outlet sold in total and what the outlet bought in total.

What is delivered is a gross margin approximation: total net sales from
`DailySalesEntry` minus total recorded purchase cost from `Purchase` over the
same window, per outlet, with wastage value shown as a separate line rather than
folded into the margin.

```sql
WITH sales AS (
  SELECT s."outletId" AS outlet_id,
         SUM(s."netSales") AS net_sales,
         COUNT(*)          AS days_with_entry
  FROM "DailySalesEntry" s
  WHERE s."businessDate" BETWEEN $1::date AND $2::date
    AND s."outletId" = ANY($3::uuid[])
  GROUP BY 1
),
purchase AS (
  SELECT p."outletId" AS outlet_id,
         SUM(p."totalAmount") AS purchase_cost
  FROM "Purchase" p
  WHERE p."status" = 'RECORDED'
    AND p."purchaseDate" BETWEEN $1::date AND $2::date
    AND p."outletId" = ANY($3::uuid[])
  GROUP BY 1
),
waste AS (
  SELECT t."outletId" AS outlet_id,
         SUM(t."quantity" * COALESCE(px."unitPrice", 0)) AS wastage_value
  FROM "StockTransaction" t
  LEFT JOIN LATERAL (
    SELECT h."unitPrice" FROM "ItemPriceHistory" h
    WHERE h."itemId" = t."itemId" AND h."observedOn" <= t."businessDate"
    ORDER BY h."observedOn" DESC, h."createdAt" DESC LIMIT 1
  ) px ON TRUE
  WHERE t."type" = 'WASTAGE'
    AND t."businessDate" BETWEEN $1::date AND $2::date
    AND t."outletId" = ANY($3::uuid[])
  GROUP BY 1
)
SELECT o."id", o."code",
       COALESCE(s.net_sales, 0)                      AS net_sales,
       COALESCE(pu.purchase_cost, 0)                 AS purchase_cost,
       COALESCE(s.net_sales, 0) - COALESCE(pu.purchase_cost, 0)
                                                     AS gross_margin_approx,
       ROUND((COALESCE(s.net_sales, 0) - COALESCE(pu.purchase_cost, 0))
             / NULLIF(s.net_sales, 0), 4)            AS gross_margin_pct,
       COALESCE(w.wastage_value, 0)                  AS wastage_value,
       COALESCE(s.days_with_entry, 0)                AS days_with_entry
FROM "Outlet" o
LEFT JOIN sales    s  ON s.outlet_id  = o."id"
LEFT JOIN purchase pu ON pu.outlet_id = o."id"
LEFT JOIN waste    w  ON w.outlet_id  = o."id"
WHERE o."id" = ANY($3::uuid[])
ORDER BY o."code";
```

What it includes: net sales as entered by the outlet, and the total value of
purchases recorded against that outlet with a `RECORDED` status in the same
window. Voided and draft purchases are excluded.

What it excludes, and the screen lists these by name under the figure:

| Excluded cost | Why |
|---|---|
| Labour and salaries | `SalaryRecord` stores structure only. No payroll computation exists (Q4 in [chapter 04](04-decisions-register.md)) |
| Rent and utilities | No expense ledger exists in the schema |
| Packaging and consumables actually used | Purchases are counted when bought, not when consumed |
| Delivery aggregator commission | Not captured anywhere. `otherAmount` holds the settled amount, not the gross |
| Taxes | `Purchase.taxAmount` is captured on the cost side but no sales tax breakdown exists |
| Opening and closing inventory value | No stock valuation, so purchase cost is cash out, not cost of goods sold |

That last row is the one that changes how the number behaves. Because purchases
are counted on the day they are recorded, a single large delivery on the last
day of a window pushes that window's margin down and the next window's margin
up, without anything about the business having changed. Over a full month the
distortion mostly cancels. Over a week it does not.

The screen carries the caveat in the page header, not in a footnote and not
behind a tooltip:

```text
+--------------------------------------------------------------------------+
|  P&L overview  ·  01 Aug 2026 to 25 Aug 2026  ·  BM-SAHEED                |
+--------------------------------------------------------------------------+
|  APPROXIMATION. Net sales entered by the outlet, less purchases recorded  |
|  in the same period. Excludes labour, rent, utilities, taxes, aggregator  |
|  commission and inventory valuation. Not an accounting P&L.               |
+--------------------------------------------------------------------------+
|  Net sales            Rs 8,12,940      Purchases        Rs 4,91,220       |
|  Gross margin (approx) Rs 3,21,720     Margin %              39.6%        |
|  Wastage value (approx)  Rs 14,380     Days with entry        25 of 25    |
+--------------------------------------------------------------------------+
```

Chart is a simple two bar comparison per outlet with the margin as a labelled
gap. CSV columns are `outlet_code, from, to, net_sales, purchase_cost,
gross_margin_approx, gross_margin_pct, wastage_value, days_with_entry`.

Phase 2 needs four things before this becomes a real P&L: a recipe or bill of
materials per menu item, POS line items so revenue can be attributed to dishes,
an expense ledger for the fixed costs listed above, and inventory valuation so
cost of goods sold can be computed from consumption rather than from purchasing.
Three of those four are data the client does not currently record anywhere.

## 6. Waste analysis

The question is "what are we throwing away and why". The kitchen manager reads
it weekly. The owner reads the value.

Source is `StockTransaction` where `type` is `WASTAGE`. `reason` is mandatory on
wastage rows, which is what makes the grouping useful.

```sql
SELECT i."sku", i."name"       AS item_name,
       c."name"                AS category_name,
       u."code"                AS unit_code,
       t."outletId"            AS outlet_id,
       t."reason"              AS reason,
       SUM(t."quantity")       AS wastage_qty,
       ROUND(SUM(t."quantity" * COALESCE(px."unitPrice", 0)), 2)
                               AS approx_value,
       COUNT(*)                AS event_count,
       BOOL_OR(px."unitPrice" IS NULL) AS has_unpriced_rows
FROM "StockTransaction" t
JOIN "InventoryItem" i ON i."id" = t."itemId"
JOIN "ItemCategory"  c ON c."id" = i."categoryId"
JOIN "Unit"          u ON u."id" = i."unitId"
LEFT JOIN LATERAL (
  SELECT h."unitPrice"
  FROM "ItemPriceHistory" h
  WHERE h."itemId" = t."itemId"
    AND h."observedOn" <= t."businessDate"
  ORDER BY h."observedOn" DESC, h."createdAt" DESC
  LIMIT 1
) px ON TRUE
WHERE t."type" = 'WASTAGE'
  AND t."businessDate" BETWEEN $1::date AND $2::date
  AND t."outletId" = ANY($3::uuid[])
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY approx_value DESC NULLS LAST;
```

The `LATERAL` subquery picks the most recent `ItemPriceHistory` row observed on
or before the wastage date. Using the price as at the date rather than today's
price keeps a six month old report from re-pricing itself every time someone
opens it.

| Filter | Values |
|---|---|
| `from`, `to` | Business dates. Maximum span 92 days |
| `outletId` | Single outlet or all in scope |
| `categoryId`, `itemId` | Optional |
| `groupBy` | `item` (default), `category`, `reason` |

Chart is a treemap by value with `reason` as the second level, or a bar chart
where a treemap is overkill for eight rows. CSV columns are `sku, item_name,
category_name, unit_code, outlet_code, reason, wastage_qty, approx_value,
event_count`.

Caveats, and this is the one to say out loud in UAT. `approx_value` is not FIFO
costing and is not an accounting valuation. It multiplies the wasted quantity by
the latest observed purchase price for that item, from any vendor, on or before
the wastage date. If the item has never been purchased through the system,
`unitPrice` is null, the row contributes zero to the value, and
`has_unpriced_rows` is true so the screen can show a count of unpriced rows
instead of quietly understating the total. Wastage recorded against a
sub-recipe, for example thirty prepared momo binned at close, is valued at the
raw item price of whatever the operator selected, which is usually wrong and
always low.

## The dashboard

Three audiences, three different first screens, one endpoint. The variant is
chosen server side from the caller's `roleKey`, not from a query parameter, so a
staff member cannot request the owner view.

### Owner dashboard

| Order | Tile | Metric | Window | Source | Drill-through |
|---|---|---|---|---|---|
| 1 | Net sales today | Sum of `netSales` per outlet and combined | Current business date | `DailySalesEntry` | `GET /analytics/sales` |
| 2 | Net sales month to date | Sum plus percent against the same range last month | 1st to today | `DailySalesEntry` | `GET /analytics/sales` |
| 3 | Missing sales entries | Count of active outlets with no row | Last 7 days | `DailySalesEntry`, `Outlet` | Sales entry screen |
| 4 | Gross margin approximation | Net sales less recorded purchases | Month to date | `DailySalesEntry`, `Purchase` | `GET /analytics/pnl` |
| 5 | Low stock items | Count where `qtyOnHand` is below `reorderLevel` | Live | `ItemStock` | Inventory screen |
| 6 | Overdue tasks | Count in `OVERDUE`, split by outlet | Live | `Task` | Task list |
| 7 | Wastage value | Approximate value | Month to date | `StockTransaction`, `ItemPriceHistory` | `GET /analytics/waste` |
| 8 | Pending approvals | Purchase requests plus leave requests in `PENDING` | Live | `PurchaseRequest`, `LeaveRequest` | Approvals screen |
| 9 | Game and reward activity | Plays and coupons redeemed | Last 7 days | `GamePlay`, `RewardIssue` | `GET /analytics/crm` |

```text
+--------------------------------------------------------------------------+
| Bob's Momo            Mon 25 Aug 2026                Bob R.  (Owner)      |
+--------------------------------------------------------------------------+
| NET SALES TODAY        | NET SALES MTD          | MISSING ENTRIES         |
| Rs 1,12,430            | Rs 14,82,310           | 1 in last 7 days        |
| SAHEED  61,250         | +6.1% vs last month    | PATIA  21 Aug           |
| PATIA   51,180         | 49 of 50 days entered  | [ enter now ]           |
| +8.2% vs same day LW   |                        |                         |
+------------------------+------------------------+-------------------------+
| GROSS MARGIN (APPROX)  | LOW STOCK              | OVERDUE TASKS           |
| Rs 5,73,940   38.7%    | 6 items                | 4                       |
| approximation only,    | 4 SAHEED / 2 PATIA     | 2 SAHEED / 2 PATIA      |
| see P&L overview       | [ view ]               | [ view ]                |
+------------------------+------------------------+-------------------------+
| WASTAGE MTD            | PENDING APPROVALS      | GAME (7 DAYS)           |
| Rs 27,910  approx      | 3 purchase / 2 leave   | 214 plays  31 coupons   |
| top: paneer, cabbage   | [ review ]             | 11 redeemed  35.5%      |
+------------------------+------------------------+-------------------------+
| NET SALES, LAST 14 DAYS                                                   |
|   Rs                                                                      |
|  70k |          ##        ##                                    ##        |
|  50k |    ##  ##  ##  ##  ##  ##    ##  ##  ##  ##  ##  ##  ##  ##        |
|  30k |  ##  ##  ##  ##  ##  ##  ##  ##  ##  ##  ##  ##  ##  ##            |
|      +--------------------------------------------------------------      |
|        12  13  14  15  16  17  18  19  20  21  22  23  24  25             |
+--------------------------------------------------------------------------+
```

### Operations and store manager dashboard

| Order | Tile | Metric | Window | Source | Drill-through |
|---|---|---|---|---|---|
| 1 | Today's sales entry | Entered or not, with the figure if present | Current business date | `DailySalesEntry` | Sales entry screen |
| 2 | Open and overdue tasks | Counts by status for the outlet | Live | `Task` | Task list |
| 3 | Checklists due today | Open `CHECKLIST_RUN` tasks | Current business date | `Task` | Checklist runner |
| 4 | Who is in | Employees with an open punch, on break, absent | Live | `AttendanceDay`, `BreakLog` | Attendance screen |
| 5 | Low stock items | Items below reorder level at this outlet | Live | `ItemStock` | Inventory screen |
| 6 | Pending leave requests | `PENDING` count for the outlet | Live | `LeaveRequest` | Leave screen |
| 7 | Failed audit items | `FAIL` results in the last 7 days | 7 days | `TaskChecklistResult` | Audit detail |
| 8 | Wastage this week | Quantity and approximate value | 7 days | `StockTransaction` | `GET /analytics/waste` |

A store manager sees only their own outlet. An operations manager sees the same
tiles with an outlet switcher and a combined option.

### Staff home

| Order | Tile | Metric | Window | Source | Drill-through |
|---|---|---|---|---|---|
| 1 | Punch status | In, out, or on break, with today's worked minutes | Today | `AttendanceDay` | Punch action |
| 2 | My tasks today | Open and overdue tasks assigned to me | Current business date | `Task` | Task detail |
| 3 | My checklist | The checklist run assigned to me, if any | Current business date | `Task` | Checklist runner |
| 4 | My shift | Start and end times for today and tomorrow | 2 days | `Shift` | Roster |
| 5 | My leave | Status of any pending request, balance of approved days | Current month | `LeaveRequest` | Leave screen |

No money appears anywhere on the staff home. `KITCHEN_STAFF` and
`COUNTER_CASHIER` hold no analytics permission at all, and the endpoint returns
the staff variant without touching a sales table.

### Why one call and not twelve

`GET /analytics/dashboard` returns every tile in one response.

The obvious reason is the network. Staff open this on a phone on 4G inside a
kitchen with a metal roof. Twelve requests means twelve JWT verifications,
twelve guard passes, twelve Redis lookups and twelve round trips on a connection
where the round trip is the expensive part. One request is one of each.

The better reason is consistency. Twelve calls resolve at twelve different
instants. A dashboard where the sales tile was computed at 09:14:02 and the
margin tile at 09:14:06 can show a margin that does not follow from the sales
figure directly above it, and the person who notices will be the owner. One
call computes every tile inside one request against one cache entry, so the
tiles always agree with each other.

```text
  GET /analytics/dashboard
        │
        ▼
  PermissionsGuard + OutletGuard  ──▶ roleKey, outletIds[]
        │
        ▼
  cache key: analytics:dash:{roleKey}:{sha1(outletIds)}:{businessDate}
        │
        ├── hit  ──▶ return cached JSON            (about 8 ms)
        │
        └── miss ──▶ Promise.all([
                       salesTiles(), stockTiles(), taskTiles(),
                       approvalTiles(), crmTiles()
                     ])                            (about 260 ms)
                       │
                       ▼
                     SETEX 60s, return
```

Five queries run concurrently on one Prisma connection pool rather than nine
sequential ones. The 60 second TTL and the invalidation policy live in
[chapter 25](25-caching-and-performance.md).

## Query performance

Two outlets and roughly 20 to 30 users is a small load, but the reports are the
only place in this system that touches large row counts, and one of them is on
the critical path of every login.

| Report | Rows scanned per year | Cost | Index it depends on |
|---|---|---|---|
| Daily sales summary | about 730 | Trivial | `DailySalesEntry` unique `(outletId, businessDate)` |
| P&L overview | about 730 sales plus about 1,200 purchases | Trivial | `Purchase @@index([outletId, purchaseDate])` |
| Customer game trends | plays, unbounded | Moderate | `GamePlay @@index([gameId, playedAt])` |
| Employee performance | tasks plus attendance, about 40,000 | Moderate | `Task @@index([outletId, status, dueAt])`, `AttendanceDay @@index([outletId, businessDate])` |
| Inventory consumption | transactions, about 150,000 | Expensive | `StockTransaction @@index([outletId, businessDate])` |
| Waste analysis | transactions plus a lateral price lookup per row | Most expensive | Same, plus `ItemPriceHistory @@index([itemId, observedOn])` |

Waste analysis is the one to watch. The `LATERAL` runs once per matching wastage
row, and each run is an index scan on `ItemPriceHistory`. At a few hundred
wastage rows per month that is fine. At a 92 day span across both outlets it is
a few thousand index lookups, which Postgres handles in tens of milliseconds but
which does not stay free if the business grows.

Consumption suffers from a different problem: `StockTransaction` is append only
and never pruned, so it is the fastest growing table in the system. The index
`(outletId, businessDate)` is what keeps a date bounded query from scanning it
all, which is why the date bound is not optional.

Maximum spans are enforced in the shared query schema and return
`422 DATE_RANGE_TOO_LARGE` with the requested and permitted spans in `details`:

| Endpoint | Maximum span |
|---|---|
| `GET /analytics/sales` | 366 days |
| `GET /analytics/pnl` | 366 days |
| `GET /analytics/crm` | 366 days |
| `GET /analytics/performance` | 186 days |
| `GET /analytics/consumption` | 92 days |
| `GET /analytics/waste` | 92 days |

Caching follows [chapter 25](25-caching-and-performance.md). The dashboard is cached for 60 seconds keyed by
role, outlet set and business date. Report endpoints are cached for 300 seconds
keyed by endpoint, outlet set and a hash of the normalised query. Reports are
not invalidated on write. A sales entry saved at 09:00 can take up to five
minutes to appear in the sales report, and that is an accepted trade rather than
a bug, because building write-through invalidation for six aggregations to save
five minutes on a report nobody refreshes twice is not worth the code. The
dashboard's shorter TTL covers the case where somebody is actually watching.

## Export

`POST /analytics/export` generates a CSV from the same query the matching report
endpoint runs. It is synchronous and streams the response. There is no job
queue, no email delivery and no stored file, because a 92 day waste report is a
few hundred kilobytes and Railway will hold the connection.

Permission is `analytics.export.create`, and holding it is not enough on its
own. The export runs the underlying report through the same service method the
GET endpoint uses, with the same `OutletGuard` derived outlet array. A store
manager exporting the sales report gets their own outlet and nothing else, and
there is no code path where the export builds its own outlet list. That is the
single rule that stops a CSV becoming the data leak that the API is careful not
to be.

Column conventions:

| Convention | Rule |
|---|---|
| Encoding | UTF-8 with a byte order mark, so Excel on Windows opens Odia and Hindi names correctly |
| Header row | Always present, `snake_case`, matching the column lists in each report above |
| Dates | `YYYY-MM-DD`, never localised |
| Money | Plain decimal with two places, no thousands separator, no currency symbol |
| Quantities | Three decimal places, with a separate `unit_code` column |
| Nulls | Empty cell, never the string `null` and never `0` |
| Row cap | 50,000 rows, then `422 EXPORT_TOO_LARGE` naming the row count |

Filename is set in `Content-Disposition` and follows
`bobsmomo_{report}_{outletCodeOrAll}_{from}_{to}.csv`, for example
`bobsmomo_waste_BM-SAHEED_2026-08-01_2026-08-25.csv`. Sorting a folder of these
by name groups them by report and then by date, which is what somebody with
fifteen of them actually wants.

Every export writes an `AuditLog` row with action `analytics.export.create`, the
report name, and the resolved parameters including the outlet array. Exports are
how data leaves the building.

## Endpoint reference

All eight live in `apps/api/src/modules/analytics/analytics.controller.ts` under
`/api/v1`. Every one runs `JwtAuthGuard`, `PermissionsGuard` and `OutletGuard`.

Six of them share a query schema:

```ts
export const reportQuerySchema = z.object({
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outletId: z.string().uuid().optional(),
}).strict().refine((q) => q.from <= q.to, { message: "from after to" });
```

> **Spec note:** this chapter registers the permission keys
> `analytics.dashboard.read`, `analytics.sales.read`,
> `analytics.consumption.read`, `analytics.performance.read`,
> `analytics.waste.read`, `analytics.crm.read` and `analytics.export.create`.
> `analytics.pnl.read` is already named in [chapter 14](14-rbac-and-permissions.md), which owns
> the role mapping.

> **Spec note:** the error codes `DATE_RANGE_TOO_LARGE` and
> `EXPORT_TOO_LARGE` are registered here. [Chapter 15](15-api-conventions.md) owns the registry.

| Endpoint | Permission | Returns |
|---|---|---|
| `GET /analytics/dashboard` | `analytics.dashboard.read` | The tile set for the caller's role variant |
| `GET /analytics/sales` | `analytics.sales.read` | Report 1, rows plus `missingDates` |
| `GET /analytics/consumption` | `analytics.consumption.read` | Report 2, top 20 plus optional per-item series |
| `GET /analytics/performance` | `analytics.performance.read` | Report 3, one row per active employee |
| `GET /analytics/waste` | `analytics.waste.read` | Report 6, grouped rows plus totals |
| `GET /analytics/pnl` | `analytics.pnl.read` | Report 5, one row per outlet plus the caveat block |
| `GET /analytics/crm` | `analytics.crm.read` | Report 4, day series plus reward totals |
| `POST /analytics/export` | `analytics.export.create` | `text/csv` stream |

`GET /analytics/dashboard` takes no parameters at all. Everything it needs comes
from the token and the current business date.

`GET /analytics/consumption` and `GET /analytics/waste` extend the shared schema
with `categoryId`, `itemId` and `groupBy`. `GET /analytics/sales` extends it
with `groupBy` of `outlet` or `combined`. `GET /analytics/crm` extends it with
`gameId`.

`POST /analytics/export` takes a body rather than a query string because the
parameter set is the union of every report's filters:

```ts
export const exportSchema = z.object({
  report:     z.enum(["sales","consumption","performance",
                      "waste","pnl","crm"]),
  from:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outletId:   z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  itemId:     z.string().uuid().optional(),
  gameId:     z.string().uuid().optional(),
  groupBy:    z.string().optional(),
}).strict();
```

Shared failure codes across all eight:

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Schema failure, malformed date, `from` after `to`, unknown key |
| `FORBIDDEN` | 403 | Caller lacks the permission key |
| `OUTLET_NOT_IN_SCOPE` | 404 | `outletId` supplied and not held by the caller |
| `DATE_RANGE_TOO_LARGE` | 422 | Span exceeds the per-endpoint maximum |
| `EXPORT_TOO_LARGE` | 422 | Export exceeds 50,000 rows |

## Numbers people will argue about

These four definitions are where UAT will stall, because each one is a word the
client already uses to mean something slightly different. Each definition below
is rendered as an information tooltip next to its figure in the UI, using this
exact wording, so the argument happens once during UAT and never again over
WhatsApp.

Consumption is the total quantity of an item recorded as `ISSUED` plus the total
recorded as `WASTAGE` at that outlet within the date range, in the item's own
unit, and it measures what staff recorded leaving the shelf rather than what the
kitchen physically used.

Wastage value is an approximation, calculated as the wasted quantity multiplied
by the most recent purchase price recorded for that item on or before the date
of the wastage, from any vendor, and it is not FIFO costing or an accounting
valuation.

On time means a task whose `completedAt` is at or before its `dueAt`, counted
only across tasks that had a due date, so a task with no deadline is never late
and never counts towards the rate.

Attendance consistency is the share of expected working days on which the
employee was present, counting a half day as half, where expected working days
exclude weekly offs and approved leave, so approved leave never lowers the
score.

## Failure modes

| What goes wrong | How it shows up | What to do |
|---|---|---|
| A day has no sales entry | Comparison columns are null and `missingDates` is populated | The UI renders "no data", never a minus 100 percent change. Fix the source with the sales entry screen. |
| Category rollup sums mixed units | A quantity that is the sum of kilograms and pieces | Cannot happen: `unit_code` is in the `GROUP BY`. The test that seeds one KG item and one PCS item in the same category guards this. |
| Cancelled tasks drag a score down | Staff member disputes their completion rate | Cannot happen: `CANCELLED` is excluded from both sides. Test 9 asserts the exact rate. |
| Item never purchased through the system | Wastage value understated | `has_unpriced_rows` is true and the screen shows the count of unpriced rows next to the total. |
| A large purchase lands on the last day of the window | Margin swings without the business changing | Documented in the P&L caveat block. Recommend month windows over week windows for margin. |
| Report shows stale numbers after an entry | Owner enters sales and the report does not move | 300 second cache TTL. Documented, not a bug. The dashboard tile refreshes in 60 seconds. |
| Someone requests a five year consumption report | Slow query, connection pool pressure | `DATE_RANGE_TOO_LARGE` at 92 days. The cap is in the schema, before the query runs. |
| A store manager exports the sales report | Potential cross-outlet leak | The export reuses the guard-derived outlet array. Test 16 asserts the CSV contains one outlet code. |
| Dashboard query times out | Blank tiles on login | Each tile group resolves independently in the `Promise.all`. A failed group returns `null` for its tiles with an `errors` array, and the rest of the dashboard renders. |
| `GamePlay` day bucket read as a business date | Off-by-one against the sales report | The CRM report uses calendar days in IST, stated in the tooltip. Test 12 covers a 01:30 play. |

## Test plan

`apps/api/test/analytics.e2e-spec.ts`, running against a seeded fixture in
`prisma/seed.analytics.ts`. The fixture is fixed, small and checked in, so the
expected numbers below are literal.

The seed: two outlets, BM-SAHEED and BM-PATIA. Business dates 2026-08-01 to
2026-08-07. SAHEED has entries on all seven days with `netSales` of 50000,
52000, 48000, 60000, 55000, 71000, 64000 and `orderCount` of 400 every day.
PATIA has entries on six days, none on 2026-08-04, each with `netSales` of
40000. One purchase per outlet, `RECORDED`, `totalAmount` 120000 for SAHEED and
90000 for PATIA, both dated 2026-08-03. One item `ITM-PANEER` in KG with an
`ItemPriceHistory` row of 320.00 observed on 2026-08-01, one item `ITM-BOX` in
PCS in the same category. Two employees at SAHEED. One published game with 30
plays.

| # | Case | Expected |
|---|---|---|
| 1 | `GET /analytics/sales` 01 to 07, grouped by outlet | 13 rows. SAHEED total `400000.00`, PATIA total `240000.00` |
| 2 | Same call, `groupBy=combined` | 7 rows. 2026-08-04 net is `60000.00`, not `100000.00` |
| 3 | SAHEED row for 2026-08-04 | `avgOrderValue` is `150.00` |
| 4 | PATIA `missingDates` | Exactly `["2026-08-04"]` |
| 5 | SAHEED 2026-08-02 | `prevDayNet` is `50000.00`, `prevDayChangePct` is `4.00` |
| 6 | SAHEED 2026-08-01 with a seeded 2026-07-25 entry of 45000 | `sameDayLastWeekNet` is `45000.00`, proving the 7 day lookback |
| 7 | PATIA 2026-08-05 | `prevDayNet` is null, `prevDayChangePct` is null, not 0 |
| 8 | `GET /analytics/consumption` with 3 KG paneer issued and 1 KG wasted | `issued_qty` 3.000, `wastage_qty` 1.000, `consumed_qty` 4.000 |
| 9 | Consumption grouped by category with paneer in KG and boxes in PCS | Two rows, one per `unit_code`. No row summing 4.000 and 200 |
| 10 | `GET /analytics/performance` with 10 assigned, 2 cancelled, 6 completed | `completion_rate` is `0.7500`, denominator 8 not 10 |
| 11 | Same employee, 6 completed of which 4 had a `dueAt` and 3 were on time | `on_time_rate` is `0.7500` |
| 12 | Attendance: 5 PRESENT, 1 HALF_DAY, 1 WEEKLY_OFF, 1 ON_LEAVE, 1 ABSENT | `attendance_consistency` is `0.7857`, denominator 7 |
| 13 | `GET /analytics/crm` with a play at 01:30 IST on 2026-08-03 | Counted on 2026-08-03, not 2026-08-02 |
| 14 | `GET /analytics/pnl` for SAHEED, 01 to 07 | `net_sales` 400000, `purchase_cost` 120000, `gross_margin_approx` 280000, `gross_margin_pct` 0.7000 |
| 15 | P&L response body | Contains the `caveats` array with all six excluded cost strings |
| 16 | `GET /analytics/waste` with 1 KG paneer wasted on 2026-08-05 | `approx_value` is `320.00`, using the 2026-08-01 price |
| 17 | Waste for an item with no price history | `approx_value` 0, `has_unpriced_rows` true |
| 18 | Waste priced at a date before any `ItemPriceHistory` row | `unitPrice` null, row still present |
| 19 | `GET /analytics/consumption` over 120 days | 422 `DATE_RANGE_TOO_LARGE`, `details` names 120 and 92 |
| 20 | `GET /analytics/dashboard` as `OWNER` | 9 tiles, both outlets present |
| 21 | Same as `STORE_MANAGER` at SAHEED | Manager variant, 8 tiles, no PATIA figure anywhere in the body |
| 22 | Same as `KITCHEN_STAFF` | Staff variant, no money field in the response |
| 23 | Dashboard called twice inside 60 seconds | Second call served from cache, byte-identical body |
| 24 | `POST /analytics/export` sales as `STORE_MANAGER` at SAHEED | CSV contains only `BM-SAHEED` rows and one header row |
| 25 | Same export | `Content-Disposition` filename is `bobsmomo_sales_BM-SAHEED_2026-08-01_2026-08-07.csv` |
| 26 | Export with a null `orderCount` day | Cell is empty, not `0` and not `null` |
| 27 | Export as a role without `analytics.export.create` | 403 `FORBIDDEN` |
| 28 | `GET /analytics/pnl` with `outletId` of an outlet not in scope | 404 `OUTLET_NOT_IN_SCOPE`, body names no other outlet |

Tests 1 through 18 assert literal numbers against the fixed seed. That is the
point. A report test that asserts "the total is greater than zero" catches
nothing, and every one of the arguments in the previous section is a disagreement
about an exact number.
