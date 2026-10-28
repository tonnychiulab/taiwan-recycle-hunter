import type {
	CaptureId,
	ContaminantKind,
	ContaminantTallies,
	HighlightReasonKind,
	ItemId,
	OrientationUsed,
	PrepStep,
	RecyclableKind,
	RecyclableTallies,
	SessionId,
	SubmitScorePayload,
	VerifiedPickupClaim,
	ViolationKind,
	ViolationTallies,
	ZoneId,
} from "../shared/contracts.ts";

export type WorldPoint = {
	readonly xMeters: number;
	readonly yMeters: number;
};

export type MeterBounds = {
	readonly minXMeters: number;
	readonly minYMeters: number;
	readonly widthMeters: number;
	readonly depthMeters: number;
};

export type PedestrianSignalPhase = "walk_green" | "flashing_green" | "stop_red";

export type SignalSnapshot = {
	readonly phase: PedestrianSignalPhase;
	readonly phaseRemainingSeconds: number;
};

export type CurbMarkingKind =
	| "white_parking_bay"
	| "designated_arcade_spot"
	| "yellow_curb"
	| "red_curb"
	| "yellow_box_junction";

export type StreetFixtureKind =
	| "telecom_box"
	| "fire_hydrant"
	| "signal_pole"
	| "stop_sign_post"
	| "no_pedestrian_sign"
	| "one_way_sign"
	| "warning_pedestrian_sign"
	| "arcade_pillar";

export type StreetFixture = {
	readonly id: string;
	readonly kind: StreetFixtureKind;
	readonly position: WorldPoint;
	readonly labelZh: string;
};

export type StreetZone =
	| {
			readonly kind: "arcade_walkway";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
	  }
	| {
			readonly kind: "sidewalk";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
	  }
	| {
			readonly kind: "curb_marking";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
			readonly marking: CurbMarkingKind;
	  }
	| {
			readonly kind: "signalized_crosswalk";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
			readonly axis: "ns" | "ew";
	  }
	| {
			readonly kind: "roadway_lane";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
	  }
	| {
			readonly kind: "hydrant_red_zone";
			readonly zoneId: ZoneId;
			readonly center: WorldPoint;
			readonly radiusMeters: number;
	  }
	| {
			readonly kind: "alley_stop_buffer";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
			readonly guardedAlleyZoneId: ZoneId;
	  }
	| {
			readonly kind: "unsignalized_alley_lane";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
			readonly requiredBufferZoneId: ZoneId;
	  }
	| {
			readonly kind: "no_pedestrian_zone";
			readonly zoneId: ZoneId;
			readonly bounds: MeterBounds;
	  };

export type WorldItem =
	| {
			readonly category: "recyclable";
			readonly itemId: ItemId;
			readonly kind: RecyclableKind;
			readonly position: WorldPoint;
			readonly hiddenNearFixtureId: string;
			readonly hidingSpotZh: string;
			readonly legalStandingZoneIds: readonly ZoneId[];
			readonly collected: boolean;
	  }
	| {
			readonly category: "contaminant";
			readonly itemId: ItemId;
			readonly kind: ContaminantKind;
			readonly position: WorldPoint;
			readonly hiddenNearFixtureId: string;
			readonly hidingSpotZh: string;
			readonly collected: boolean;
	  };

export type StreetLayout = {
	readonly widthMeters: number;
	readonly depthMeters: number;
	readonly spawnPoint: WorldPoint;
	readonly spawnZoneId: ZoneId;
	readonly zones: readonly StreetZone[];
	readonly zonesById: ReadonlyMap<ZoneId, StreetZone>;
	readonly fixtures: readonly StreetFixture[];
	readonly initialItems: readonly WorldItem[];
};

export type ParkedCartLease =
	| {
			readonly policy: "unlimited";
			readonly marking: "white_parking_bay" | "designated_arcade_spot";
			readonly zoneId: ZoneId;
	  }
	| {
			readonly policy: "temporary_yellow";
			readonly marking: "yellow_curb";
			readonly zoneId: ZoneId;
			readonly parkedDurationMs: number;
			readonly overstayCited: boolean;
	  };

export type ParkedCartState = {
	readonly position: WorldPoint;
	readonly lease: ParkedCartLease;
};

export type HandCarriedRecyclable = {
	readonly itemId: ItemId;
	readonly kind: RecyclableKind;
};

export type LocomotionState =
	| {
			readonly kind: "pushing_cart";
			readonly position: WorldPoint;
			readonly primaryZoneId: ZoneId;
	  }
	| {
			readonly kind: "on_foot";
			readonly position: WorldPoint;
			readonly primaryZoneId: ZoneId;
			readonly handCarried: readonly HandCarriedRecyclable[];
			readonly parkedCart: ParkedCartState;
	  };

export type CrosswalkSubstate =
	| { readonly kind: "outside" }
	| { readonly kind: "legal_green_pass"; readonly zoneId: ZoneId }
	| {
			readonly kind: "illegal_cited";
			readonly zoneId: ZoneId;
			readonly enteredOn: "flashing_green" | "stop_red";
	  };

export type HydrantDwellSubstate =
	| { readonly kind: "outside" }
	| {
			readonly kind: "on_foot_grace";
			readonly zoneId: ZoneId;
			readonly dwellMs: number;
			readonly cited: boolean;
	  }
	| { readonly kind: "cart_cited"; readonly zoneId: ZoneId };

