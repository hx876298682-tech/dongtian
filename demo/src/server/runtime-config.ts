import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import type { ConfigParameterMap } from './config-release.ts';

let activeParameters: ConfigParameterMap = FROZEN_PARAMETERS;

export function installRuntimeParameters(parameters: ConfigParameterMap): void {
  if (!parameters || Object.keys(parameters).length === 0) throw new Error('runtime config parameter payload is empty');
  activeParameters = structuredClone(parameters);
}

export function runtimeParameters(): ConfigParameterMap {
  return activeParameters;
}

export function runtimeParameter(id: string): ConfigParameterMap[string] | undefined {
  return activeParameters[id];
}
