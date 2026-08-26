// Reference content from book chapter 11. Every list keys off a natural key
// (code, name, sku) so the seed is idempotent and safe to re-run on deploy.

export const OUTLETS = [
  {
    code: 'BM-SAHEED',
    name: "Bob's Momo, Saheed Nagar",
    address: 'Saheed Nagar, Bhubaneswar, Odisha 751007',
  },
  {
    code: 'BM-PATIA',
    name: "Bob's Momo, Patia",
    address: 'Patia, Bhubaneswar, Odisha 751024',
  },
] as const;

export const DEPARTMENTS = ['Kitchen', 'Counter', 'Store', 'Admin'] as const;

export const UNITS = [
  { code: 'KG', name: 'Kilogram' },
  { code: 'G', name: 'Gram' },
  { code: 'L', name: 'Litre' },
  { code: 'ML', name: 'Millilitre' },
  { code: 'PCS', name: 'Pieces' },
  { code: 'PKT', name: 'Packet' },
] as const;

export const CATEGORIES = [
  'Vegetables',
  'Meat and Poultry',
  'Flour and Dry Goods',
  'Sauces and Condiments',
  'Packaging',
  'Beverages',
  'Cleaning and Consumables',
] as const;

// Perishable is derived: everything in Vegetables and Meat and Poultry.
export const PERISHABLE_CATEGORIES = new Set(['Vegetables', 'Meat and Poultry']);

