/**
 * The demo shop: a hybrid electronics and stationery store in Addis Ababa. Prices and costs are in
 * birr (the seed converts them to santim). A few products are deliberately priced at or below
 * what they cost, because that is a situation the system must show (negative-margin alerts).
 */

export type ShopType = 'ELECTRONICS' | 'STATIONERY';

export interface SubCategoryDef {
  type: ShopType;
  name: string;
  code: string;
  /** Preferred suppliers, first choice first. */
  suppliers: string[];
}

export const SUB_CATEGORIES: SubCategoryDef[] = [
  {
    type: 'ELECTRONICS',
    name: 'Chargers - Type-C',
    code: 'CTC',
    suppliers: ['Ethio Electronics Wholesale', 'Gerji Import Trading'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Chargers - Micro USB',
    code: 'CMU',
    suppliers: ['Gerji Import Trading', 'Ethio Electronics Wholesale'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Chargers - iPhone',
    code: 'CIP',
    suppliers: ['Ethio Electronics Wholesale', 'Piassa Electronics'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Cables and adapters',
    code: 'CAB',
    suppliers: ['Merkato Supplies Co.', 'Ethio Electronics Wholesale'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Earphones and earbuds',
    code: 'EAR',
    suppliers: ['Bole Accessories Hub', 'Merkato Supplies Co.'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Headsets',
    code: 'HSE',
    suppliers: ['Bole Accessories Hub', 'Piassa Electronics'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Speakers',
    code: 'SPK',
    suppliers: ['Bole Accessories Hub', 'Piassa Electronics'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Mice and keyboards',
    code: 'MKB',
    suppliers: ['Piassa Electronics', 'Merkato Supplies Co.'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Power banks',
    code: 'PWB',
    suppliers: ['Bole Accessories Hub', 'Ethio Electronics Wholesale'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Batteries',
    code: 'BAT',
    suppliers: ['Gerji Import Trading', 'Merkato Supplies Co.'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Memory and storage',
    code: 'MEM',
    suppliers: ['Piassa Electronics', 'Ethio Electronics Wholesale'],
  },
  {
    type: 'ELECTRONICS',
    name: 'Phones and tablets',
    code: 'PHN',
    suppliers: ['Piassa Electronics', 'Ethio Electronics Wholesale'],
  },
  {
    type: 'STATIONERY',
    name: 'Notebooks',
    code: 'NTB',
    suppliers: ['Capital Stationery', 'Hayat Office Supplies'],
  },
  {
    type: 'STATIONERY',
    name: 'Pens and pencils',
    code: 'PEN',
    suppliers: ['Capital Stationery', 'Addis Wholesale Market'],
  },
  {
    type: 'STATIONERY',
    name: 'Paper',
    code: 'PAP',
    suppliers: ['Capital Stationery', 'Hayat Office Supplies'],
  },
  {
    type: 'STATIONERY',
    name: 'Markers and highlighters',
    code: 'MRK',
    suppliers: ['Capital Stationery', 'Hayat Office Supplies'],
  },
  {
    type: 'STATIONERY',
    name: 'Files and folders',
    code: 'FIL',
    suppliers: ['Hayat Office Supplies', 'Capital Stationery'],
  },
  {
    type: 'STATIONERY',
    name: 'Office tools',
    code: 'OFT',
    suppliers: ['Hayat Office Supplies', 'Addis Wholesale Market'],
  },
  {
    type: 'STATIONERY',
    name: 'School supplies',
    code: 'SCH',
    suppliers: ['Addis Wholesale Market', 'Hayat Office Supplies'],
  },
  {
    type: 'STATIONERY',
    name: 'Art and craft',
    code: 'ART',
    suppliers: ['Addis Wholesale Market', 'Capital Stationery'],
  },
];

export const SUPPLIERS: { name: string; contact: string; city: string; termsDays: number }[] = [
  {
    name: 'Ethio Electronics Wholesale',
    contact: 'Hana Tesfaye',
    city: 'Addis Ababa',
    termsDays: 30,
  },
  { name: 'Merkato Supplies Co.', contact: 'Yonas Bekele', city: 'Addis Ababa', termsDays: 14 },
  { name: 'Capital Stationery', contact: 'Selam Girma', city: 'Addis Ababa', termsDays: 30 },
  { name: 'Bole Accessories Hub', contact: 'Meron Haile', city: 'Addis Ababa', termsDays: 14 },
  { name: 'Piassa Electronics', contact: 'Dawit Alemu', city: 'Addis Ababa', termsDays: 45 },
  { name: 'Gerji Import Trading', contact: 'Biruk Mulu', city: 'Addis Ababa', termsDays: 21 },
  { name: 'Hayat Office Supplies', contact: 'Tigist Worku', city: 'Addis Ababa', termsDays: 30 },
  { name: 'Addis Wholesale Market', contact: 'Kidist Abebe', city: 'Addis Ababa', termsDays: 7 },
];

export const CUSTOMERS: {
  name: string;
  type: 'RETAIL' | 'WHOLESALE' | 'INSTITUTIONAL';
  creditBirr: number;
  slowPayer?: boolean;
}[] = [
  { name: 'Bright Future School', type: 'INSTITUTIONAL', creditBirr: 400_000 },
  { name: 'Sunrise Clinic', type: 'INSTITUTIONAL', creditBirr: 300_000 },
  { name: 'Hope Foundation', type: 'INSTITUTIONAL', creditBirr: 250_000, slowPayer: true },
  { name: 'Tech Corner Shop', type: 'WHOLESALE', creditBirr: 250_000 },
  { name: 'Meskel Trading', type: 'WHOLESALE', creditBirr: 300_000, slowPayer: true },
  { name: 'Lulit Bekele', type: 'RETAIL', creditBirr: 0 },
  { name: 'Samuel Girma', type: 'RETAIL', creditBirr: 0 },
  { name: 'Tigist Alemu', type: 'RETAIL', creditBirr: 0 },
  { name: 'Rahel Tadesse', type: 'RETAIL', creditBirr: 0 },
  { name: 'Abel Haile', type: 'RETAIL', creditBirr: 0 },
  { name: 'Marta Desta', type: 'RETAIL', creditBirr: 0 },
  { name: 'Yared Mekonnen', type: 'RETAIL', creditBirr: 0 },
  { name: 'Selamawit Assefa', type: 'RETAIL', creditBirr: 0 },
  { name: 'Biniam Tesfaye', type: 'RETAIL', creditBirr: 0 },
  { name: 'Hirut Wolde', type: 'RETAIL', creditBirr: 0 },
  { name: 'Eyob Negash', type: 'RETAIL', creditBirr: 0 },
  { name: 'Frehiwot Kebede', type: 'RETAIL', creditBirr: 0 },
  { name: 'Dagmawi Lemma', type: 'RETAIL', creditBirr: 0 },
  { name: 'Betelhem Yilma', type: 'RETAIL', creditBirr: 0 },
  { name: 'Natnael Gebre', type: 'RETAIL', creditBirr: 0 },
];

export const BRAND_COUNTRIES: Record<string, string> = {
  Samsung: 'South Korea',
  Xiaomi: 'China',
  Rugass: 'China',
  Yonee: 'China',
  Fares: 'China',
  APlus: 'China',
  Murgat: 'China',
  Temaz: 'China',
  Sany: 'China',
  iOrange: 'China',
  Galaxy: 'China',
  TMAX: 'China',
  Javor: 'China',
  Anker: 'China',
  JBL: 'United States',
  HP: 'United States',
  Lenovo: 'China',
  Logitech: 'Switzerland',
  Tecno: 'China',
  Infinix: 'China',
  Apple: 'United States',
  SanDisk: 'United States',
  Kingston: 'United States',
  Seagate: 'United States',
  Energizer: 'United States',
  Duracell: 'United States',
  Bic: 'France',
  Pilot: 'Japan',
  Stabilo: 'Germany',
  'Double A': 'Thailand',
  Casio: 'Japan',
  'Faber-Castell': 'Germany',
  Deli: 'China',
  Staedtler: 'Germany',
  Maped: 'France',
  Generic: 'China',
};

/**
 * [sub-category, name, brand, cost (birr), price (birr), kind]
 * kind: 'dormant' stops selling after the first two months (dead stock); 'starved' is not
 * restocked at the end (low or out of stock); omitted is a normal product.
 */
export type ProductDef = [string, string, string, number, number, ('dormant' | 'starved')?];

export const PRODUCTS: ProductDef[] = [
  // Chargers - Type-C
  ['Chargers - Type-C', 'Samsung 65W Type-C charger', 'Samsung', 690, 1200],
  ['Chargers - Type-C', 'Samsung 45W Type-C charger', 'Samsung', 490, 900],
  ['Chargers - Type-C', 'Rugass 5A Type-C charger', 'Rugass', 420, 600],
  ['Chargers - Type-C', 'Yonee RU11C Type-C charger', 'Yonee', 220, 800],
  ['Chargers - Type-C', 'Fares fast charger Type-C', 'Fares', 320, 350],
  ['Chargers - Type-C', 'APlus 33W Type-C charger', 'APlus', 390, 600],
  ['Chargers - Type-C', 'Samsung S20+ compatible charger', 'Samsung', 310, 700, 'starved'],
  ['Chargers - Type-C', 'Samsung S10+ charger', 'Samsung', 250, 350, 'dormant'],
  ['Chargers - Type-C', 'Murgat 5A Type-C charger', 'Murgat', 350, 350],
  ['Chargers - Type-C', 'APlus 20W Type-C charger', 'APlus', 400, 200],
  ['Chargers - Type-C', '45W unlocked Type-C charger', 'Generic', 400, 800],
  ['Chargers - Type-C', 'Xiaomi 120W Type-C charger', 'Xiaomi', 450, 600],
  ['Chargers - Type-C', 'Temaz fast Type-C charger', 'Temaz', 240, 350],
  ['Chargers - Type-C', 'Sany 45W Type-C charger', 'Sany', 240, 500],
  // Chargers - Micro USB
  ['Chargers - Micro USB', 'Murgat Micro USB charger', 'Murgat', 350, 500],
  ['Chargers - Micro USB', 'iOrange Micro USB charger', 'iOrange', 390, 250],
  ['Chargers - Micro USB', 'APlus 20W Micro USB charger', 'APlus', 400, 800],
  ['Chargers - Micro USB', 'Rugass 5A Micro USB charger', 'Rugass', 390, 200],
  ['Chargers - Micro USB', 'Galaxy 5A Micro USB charger', 'Galaxy', 210, 1000],
  ['Chargers - Micro USB', 'TMAX TMC-08 Micro USB charger', 'TMAX', 280, 600],
  ['Chargers - Micro USB', 'TMAX TMC-T14 Micro USB charger', 'TMAX', 280, 550],
  ['Chargers - Micro USB', 'TMAX TMC-12 Micro USB charger', 'TMAX', 300, 550],
  ['Chargers - Micro USB', 'TMAX TMC-T2 Micro USB charger', 'TMAX', 210, 420, 'dormant'],
  ['Chargers - Micro USB', 'Javor Micro USB charger', 'Javor', 230, 460],
  ['Chargers - Micro USB', 'Sany Micro USB charger', 'Sany', 235, 470],
  // Chargers - iPhone
  ['Chargers - iPhone', 'APlus Lightning charger', 'APlus', 750, 1500],
  ['Chargers - iPhone', 'Fares Lightning charger', 'Fares', 400, 400],
  ['Chargers - iPhone', 'iPhone Pro Max charger', 'Apple', 650, 1200],
  ['Chargers - iPhone', 'iPhone box with charger', 'Apple', 220, 350],
  ['Chargers - iPhone', 'iPhone box only', 'Apple', 180, 300],
  ['Chargers - iPhone', 'Small 5W charger', 'Generic', 130, 200],
  ['Chargers - iPhone', 'DSTV 20W charger', 'Generic', 250, 400],
  ['Chargers - iPhone', 'APlus car charger', 'APlus', 500, 750],
  ['Chargers - iPhone', 'Fast car charger 18W', 'Generic', 160, 250],
  // Cables and adapters
  ['Cables and adapters', 'USB-C cable 1m', 'Anker', 130, 320],
  ['Cables and adapters', 'USB-C cable 2m', 'Anker', 190, 450],
  ['Cables and adapters', 'Micro USB cable 1m', 'Generic', 70, 180],
  ['Cables and adapters', 'Lightning cable 1m braided', 'Generic', 150, 380],
  ['Cables and adapters', 'HDMI cable 1.5m', 'Generic', 140, 320],
  ['Cables and adapters', 'HDMI cable 3m', 'Generic', 230, 520],
  ['Cables and adapters', 'USB extension cable 3m', 'Generic', 120, 280],
  ['Cables and adapters', 'AUX cable 3.5mm', 'Generic', 45, 120],
  ['Cables and adapters', 'Ethernet cable Cat6 5m', 'Generic', 160, 350],
  ['Cables and adapters', 'OTG adapter Type-C', 'Generic', 40, 120],
  ['Cables and adapters', 'OTG adapter Micro USB', 'Generic', 35, 100],
  ['Cables and adapters', 'USB hub 4-port', 'Generic', 260, 550, 'starved'],
  // Earphones and earbuds
  ['Earphones and earbuds', 'Xiaomi wired earphones', 'Xiaomi', 170, 380],
  ['Earphones and earbuds', 'Samsung AKG wired earphones', 'Samsung', 320, 650],
  ['Earphones and earbuds', 'JBL T110 earphones', 'JBL', 360, 700],
  ['Earphones and earbuds', 'Samsung wireless earbuds', 'Samsung', 2000, 2900],
  ['Earphones and earbuds', 'AirPods Pro compatible', 'Generic', 750, 1500],
  ['Earphones and earbuds', 'Xiaomi Redmi Buds', 'Xiaomi', 900, 1500],
  ['Earphones and earbuds', 'Tecno wireless earbuds', 'Tecno', 700, 1200],
  ['Earphones and earbuds', 'Bluetooth neckband', 'Generic', 380, 750],
  // Headsets
  ['Headsets', 'Gaming headset with mic', 'Generic', 900, 1600],
  ['Headsets', 'USB headset with mic', 'Logitech', 1200, 2100],
  ['Headsets', 'Wireless over-ear headphones', 'JBL', 2400, 3800],
  ['Headsets', 'Kids headphones', 'Generic', 280, 550, 'dormant'],
  // Speakers
  ['Speakers', 'JBL Go portable speaker', 'JBL', 1500, 2400],
  ['Speakers', 'JBL Flip speaker', 'JBL', 4200, 6200],
  ['Speakers', 'Xiaomi mini speaker', 'Xiaomi', 800, 1400],
  ['Speakers', 'Bluetooth speaker, generic', 'Generic', 450, 900],
  ['Speakers', 'Soundbar 2.0', 'Generic', 2200, 3400, 'dormant'],
  ['Speakers', 'PC speakers 2.0', 'Generic', 500, 950],
  // Mice and keyboards
  ['Mice and keyboards', 'HP wireless mouse', 'HP', 420, 750],
  ['Mice and keyboards', 'Logitech M185 wireless mouse', 'Logitech', 650, 1100],
  ['Mice and keyboards', 'USB wired mouse', 'Generic', 120, 280],
  ['Mice and keyboards', 'Mouse pad', 'Generic', 60, 150],
  ['Mice and keyboards', 'Lenovo USB keyboard', 'Lenovo', 560, 950],
  ['Mice and keyboards', 'Wireless keyboard and mouse combo', 'Logitech', 1300, 2200],
  ['Mice and keyboards', 'Gaming mouse', 'Generic', 480, 900],
  // Power banks
  ['Power banks', 'Anker 10000mAh power bank', 'Anker', 1250, 1900],
  ['Power banks', 'Anker 20000mAh power bank', 'Anker', 1650, 2400],
  ['Power banks', 'Xiaomi 10000mAh power bank', 'Xiaomi', 1100, 1700],
  ['Power banks', 'Xiaomi 20000mAh power bank', 'Xiaomi', 1750, 2600],
  ['Power banks', 'Samsung 10000mAh power bank', 'Samsung', 1300, 2000, 'starved'],
  ['Power banks', 'Power bank 5000mAh', 'Generic', 450, 800],
  // Batteries
  ['Batteries', 'AA batteries, pack of 4', 'Duracell', 110, 220],
  ['Batteries', 'AAA batteries, pack of 4', 'Duracell', 110, 220],
  ['Batteries', '9V battery', 'Energizer', 95, 200],
  ['Batteries', 'CR2032 coin battery', 'Energizer', 40, 100],
  ['Batteries', '18650 Li-ion battery', 'Generic', 140, 300],
  ['Batteries', 'AA rechargeable, pack of 4', 'Energizer', 480, 800],
  // Memory and storage
  ['Memory and storage', 'SD card 32GB', 'SanDisk', 280, 520],
  ['Memory and storage', 'SD card 64GB', 'SanDisk', 420, 750],
  ['Memory and storage', 'SD card 128GB', 'SanDisk', 780, 1300],
  ['Memory and storage', 'Flash drive 16GB', 'Kingston', 230, 450],
  ['Memory and storage', 'Flash drive 32GB', 'Kingston', 300, 550],
  ['Memory and storage', 'Flash drive 64GB', 'Samsung', 380, 650],
  ['Memory and storage', 'Flash drive 128GB', 'Samsung', 700, 1150],
  ['Memory and storage', 'Memory card reader', 'Generic', 90, 220],
  ['Memory and storage', 'External hard drive 1TB', 'Seagate', 4100, 5600],
  ['Memory and storage', 'SSD 256GB', 'Kingston', 2300, 3300],
  // Phones and tablets
  ['Phones and tablets', 'Samsung Galaxy A15 128GB', 'Samsung', 11200, 14500],
  ['Phones and tablets', 'Xiaomi Redmi 13 256GB', 'Xiaomi', 14100, 17800],
  ['Phones and tablets', 'Tecno Spark 20 128GB', 'Tecno', 4700, 6200],
  ['Phones and tablets', 'Infinix Hot 40 128GB', 'Infinix', 5200, 6900],
  ['Phones and tablets', 'Tablet 10 inch 64GB', 'Lenovo', 8800, 11500, 'starved'],
  ['Phones and tablets', 'Feature phone, dual SIM', 'Tecno', 780, 1150],
  ['Phones and tablets', 'Phone case, clear', 'Generic', 70, 250],
  ['Phones and tablets', 'Tempered glass protector', 'Generic', 30, 150],
  ['Phones and tablets', 'Phone holder for car', 'Generic', 120, 280],
  // Notebooks
  ['Notebooks', 'Notebook A5 80 pages', 'Bic', 28, 55],
  ['Notebooks', 'Notebook A4 160 pages', 'Bic', 62, 110],
  ['Notebooks', 'Spiral notebook A4', 'Deli', 75, 130],
  ['Notebooks', 'Exercise book 40 pages', 'Generic', 12, 25],
  ['Notebooks', 'Composition book 100 pages', 'Generic', 35, 70],
  ['Notebooks', 'Desk diary', 'Deli', 160, 300, 'dormant'],
  // Pens and pencils
  ['Pens and pencils', 'Ballpoint pen blue, box of 50', 'Bic', 310, 480],
  ['Pens and pencils', 'Ballpoint pen black, box of 50', 'Bic', 310, 480],
  ['Pens and pencils', 'Gel pen black', 'Pilot', 22, 45],
  ['Pens and pencils', 'Pilot G2 gel pen', 'Pilot', 55, 95],
  ['Pens and pencils', 'Fountain pen', 'Deli', 130, 240],
  ['Pens and pencils', 'Ballpoint pen single', 'Bic', 5, 12],
  ['Pens and pencils', 'Pencil HB, pack of 12', 'Staedtler', 70, 130],
  ['Pens and pencils', 'Mechanical pencil 0.5', 'Pilot', 40, 85],
  // Paper
  ['Paper', 'A4 copy paper, ream of 500', 'Double A', 310, 420],
  ['Paper', 'A4 copy paper, box of 5', 'Double A', 1550, 2050],
  ['Paper', 'A3 copy paper, ream', 'Double A', 520, 700],
  ['Paper', 'Coloured paper A4, pack of 100', 'Generic', 140, 260],
  ['Paper', 'Sticky notes 76mm', 'Stabilo', 30, 60],
  ['Paper', 'Index cards, pack of 100', 'Generic', 25, 55],
  ['Paper', 'Thermal receipt roll 80mm', 'Generic', 35, 70],
  ['Paper', 'Carbon paper, pack of 50', 'Generic', 90, 170, 'dormant'],
  // Markers and highlighters
  ['Markers and highlighters', 'Permanent marker black', 'Pilot', 19, 40],
  ['Markers and highlighters', 'Permanent marker blue', 'Pilot', 19, 40],
  ['Markers and highlighters', 'Whiteboard marker, set of 4', 'Pilot', 95, 170],
  ['Markers and highlighters', 'Highlighter set of 4', 'Stabilo', 110, 190],
  ['Markers and highlighters', 'Highlighter set of 6', 'Stabilo', 160, 280],
  ['Markers and highlighters', 'Fine liner set of 10', 'Staedtler', 210, 360],
  ['Markers and highlighters', 'Whiteboard eraser', 'Generic', 25, 60],
  // Files and folders
  ['Files and folders', 'Ring binder A4', 'Double A', 52, 95],
  ['Files and folders', 'Clear folder, pack of 12', 'Double A', 74, 130],
  ['Files and folders', 'Box file A4', 'Deli', 85, 150],
  ['Files and folders', 'Lever arch file', 'Deli', 95, 170],
  ['Files and folders', 'Plastic envelope, pack of 10', 'Generic', 30, 65],
  ['Files and folders', 'Document wallet', 'Generic', 18, 40],
  ['Files and folders', 'Clipboard A4', 'Generic', 40, 85],
  // Office tools
  ['Office tools', 'Stapler standard', 'Bic', 90, 160],
  ['Office tools', 'Staples 26/6, box', 'Bic', 11, 25],
  ['Office tools', 'Paper clips, box of 100', 'Maped', 10, 22],
  ['Office tools', 'Scissors 21cm', 'Maped', 45, 95],
  ['Office tools', 'Packing tape', 'Generic', 30, 65],
  ['Office tools', 'Glue stick', 'Deli', 15, 35],
  ['Office tools', 'Correction fluid', 'Pilot', 20, 45],
  ['Office tools', '2-hole punch', 'Deli', 90, 165],
  ['Office tools', 'Calculator 12-digit', 'Casio', 340, 520],
  ['Office tools', 'Scientific calculator', 'Casio', 1050, 1450],
  ['Office tools', 'Ruler 30cm', 'Maped', 8, 20],
  ['Office tools', 'Stamp pad', 'Generic', 35, 80],
  ['Office tools', 'Paper cutter', 'Deli', 25, 55],
  // School supplies
  ['School supplies', 'Geometry set', 'Maped', 66, 120],
  ['School supplies', 'School bag', 'Generic', 560, 950],
  ['School supplies', 'Pencil box with pencils', 'Bic', 75, 140],
  ['School supplies', 'Colouring pencils, 24', 'Faber-Castell', 125, 210],
  ['School supplies', 'Eraser', 'Staedtler', 6, 15],
  ['School supplies', 'Sharpener', 'Maped', 8, 20],
  ['School supplies', 'Lunch box', 'Generic', 110, 220],
  ['School supplies', 'Water bottle 750ml', 'Generic', 120, 240],
  ['School supplies', 'Backpack, large', 'Generic', 900, 1500, 'starved'],
  // Art and craft
  ['Art and craft', 'Watercolour set of 12', 'Faber-Castell', 90, 170],
  ['Art and craft', 'Paint brush set', 'Generic', 60, 120],
  ['Art and craft', 'Sketch pad A4', 'Deli', 70, 130],
  ['Art and craft', 'Wax crayons, 24', 'Faber-Castell', 70, 130],
  ['Art and craft', 'Modelling clay, 12 colours', 'Generic', 55, 110, 'dormant'],
  ['Art and craft', 'Glitter glue, pack of 6', 'Generic', 65, 125, 'dormant'],
];
