import type { AppSpecV1, AppSpecV2 } from './app-spec.js';

export type PromoteResult = {
  spec: AppSpecV2;
  warning?: { code: 'SPEC_AUTO_PROMOTED'; message: string };
};

export function promoteV1ToV2(input: AppSpecV1 | AppSpecV2): PromoteResult {
  if (input.spec_version === 2) return { spec: input };
  return {
    spec: { ...input, spec_version: 2, modules: [] } as AppSpecV2,
    warning: {
      code: 'SPEC_AUTO_PROMOTED',
      message: 'AppSpec v1 detected; promoted to v2 in-memory (no disk mutation).',
    },
  };
}
