// Demo network: a fictional regional medical-supply distributor.
// Everything the simulator and the 3D map need lives here, so swapping in a
// different business is a data change, not a code change.
// Positions are world units on the map (x = east, z = south).

export const SKUS = [
  { id: 'INS', name: 'Insulin', unit: 'packs', color: '#3B82F6', unitCost: 28 },
  { id: 'IVF', name: 'IV fluids', unit: 'bags', color: '#14B8A6', unitCost: 4 },
  { id: 'MSK', name: 'Masks', unit: 'boxes', color: '#A78BFA', unitCost: 6 },
];
export const SKU_IDS = SKUS.map((s) => s.id);

export const SITES = {
  port: {
    type: 'port', name: 'Bayport Terminal', short: 'Port',
    pos: [-46, 6], dock: [-40, 10], access: 'jPort',
  },
  central: {
    type: 'hub', name: 'Central Hub', short: 'Central', model: 'hub_central', labelY: 9.4,
    pos: [-8.5, -4], rot: 0, dock: [-6, 3], access: 'jCentral',
    stockDays: 1.6, targetDays: 2.6,
  },
  north: {
    type: 'hub', name: 'North Hub', short: 'North', model: 'hub_north', labelY: 8.2,
    pos: [18, -35], rot: 0, dock: [20.5, -28], access: 'jNorth',
    stockDays: 6, targetDays: 6,
  },
  south: {
    type: 'hub', name: 'South Hub', short: 'South', model: 'hub_south', labelY: 8,
    pos: [18, 47], rot: Math.PI, dock: [15.5, 40], access: 'jSouth',
    stockDays: 1.6, targetDays: 2.6,
  },
  backup: {
    type: 'supplier', name: 'Ridgeway Labs', short: 'Ridgeway', sub: 'Local backup supplier',
    pos: [-26, -43], rot: 0, dock: [-24.2, -36], access: 'jRidge',
  },
  stclara: {
    type: 'hospital', name: 'St. Clara Hospital', short: 'St. Clara', model: 'hospital_tower', labelY: 13.5,
    pos: [56, -4], rot: -Math.PI / 2, dock: [49, -4], access: 'jStClara',
    hub: 'central', critical: true, demand: { INS: 140, IVF: 220, MSK: 120 },
  },
  riverside: {
    type: 'hospital', name: 'Riverside Hospital', short: 'Riverside', model: 'hospital_campus', labelY: 8.6,
    pos: [56, 22], rot: -Math.PI / 2, dock: [49, 22], access: 'jRiverside',
    hub: 'south', critical: true, demand: { INS: 110, IVF: 180, MSK: 100 },
  },
  northside: {
    type: 'clinic', name: 'Northside Clinic', short: 'Northside',
    pos: [46, -45], rot: 0, dock: [46, -39.5], access: 'jNorthside',
    hub: 'north', demand: { INS: 60, IVF: 50, MSK: 90 },
  },
  harbor: {
    type: 'pharmacy', name: 'Harbor Pharmacy', short: 'Harbor',
    pos: [-37, 24], rot: Math.PI / 2, dock: [-32.6, 24], access: 'jHarbor',
    hub: 'south', demand: { INS: 90, IVF: 20, MSK: 120 },
  },
  maple: {
    type: 'carehome', name: 'Maple Care Home', short: 'Maple',
    pos: [14, -7], rot: -Math.PI / 2, dock: [9, -7], access: 'jMaple',
    hub: 'central', demand: { INS: 50, IVF: 40, MSK: 70 },
  },
};

export const HUB_IDS = ['central', 'north', 'south'];
export const CUSTOMER_IDS = Object.keys(SITES).filter((id) => SITES[id].hub);

export const JUNCTIONS = {
  jPort: [-34, 10], jCentral: [-6, 10], jMid: [4, 10], jEast: [46, 10],
  jMaple: [4, -7], jNorthX: [4, -22], jNorth: [20.5, -22], jNE: [46, -22],
  jNorthside: [46, -34], jStClara: [46, -4], jNW: [-26, -22], jRidge: [-24.2, -32],
  jRiverside: [46, 22], jSE: [46, 34], jSouth: [15.5, 34], jSouthX: [4, 34],
  jSW: [-26, 34], jHarbor: [-29, 22],
};

