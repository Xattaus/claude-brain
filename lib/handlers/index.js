// Handler aggregator — merges all handler maps into a single dispatch table

import { coreHandlers } from './core.js';
import { recordingHandlers } from './recording.js';
import { contextHandlers } from './context.js';
import { safetyHandlers } from './safety.js';
import { planningHandlers } from './planning.js';
import { maintenanceHandlers } from './maintenance.js';
import { advancedHandlers } from './advanced.js';
import { integrationHandlers } from './integration.js';

export const HANDLERS = {
  ...coreHandlers,
  ...recordingHandlers,
  ...contextHandlers,
  ...safetyHandlers,
  ...planningHandlers,
  ...maintenanceHandlers,
  ...advancedHandlers,
  ...integrationHandlers,
};