export const ITEMS: ReadonlyArray<{
  sku: string;
  name: string;
  category: string;
  unit: string;
}> = [
  { sku: 'ITM-CABBAGE', name: 'Cabbage', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-ONION', name: 'Onion', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-GARLIC', name: 'Garlic', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-GINGER', name: 'Ginger', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-SPRING-ONION', name: 'Spring Onion', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-CARROT', name: 'Carrot', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-GREEN-CHILLI', name: 'Green Chilli', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-CORIANDER', name: 'Coriander Leaves', category: 'Vegetables', unit: 'KG' },
  { sku: 'ITM-CHICKEN-MINCE', name: 'Chicken Mince', category: 'Meat and Poultry', unit: 'KG' },
  { sku: 'ITM-CHICKEN-BONELESS', name: 'Chicken Boneless', category: 'Meat and Poultry', unit: 'KG' },
  { sku: 'ITM-MUTTON-MINCE', name: 'Mutton Mince', category: 'Meat and Poultry', unit: 'KG' },
  { sku: 'ITM-EGG', name: 'Egg', category: 'Meat and Poultry', unit: 'PCS' },
  { sku: 'ITM-MAIDA', name: 'Refined Flour (Maida)', category: 'Flour and Dry Goods', unit: 'KG' },
  { sku: 'ITM-CORNFLOUR', name: 'Cornflour', category: 'Flour and Dry Goods', unit: 'KG' },
  { sku: 'ITM-MUNG-STARCH', name: 'Mung Bean Starch', category: 'Flour and Dry Goods', unit: 'KG' },
  { sku: 'ITM-NOODLE-THUKPA', name: 'Thukpa Noodles', category: 'Flour and Dry Goods', unit: 'PKT' },
  { sku: 'ITM-REFINED-OIL', name: 'Refined Oil', category: 'Flour and Dry Goods', unit: 'L' },
  { sku: 'ITM-SALT', name: 'Salt', category: 'Flour and Dry Goods', unit: 'KG' },
  { sku: 'ITM-SUGAR', name: 'Sugar', category: 'Flour and Dry Goods', unit: 'KG' },
  { sku: 'ITM-BLACK-PEPPER', name: 'Black Pepper Powder', category: 'Flour and Dry Goods', unit: 'G' },
  { sku: 'ITM-GARAM-MASALA', name: 'Garam Masala', category: 'Flour and Dry Goods', unit: 'G' },
  { sku: 'ITM-SOY-SAUCE', name: 'Soy Sauce', category: 'Sauces and Condiments', unit: 'L' },
  { sku: 'ITM-VINEGAR', name: 'Vinegar', category: 'Sauces and Condiments', unit: 'L' },
  { sku: 'ITM-CHILLI-SAUCE', name: 'Red Chilli Sauce', category: 'Sauces and Condiments', unit: 'L' },
  { sku: 'ITM-SCHEZWAN-PASTE', name: 'Schezwan Paste', category: 'Sauces and Condiments', unit: 'KG' },
  { sku: 'ITM-KETCHUP', name: 'Tomato Ketchup', category: 'Sauces and Condiments', unit: 'KG' },
  { sku: 'ITM-SESAME-OIL', name: 'Sesame Oil', category: 'Sauces and Condiments', unit: 'ML' },
  { sku: 'ITM-BOX-MOMO-6', name: 'Momo Box 6 Piece', category: 'Packaging', unit: 'PCS' },
  { sku: 'ITM-BOX-MOMO-10', name: 'Momo Box 10 Piece', category: 'Packaging', unit: 'PCS' },
  { sku: 'ITM-CHUTNEY-CUP', name: 'Chutney Cup 30 ml', category: 'Packaging', unit: 'PCS' },
  { sku: 'ITM-CARRY-BAG', name: 'Carry Bag', category: 'Packaging', unit: 'PCS' },
  { sku: 'ITM-TISSUE', name: 'Tissue Paper', category: 'Packaging', unit: 'PKT' },
  { sku: 'ITM-WATER-1L', name: 'Packaged Water 1 L', category: 'Beverages', unit: 'PCS' },
  { sku: 'ITM-COLA-250', name: 'Cola 250 ml', category: 'Beverages', unit: 'PCS' },
  { sku: 'ITM-DISHWASH', name: 'Dishwash Liquid', category: 'Cleaning and Consumables', unit: 'L' },
  { sku: 'ITM-FLOOR-CLEAN', name: 'Floor Cleaner', category: 'Cleaning and Consumables', unit: 'L' },
  { sku: 'ITM-GLOVES', name: 'Hand Gloves', category: 'Cleaning and Consumables', unit: 'PKT' },
  { sku: 'ITM-GARBAGE-BAG', name: 'Garbage Bag', category: 'Cleaning and Consumables', unit: 'PKT' },
];

type TemplateItem = {
  label: string;
  requiresPhoto?: boolean;
  requiresNote?: boolean;
  failCreatesTask?: boolean;
};

export const CHECKLIST_TEMPLATES: ReadonlyArray<{
  code: string;
  name: string;
  isAudit: boolean;
  cronExpr: string;
  dueAfterMins: number;
  items: TemplateItem[];
}> = [
  {
    code: 'KITCHEN_OPEN',
    name: 'Kitchen opening checklist',
    isAudit: false,
    cronExpr: '0 7 * * *',
    dueAfterMins: 120,
    items: [
      { label: 'Deep freezer temperature recorded, below -18 C', requiresNote: true },
      { label: 'Chiller temperature recorded, between 0 and 4 C', requiresNote: true },
      { label: 'Gas connection and burners checked, no leak smell', failCreatesTask: true },
      { label: "Last night's closing stock matches physical count", failCreatesTask: true },
      { label: 'Steamers washed and water refilled' },
      { label: 'Chutney and sauce batches labelled with prep date', requiresPhoto: true },
      { label: 'Staff in clean uniform, hair covered, nails checked' },
      { label: 'Prep counters and floor sanitised before first prep', requiresPhoto: true },
      { label: 'Opening stock entered in the system for tracked items' },
    ],
  },
  {
    code: 'KITCHEN_CLOSE',
    name: 'Kitchen closing checklist',
    isAudit: false,
    cronExpr: '0 23 * * *',
    dueAfterMins: 120,
    items: [
      { label: 'Closing stock count entered for all tracked items' },
      { label: "Day's wastage recorded with reason", requiresNote: true },
      { label: 'Steamers, tawa and fryer cleaned and dried', requiresPhoto: true },
      { label: 'Perishables moved to chiller, freezer door sealed' },
      { label: 'Gas turned off at the regulator', failCreatesTask: true },
      { label: 'Chutney containers washed, leftovers discarded' },
      { label: 'Bins emptied and liners replaced' },
      { label: 'Exhaust and lights off, shutter locked', failCreatesTask: true },
      { label: 'Daily sales entry submitted for the day' },
    ],
  },
  {
    code: 'CLEANING_DAILY',
    name: 'Daily cleaning checklist',
    isAudit: false,
    cronExpr: '0 15 * * *',
    dueAfterMins: 180,
    items: [
      { label: 'Dining tables and chairs wiped' },
      { label: 'Customer washroom cleaned and stocked', requiresPhoto: true },
      { label: 'Floor mopped with sanitiser', requiresPhoto: true },
      { label: 'Chiller and freezer handles sanitised' },
      { label: 'Prep counters degreased' },
      { label: 'Waste segregated, wet and dry separated' },
      { label: 'Dishwash area cleared, no utensils left soaking' },
    ],
  },
  {
    code: 'EQUIPMENT_WEEKLY',
    name: 'Weekly equipment audit',
    isAudit: true,
    cronExpr: '0 11 * * 1',
    dueAfterMins: 480,
    items: [
      { label: 'Steamer descaled, gasket checked', requiresPhoto: true, failCreatesTask: true },
      { label: 'Fryer oil filtered or replaced, condition noted', requiresNote: true },
      { label: "Week's chiller and freezer temperature log reviewed", requiresNote: true },
      { label: 'Exhaust hood filters degreased', requiresPhoto: true },
      { label: 'Gas pipe and regulator inspected for cracks', failCreatesTask: true },
      { label: 'Weighing scale checked against a 1 KG test weight', failCreatesTask: true },
      { label: 'Fire extinguisher gauge in green, service date valid', failCreatesTask: true },
      { label: 'First aid box stocked and in date' },
      { label: 'Electrical points and wiring visually checked', failCreatesTask: true },
    ],
  },
];