// Undirected roads. `via` adds bends; `bridge` marks river crossings.
export const ROADS = [
  { id: 'harborRd', a: 'jPort', b: 'jCentral', bridge: 'kell' },
  { id: 'r2', a: 'jCentral', b: 'jMid' },
  { id: 'r3', a: 'jMid', b: 'jEast' },
  { id: 'r4', a: 'jMid', b: 'jMaple' },
  { id: 'r5', a: 'jMaple', b: 'jNorthX' },
  { id: 'r6', a: 'jNorthX', b: 'jNorth' },
  { id: 'r7', a: 'jNorth', b: 'jNE' },
  { id: 'r8', a: 'jNE', b: 'jStClara' },
  { id: 'r9', a: 'jStClara', b: 'jEast' },
  { id: 'r10', a: 'jEast', b: 'jRiverside' },
  { id: 'r11', a: 'jRiverside', b: 'jSE' },
  { id: 'r12', a: 'jSE', b: 'jSouth' },
  { id: 'r13', a: 'jSouth', b: 'jSouthX' },
  { id: 'r14', a: 'jSouthX', b: 'jMid' },
  { id: 'southRd', a: 'jSouthX', b: 'jSW', bridge: 'south' },
  { id: 'r16', a: 'jSW', b: 'jHarbor' },
  { id: 'r17', a: 'jHarbor', b: 'jPort' },
  { id: 'northRd', a: 'jNorthX', b: 'jNW', bridge: 'north' },
  { id: 'r19', a: 'jNW', b: 'jRidge' },
  { id: 'coastRd', a: 'jNW', b: 'jPort', via: [[-31, -15], [-36, -4]] },
  { id: 'r21', a: 'jNE', b: 'jNorthside' },
];

export const BRIDGES = {
  kell: { name: 'Kell Bridge', road: 'harborRd' },
  north: { name: 'North Bridge', road: 'northRd' },
  south: { name: 'Mill Bridge', road: 'southRd' },
};

export const RIVER = [
  [-12, -58], [-15, -42], [-19, -28], [-17, -12], [-19, 2], [-21, 16], [-18, 30], [-15, 44], [-13, 58],
];

// The overseas supplier ships to Bayport every two days.
export const SUPPLIER = { name: 'Kestrel Pharma', sub: 'Overseas supplier' };
export const VESSEL = {
  name: 'MV Kestrel Star',
  firstArrival: 9, // Day 1, 09:00 - already sailing in when the app opens
  every: 48,
  unloadHours: 3,
  cargo: { INS: 960, IVF: 1100, MSK: 1080 },
  catchUp: 1, // after a supplier outage, each sailing can carry up to one extra load of backlog
};

export const BACKUP = {
  leadHours: 8, // first batch ready this long after the order
  batchEvery: 12,
  batch: { INS: 135, IVF: 180, MSK: 130 },
  premium: 0.4, // +40% on unit cost for rush local production
};

export const OPS = {
  speed: 16, // world units per hour on roads
  truckCapacity: 900, // units per truck
  orderHours: [5, 13], // customers place orders at these hours (half a day of demand each)
  dueAfter: 24, // orders are due 24h after they are placed
  dispatchHours: [6, 14, 20], // hubs send out deliveries at these hours
  portDispatchHours: [0, 6, 12, 18],
  truckCostPerHour: 95, // $ driver + fuel
  co2PerTruckHour: 55, // kg CO2e
  latePenalty: { critical: 5000, standard: 800 }, // $ per late order (emergency sourcing, rescheduled care)
};

export const SCENARIOS = {
  port: {
    id: 'port', title: 'Port congestion', icon: 'Ship',
    blurb: 'Ships can’t berth at Bayport Terminal.',
    cause: 'storm backlog at the terminal',
    days: { min: 1, max: 6, default: 4 },
  },
  hub: {
    id: 'hub', title: 'Hub shutdown', icon: 'PlugZap',
    blurb: 'A distribution hub goes offline.',
    cause: 'power outage',
    days: { min: 1, max: 4, default: 2 },
    targets: HUB_IDS, defaultTarget: 'central',
  },
  bridge: {
    id: 'bridge', title: 'Bridge closure', icon: 'Construction',
    blurb: 'Kell Bridge closes — the direct port road is cut.',
    cause: 'flood-damage inspection',
    days: { min: 1, max: 6, default: 4 },
  },
  supplier: {
    id: 'supplier', title: 'Supplier outage', icon: 'Factory',
    blurb: 'Kestrel Pharma ships only a quarter of each order.',
    cause: 'a production fault at Kestrel Pharma',
    days: { min: 2, max: 6, default: 4 },
  },
};

// Recovery levers the AI planner can combine.
export const ACTIONS = {
  backup: { id: 'backup', title: 'Order from backup supplier', short: 'Backup supplier', icon: 'Factory' },
  rebalance: { id: 'rebalance', title: 'Rebalance stock between hubs', short: 'Rebalance stock', icon: 'Boxes' },
  reroute: { id: 'reroute', title: 'Reroute around the disruption', short: 'Reroute', icon: 'Route' },
  prioritize: { id: 'prioritize', title: 'Serve hospitals first', short: 'Hospitals first', icon: 'HeartPulse' },
};

export const APPLICABLE = {
  port: ['backup', 'rebalance', 'prioritize'],
  hub: ['reroute', 'rebalance', 'backup', 'prioritize'],
  bridge: ['reroute', 'rebalance', 'backup', 'prioritize'],
  supplier: ['backup', 'rebalance', 'prioritize'],
};

export const START_TIME = 6; // playback starts Day 1, 06:00
export const BASE_HORIZON = 7 * 24;
