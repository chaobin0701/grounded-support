export type SkillResponseMode = 'auto' | 'grounded' | 'product' | 'conversational';

export type SkillDefinition = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly systemInstructions: string;
  readonly allowedTools: readonly string[];
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
  readonly responseMode: SkillResponseMode;
  readonly shouldPreRetrieve?: boolean;
  readonly preRetrievalTopK?: number;
  readonly summary?: string;
};

export type SelectedSkill = {
  readonly skill: SkillDefinition;
  readonly selectedBy: 'default' | 'explicit' | 'deterministic';
};
