export type SkillDefinition = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly systemInstructions: string;
};
export type SkillSummary = Pick<SkillDefinition, 'id' | 'name' | 'version' | 'description'>;
