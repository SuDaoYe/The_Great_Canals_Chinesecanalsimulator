// All quantities are safe integers. These are model units, never historical units.
export type EntityId = string;
export type Tick = number; // Completed ten-day model periods since scenario start.
export type LaborUnit = number; // Model person-days.
export type WaterUnit = number; // Abstract stored/flowing water.
export type LoadUnit = number; // Standard transport load.
export type TreasuryUnit = number; // Scenario fiscal unit.
export type GrainUnit = number;
export type MaterialUnit = number;
export type BasisPoints = number; // Fixed-point fraction, 0..10000.
export type MaintenancePolicy = 'minimum' | 'standard' | 'intensive';
export type PassagePolicy = 'balanced' | 'official_first' | 'civil_first';
export type WaterPolicy = 'balanced' | 'navigation_first' | 'irrigation_first';
export type LoadClass = 'small' | 'standard' | 'heavy';
export type Purpose = 'official' | 'civil' | 'trade';
export type ProjectKind = 'build' | 'dredge' | 'upgrade' | 'reroute';
export type LaborMode = 'normal' | 'urgent';
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface CalendarDefinition { startYear: number }
export interface GameDate { year: number; month: number; period: 1 | 2 | 3 }
export interface PassageSchedule {
  official: readonly number[]; civil: readonly number[]; trade: readonly number[];
}
export interface ValidPeriod { fromYear: number; untilYearExclusive: number | null }
export interface Inventory {
  id: EntityId; ownerId: EntityId; regionId: EntityId;
  grain: GrainUnit; materials: MaterialUnit;
}
export interface RegionState {
  id: EntityId; name: string; actorId: EntityId; inventoryId: EntityId;
  population: number; agriculturalCapacity: GrainUnit; laborCapacity: LaborUnit;
  subsistenceLabor: LaborUnit; agriculturalLabor: LaborUnit;
  corveeBurden: LaborUnit; localRelations: number; taxBase: TreasuryUnit;
}
export interface ActorState {
  id: EntityId; name: string; kind: 'central' | 'royal' | 'local' | 'people' | 'merchant';
  regionIds: readonly EntityId[]; goals: readonly ('supply' | 'prestige' | 'livelihood' | 'trade')[];
  treasury: TreasuryUnit; executionCapacity: BasisPoints;
  commitmentIds: readonly EntityId[]; actionIds: readonly EntityId[];
}
export interface ActorAction {
  id: EntityId; actorId: EntityId; regionIds: readonly EntityId[];
  kind: 'military' | 'palace' | 'local_works' | 'relief';
  phase: 'proposed' | 'mobilizing' | 'active' | 'completed' | 'cancelled' | 'escalated';
  startTick: Tick; endTick: Tick; laborRequest: LaborUnit; allocationWeight: number;
  commitmentIds: readonly EntityId[]; sourceEventId: EntityId | null;
}
export interface WaterNode {
  id: EntityId; regionId: EntityId; storage: WaterUnit; capacity: WaterUnit;
  level: number; seasonalInflow: readonly WaterUnit[];
  irrigationRequest: WaterUnit; evaporation: WaterUnit; policy: WaterPolicy;
}
export interface WaterEdge {
  id: EntityId; fromNodeId: EntityId; toNodeId: EntityId | null; // null = boundary outflow.
  capacity: WaterUnit; controlled: boolean; available: boolean;
}
export interface TransportNode {
  id: EntityId; regionId: EntityId; inventoryId: EntityId; transferCapacity: LoadUnit;
}
export interface TransportEdge {
  id: EntityId; fromNodeId: EntityId; toNodeId: EntityId;
  mode: 'canal' | 'river' | 'land' | 'sea'; waterEdgeId: EntityId | null;
  capacity: LoadUnit; travelTicks: number; lossRate: BasisPoints;
  costPerLoad: TreasuryUnit; maxLoadClass: LoadClass; openPeriods: readonly number[];
  waterPerLoad: WaterUnit; available: boolean;
}
export interface CanalReachState {
  id: EntityId; name: string; regionIds: readonly EntityId[];
  waterEdgeIds: readonly EntityId[]; transportEdgeIds: readonly EntityId[];
  grade: LoadClass; status: 'candidate' | 'active' | 'mothballed' | 'decommissioning' | 'retired';
  silt: BasisPoints; damage: BasisPoints; maintenance: MaintenancePolicy;
  maintenanceLabor: LaborUnit; maintenanceCost: TreasuryUnit;
  passage: PassagePolicy; maxLoadClass: LoadClass; schedule: PassageSchedule;
  closedUntil: Tick | null; validPeriod: ValidPeriod; evidenceIds: readonly EntityId[];
}
export interface Commitment {
  id: EntityId; actorId: EntityId; projectId: EntityId | null; regionId: EntityId;
  resource: 'treasury' | 'grain' | 'materials' | 'labor';
  amount: number; consumed: number; reserved: number;
  fromTick: Tick; untilTick: Tick; firmness: 'hard' | 'revocable';
  status: 'promised' | 'escrowed' | 'withdrawn' | 'fulfilled'; sourceEventId: EntityId | null;
}
export interface ProjectLaborSource {
  regionId: EntityId; requested: LaborUnit; arrived: LaborUnit; arrivalTick: Tick;
}
export interface ProjectState {
  id: EntityId; kind: ProjectKind; reachIds: readonly EntityId[]; sponsorIds: readonly EntityId[];
  grade: LoadClass; laborMode: LaborMode; startTick: Tick;
  phase: 'survey' | 'planned' | 'construction' | 'trial' | 'operating' | 'cancelled';
  status: 'active' | 'paused' | 'cancelled'; workRequired: LaborUnit; workCompleted: LaborUnit;
  grainSpent: GrainUnit; materialsSpent: MaterialUnit; treasurySpent: TreasuryUnit;
  commitmentIds: readonly EntityId[]; laborSources: readonly ProjectLaborSource[];
  earliestCompletionTick: Tick | null; latestCompletionTick: Tick | null;
  replacesReachId: EntityId | null;
}
export interface PreservationLiability {
  id: EntityId; reachId: EntityId; projectId: EntityId; responsibleActorId: EntityId;
  minimumLabor: LaborUnit; minimumTreasury: TreasuryUnit; reservedTreasury: TreasuryUnit;
  exitWorkRequired: LaborUnit; exitWorkCompleted: LaborUnit; risk: BasisPoints;
  status: 'unresolved' | 'preserved' | 'resolved';
}
export interface Demand {
  id: EntityId; demandKey: string; ownerId: EntityId; fromNodeId: EntityId; toNodeId: EntityId;
  purpose: Purpose; cargo: 'grain' | 'materials'; requested: LoadUnit; fulfilled: LoadUnit;
  reservedInTransit: LoadUnit; cancelled: LoadUnit; deadlineTick: Tick;
  sourceEventId: EntityId | null; status: 'active' | 'fulfilled' | 'expired' | 'cancelled';
}
export interface ShipmentBatch {
  id: EntityId; parentId: EntityId | null; demandId: EntityId; ownerId: EntityId;
  purpose: Purpose; cargo: 'grain' | 'materials'; quantity: LoadUnit; lost: LoadUnit;
  routeEdgeIds: readonly EntityId[]; routeIndex: number; currentNodeId: EntityId;
  remainingTravelTicks: number; status: 'waiting' | 'travelling' | 'delivered' | 'lost';
}
export interface Fact {
  id: EntityId; text: string; relatedIds: readonly EntityId[];
}
export interface Petition {
  id: EntityId; actorId: EntityId; regionId: EntityId; reachIds: readonly EntityId[];
  issueType: 'supply' | 'labor' | 'water' | 'navigation' | 'maintenance'; causeRootId: EntityId;
  factIds: readonly EntityId[]; eventIds: readonly EntityId[]; urgency: BasisPoints;
  deadlineTick: Tick | null; affectedPopulation: number;
  status: 'open' | 'responded' | 'resolved'; lastChangedTick: Tick; cooldownUntil: Tick;
}
export interface LaborAllocation {
  regionId: EntityId; actorId: EntityId; activityId: EntityId;
  requested: LaborUnit; allocated: LaborUnit; unmet: LaborUnit;
}
export interface BalanceLedger {
  opening: number; incoming: number; outgoing: number; consumed: number; closing: number;
}
export interface TickLedger {
  tick: Tick; labor: readonly LaborAllocation[]; water: BalanceLedger; cargo: BalanceLedger;
}
export interface RngStates { weather: number; actors: number; disasters: number }
export type RngStream = keyof RngStates;

