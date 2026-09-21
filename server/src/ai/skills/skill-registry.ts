import { Injectable } from '@nestjs/common';
import type { SkillDefinition } from './skill.types';

export class DuplicateSkillError extends Error {
  constructor(id: string) {
    super(`Skill already registered: ${id}`);
    this.name = 'DuplicateSkillError';
  }
}

export class UnknownSkillError extends Error {
  constructor(id: string) {
    super(`Unknown skill: ${id}`);
    this.name = 'UnknownSkillError';
  }
}

@Injectable()
export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.id)) throw new DuplicateSkillError(skill.id);
    this.skills.set(skill.id, skill);
  }

  get(id: string): SkillDefinition {
    const skill = this.skills.get(id);
    if (!skill) throw new UnknownSkillError(id);
    return skill;
  }

  has(id: string): boolean { return this.skills.has(id); }

  list(): SkillDefinition[] { return [...this.skills.values()]; }
}
