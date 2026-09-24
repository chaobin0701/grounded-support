import { BadRequestException, Injectable } from '@nestjs/common';
import { SkillRegistry, UnknownSkillError } from './skill-registry';
import type { SelectedSkill } from './skill.types';

const PRODUCT_INTENT = /(产品|型号|规格|参数|价格|库存|保修|分类|有哪些|多少款|清洁)/u;
const SMALL_TALK_INTENT = /^(你好|您好|嗨|hello|hi|谢谢|感谢|不客气|再见|拜拜|辛苦了)[！!。？?、\s]*$/iu;

@Injectable()
export class SkillSelector {
  constructor(private readonly registry: SkillRegistry) {}

  select(question: string, requestedId?: string): SelectedSkill {
    if (requestedId) {
      try {
        return { skill: this.registry.get(requestedId), selectedBy: 'explicit' };
      } catch (error) {
        if (error instanceof UnknownSkillError) throw new BadRequestException('Unknown skill');
        throw error;
      }
    }
    if (this.registry.has('question_answering')) {
      return { skill: this.registry.get('question_answering'), selectedBy: 'default' };
    }
    if (SMALL_TALK_INTENT.test(question.trim()) && this.registry.has('small_talk')) {
      return { skill: this.registry.get('small_talk'), selectedBy: 'deterministic' };
    }
    const id = PRODUCT_INTENT.test(question) ? 'product_consultation' : 'customer_support';
    return { skill: this.registry.get(id), selectedBy: id === 'product_consultation' ? 'deterministic' : 'default' };
  }
}
