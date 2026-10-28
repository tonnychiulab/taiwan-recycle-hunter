import {
	computeSignalAt,
	createRunState,
	stepRun,
	toSubmitScorePayload,
} from "./legal-engine.ts";
import { createStreetLayout } from "./street-map.ts";
import type { DomainModule } from "./types.ts";

export type * from "./types.ts";
export {
	createStreetLayout,
	resolvePrimaryZoneId,
	resolveZonesAtPoint,
} from "./street-map.ts";
export {
	computeSignalAt,
	createRunState,
	stepRun,
	toSubmitScorePayload,
} from "./legal-engine.ts";
export {
	createHighlightReel,
	stepHighlightReel,
} from "./highlight-reel.ts";

export const domainModule = {
	createStreetLayout,
	computeSignalAt,
	createRunState,
	stepRun,
	toSubmitScorePayload,
} satisfies DomainModule;
