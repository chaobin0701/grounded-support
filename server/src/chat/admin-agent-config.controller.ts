import { Body, Controller, Get, Optional, Patch, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { PermissionGuard } from '../admin/permission.guard';
import { RequirePermission } from '../admin/permission.decorator';
import { AppConfigService } from '../config/config.service';
import { agentConfigurationRevision, effectiveAgentConfiguration, type AgentConfigurationSnapshot } from '../config/agent-config';
import { SkillRegistry } from '../ai/skills/skill-registry';
import { LlmService } from './llm.service';
import { AgentLoop, PLANNER_PROTOCOL } from '../ai/agent/agent-loop';
import { AgentSettingsService } from '../config/agent-settings.service';
import { ToolExecutionService } from '../ai/tools/tool-execution';
import type { AdminRequest } from '../admin/admin.types';

@Controller('admin/agent-config')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AdminAgentConfigController {
  constructor(
    private readonly config: AppConfigService,
    private readonly llm: LlmService,
    private readonly skills: SkillRegistry,
    private readonly loop: AgentLoop,
    @Optional() private readonly settings?: AgentSettingsService,
    @Optional() private readonly tools?: ToolExecutionService,
  ) {}

  @Get()
  @RequirePermission('agent_config.read', 'agent_config.manage')
  inspect() {
    return this.settings ? this.settings.snapshot().then(snapshot => this.view(snapshot)) : this.view({ configuration: this.config.agent, revision: agentConfigurationRevision(this.config.agent), configurationVersion: 0, updatedAt: null, updatedBy: null });
  }

  @Patch()
  @RequirePermission('agent_config.manage')
  async save(@Req() request: AdminRequest, @Body() body: unknown) {
    if (!this.settings) throw new Error('Agent settings unavailable');
    return this.view(await this.settings.save(request.admin!.id, body));
  }

  private view(snapshot: AgentConfigurationSnapshot) {
    const agent = snapshot.configuration;
    const effective = effectiveAgentConfiguration(agent);
    const { version: _version, answerInstructions: _instructions, ...editable } = agent;
    const enabledSkills = new Set(agent.enabledSkills);
    const summaries = this.skills.summaries().filter(skill => enabledSkills.has(skill.id));
    return {
      ...agent,
      revision: snapshot.revision,
      configurationVersion: snapshot.configurationVersion,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
      source: this.settings ? 'database' : this.configSource(),
      readOnly: !this.settings,
      settings: editable,
      model: {
        name: this.llm.model,
        contextWindowTokens: this.llm.contextWindowTokens,
        maxOutputTokens: this.llm.maxOutputTokens,
      },
      runtime: {
        ...effective.runtime,
        shouldPreRetrieve: false,
        execution: 'sequential',
        answerValidation: 'format_only',
      },
      availableSkills: this.skills.list().map(({ id, name, version, description, systemInstructions }) => ({ id, name, version, description, instructions: systemInstructions, enabled: enabledSkills.has(id) })),
      capabilities: (this.tools?.capabilities() ?? []).map(group => ({ ...group, enabled: group.system ? enabledSkills.size > 0 : group.tools.every(tool => agent.runtime.allowedTools.includes(tool.name)) })),
      prompts: {
        base: this.loop.promptFor?.(effective) ?? this.loop.prompt,
        protocol: PLANNER_PROTOCOL,
        assembled: this.loop.systemPromptFor(summaries, [], effective),
      },
    };
  }

  private configSource() {
    // No absolute paths, environment dump, credentials or provider settings.
    return process.env.AGENT_CONFIG_PATH?.trim() ? 'AGENT_CONFIG_PATH' : 'server/config/agent.json';
  }
}
