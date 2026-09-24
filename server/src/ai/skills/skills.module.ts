import { Module, OnModuleInit } from '@nestjs/common';
import { SkillRegistry } from './skill-registry';
import { SkillSelector } from './skill-selector';
import { customerSupportSkill } from './built-in/customer-support.skill';
import { productConsultationSkill } from './built-in/product-consultation.skill';
import { smallTalkSkill } from './built-in/small-talk.skill';
import { questionAnsweringSkill } from './built-in/question-answering.skill';

@Module({ providers: [SkillRegistry, SkillSelector], exports: [SkillRegistry, SkillSelector] })
export class SkillsModule implements OnModuleInit {
  constructor(private readonly registry: SkillRegistry) {}

  onModuleInit(): void {
    this.registry.register(customerSupportSkill);
    this.registry.register(productConsultationSkill);
    this.registry.register(smallTalkSkill);
    this.registry.register(questionAnsweringSkill);
  }
}
