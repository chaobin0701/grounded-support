import { Module, OnModuleInit } from '@nestjs/common';
import { SkillRegistry } from './skill-registry';
import { customerSupportSkill } from './built-in/customer-support.skill';
import { productConsultationSkill } from './built-in/product-consultation.skill';

@Module({ providers: [SkillRegistry], exports: [SkillRegistry] })
export class SkillsModule implements OnModuleInit {
  constructor(private readonly registry: SkillRegistry) {}

  onModuleInit(): void {
    this.registry.register(customerSupportSkill);
    this.registry.register(productConsultationSkill);
  }
}
