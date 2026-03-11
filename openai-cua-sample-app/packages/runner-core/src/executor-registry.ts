import { type RunDetail } from "@cua-sample/replay-schema";
import { CUSTOM_SCENARIO_ID } from "@cua-sample/scenario-kit";

import { createUnsupportedScenarioError, type RunExecutor } from "./scenario-runtime.js";
import { createBookingExecutor } from "./scenarios/booking.js";
import { createCustomExecutor } from "./scenarios/custom.js";
import { createKanbanExecutor } from "./scenarios/kanban.js";
import { createPaintExecutor } from "./scenarios/paint.js";

export function createDefaultRunExecutor(detail: RunDetail): RunExecutor {
  switch (detail.scenario.id) {
    case "kanban-reprioritize-sprint":
      return createKanbanExecutor(detail.run.mode);
    case "paint-draw-poster":
      return createPaintExecutor(detail.run.mode);
    case "booking-complete-reservation":
      return createBookingExecutor(detail.run.mode);
    case CUSTOM_SCENARIO_ID:
      return createCustomExecutor(detail.run.mode, detail.run.statelessMode ?? false);
    default:
      throw createUnsupportedScenarioError(detail.scenario.id);
  }
}