export type AlleyStopSubstate =
	| { readonly kind: "unarmed" }
	| {
			readonly kind: "pausing";
			readonly bufferZoneId: ZoneId;
			readonly guardedAlleyZoneId: ZoneId;
			readonly pausedMs: number;
	  }
	| {
			readonly kind: "cleared";
			readonly guardedAlleyZoneId: ZoneId;
	  }
	| {
			readonly kind: "skipped_cited";
			readonly alleyZoneId: ZoneId;
	  };

export type ZoneLatch =
	| { readonly kind: "clear" }
	| { readonly kind: "latched"; readonly zoneId: ZoneId };

export type LegalComplianceState = {
	readonly crosswalk: CrosswalkSubstate;
	readonly hydrant: HydrantDwellSubstate;
	readonly alleyStop: AlleyStopSubstate;
	readonly jaywalkLatch: ZoneLatch;
	readonly forbiddenCurbLatch: ZoneLatch;
	readonly noPedestrianLatch: ZoneLatch;
};

export type CleanSortCompressState = {
	readonly streak: number;
	readonly maxStreak: number;
	readonly stepsActive: Readonly<Record<PrepStep, boolean>>;
	readonly triadsCompleted: number;
};

export type RunState = {
	readonly sessionId: SessionId;
	readonly signature: string;
	readonly alias: string;
	readonly seed: number;
	readonly roundDurationMs: number;
	readonly status: "active" | "finished";
	readonly elapsedMs: number;
	readonly layout: StreetLayout;
	readonly locomotion: LocomotionState;
	readonly compliance: LegalComplianceState;
	readonly itemsById: ReadonlyMap<ItemId, WorldItem>;
	readonly score: number;
	readonly combo: CleanSortCompressState;
	readonly recyclableTallies: RecyclableTallies;
	readonly contaminantTallies: ContaminantTallies;
	readonly violationTallies: ViolationTallies;
	readonly pickupClaims: readonly VerifiedPickupClaim[];
};

export type RunCommand =
	| {
			readonly kind: "advance_frame";
			readonly dtMs: number;
			readonly velocityMps: { readonly vx: number; readonly vy: number };
			readonly signals: {
				readonly ns: PedestrianSignalPhase;
				readonly ew: PedestrianSignalPhase;
			};
	  }
	| { readonly kind: "toggle_cart" }
	| { readonly kind: "interact_nearest" }
	| { readonly kind: "finish_now" };

export type CartRefusalReason =
	| "must_park_on_white_bay_arcade_spot_or_yellow_curb"
	| "too_far_to_retrieve_cart";

export type RunEvent =
	| {
			readonly kind: "recyclable_collected";
			readonly itemId: ItemId;
			readonly recyclableKind: RecyclableKind;
			readonly pointsAwarded: number;
			readonly co2SavedGrams: number;
			readonly streak: number;
			readonly triadCompletedNow: boolean;
			readonly hidingSpotZh: string;
			readonly highlightHint: HighlightReasonKind;
	  }
	| {
			readonly kind: "cart_deposited";
			readonly depositedCount: number;
			readonly bonusPoints: number;
	  }
	| {
			readonly kind: "contaminant_penalized";
			readonly itemId: ItemId;
			readonly contaminantKind: ContaminantKind;
			readonly penaltyPoints: number;
	  }
	| {
			readonly kind: "violation_cited";
			readonly violationKind: ViolationKind;
			readonly zoneId: ZoneId;
			readonly penaltyPoints: number;
	  }
	| {
			readonly kind: "stop_sign_cleared";
			readonly guardedAlleyZoneId: ZoneId;
	  }
	| {
			readonly kind: "mode_switched";
			readonly mode: "pushing_cart" | "on_foot";
	  }
	| {
			readonly kind: "cart_action_refused";
			readonly reason: CartRefusalReason;
	  }
	| {
			readonly kind: "pickup_blocked_illegal_side";
			readonly itemId: ItemId;
	  }
	| {
			readonly kind: "hand_bag_full";
			readonly maxItems: number;
	  }
	| {
			readonly kind: "run_finished";
			readonly finalScore: number;
	  };

export type TransitionResult = {
	readonly state: RunState;
	readonly events: readonly RunEvent[];
};

export type HighlightMeta = {
	readonly captureId: CaptureId;
	readonly reason: HighlightReasonKind;
	readonly badgeZh: string;
	readonly detailZh: string;
	readonly excitementScore: number;
	readonly capturedAtMs: number;
	readonly scoreAtCapture: number;
	readonly streakAtCapture: number;
};

export type HighlightShot<TFrame> = {
	readonly meta: HighlightMeta;
	readonly frame: TFrame;
};

export type HighlightReel<TFrame> = {
	readonly lastCapturedAtMs: number | null;
	readonly nextSeq: number;
	readonly shots: readonly HighlightShot<TFrame>[];
};

export type DomainModule = {
	createStreetLayout(seed: number): StreetLayout;
	computeSignalAt(elapsedMs: number, axis: "ns" | "ew"): SignalSnapshot;
	createRunState(params: {
		readonly sessionId: SessionId;
		readonly signature: string;
		readonly alias: string;
		readonly seed: number;
		readonly roundDurationMs: number;
		readonly layout?: StreetLayout;
	}): RunState;
	stepRun(state: RunState, command: RunCommand): TransitionResult;
	toSubmitScorePayload(params: {
		readonly state: RunState;
		readonly alias?: string;
		readonly orientationUsed: OrientationUsed;
	}): SubmitScorePayload;
};
