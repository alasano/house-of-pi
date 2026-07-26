import type { EtaSettingsStore } from '../settings';
import { createEtaCheckTool } from './eta-check';
import { createEtaFinishTool } from './eta-finish';
import { createEtaStartTool } from './eta-start';

export function createEtaTools(settings: EtaSettingsStore) {
  return [
    createEtaCheckTool(settings),
    createEtaStartTool(settings),
    createEtaFinishTool(settings),
  ];
}