// Only confirmed foundation events exist in T01. Later tasks extend this union
// with concrete payloads when their reducers and mechanisms are implemented.
export interface DomainEvent {
  id: EntityId; tick: Tick; type: 'TICK_COMPLETED'; source: 'system';
  causeIds: readonly EntityId[]; facts: readonly Fact[];
  delta: { fromTick: Tick; toTick: Tick; observationEnded: boolean };
}
export interface ScheduledEvent { effectiveTick: Tick; event: DomainEvent }
// This is a time boundary marker, not a T07 world/legacy assessment.
export interface EndingState { reason: 'observation_end'; tick: Tick }
export interface SimulationEntities {
  regions: readonly RegionState[]; actors: readonly ActorState[]; actions: readonly ActorAction[];
  inventories: readonly Inventory[]; waterNodes: readonly WaterNode[]; waterEdges: readonly WaterEdge[];
  transportNodes: readonly TransportNode[]; transportEdges: readonly TransportEdge[];
  reaches: readonly CanalReachState[]; projects: readonly ProjectState[];
  liabilities: readonly PreservationLiability[]; commitments: readonly Commitment[];
  demands: readonly Demand[]; inTransit: readonly ShipmentBatch[]; petitions: readonly Petition[];
}
export type ScenarioDefinition = DeepReadonly<{
  id: EntityId; version: string; rulesVersion: string; calendar: CalendarDefinition; endTick: Tick;
  initial: SimulationEntities;
}>;
export type GameState = DeepReadonly<SimulationEntities & {
  scenarioId: EntityId; scenarioVersion: string; rulesVersion: string;
  calendar: CalendarDefinition; endTick: Tick; revision: number; tick: Tick;
  rngStates: RngStates; appliedCommandIds: readonly string[];
  pendingEvents: readonly ScheduledEvent[]; events: readonly DomainEvent[];
  ledger: TickLedger; ending: EndingState | null;
}>;
export interface StepResult { state: GameState; events: readonly DeepReadonly<DomainEvent>[] }
