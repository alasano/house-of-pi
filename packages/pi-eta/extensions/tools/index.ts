import type { EtaSettingsStore } from '../settings';
import { createEtaCheckTool } from './eta-check';
import { createEtaFinishTool } from './eta-finish';
import { createEtaStartTool } from './eta-start';
import { createEtaUpdateTool } from './eta-update';
import type { EtaTaskChanged } from './helpers';

export function createEtaTools(settings: EtaSettingsStore, onTaskChanged?: EtaTaskChanged) {
  return [
    createEtaCheckTool(settings),
    createEtaStartTool(settings, onTaskChanged),
    createEtaUpdateTool(settings, onTaskChanged),
    createEtaFinishTool(settings, onTaskChanged),
  ];
}
