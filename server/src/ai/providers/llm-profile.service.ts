import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../../database.service';
import { AppConfigService } from '../../config/config.service';
import { SecretBox } from '../../security/secret-box';
import { ProviderRegistry } from './provider-registry';
import type { LlmProfileRecord, LlmProfileView } from './llm-profile.types';

const profileInput = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().url(),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(500).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(20000),
  contextWindowTokens: z.number().int().min(1024).max(1000000).default(32000),
  maxOutputTokens: z.number().int().min(128).max(32000).default(1200),
  structuredOutput: z.enum(['auto', 'required', 'disabled']).default('auto'),
  supportsToolCalls: z.boolean().default(true),
  supportsStreaming: z.boolean().default(true),
}).strict();

type ProfileRow = Record<string, unknown>;

@Injectable()
export class LlmProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    private readonly secrets: SecretBox,
    private readonly registry: ProviderRegistry,
  ) {}

  async list(): Promise<LlmProfileView[]> {
    const rows = await this.database.query<ProfileRow>(this.selectSql('ORDER BY is_default DESC, updated_at DESC'));
    return rows.rows.map((row) => this.toView(row));
  }

  async create(actorId: number, input: unknown): Promise<LlmProfileView> {
    const parsed = profileInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid OpenAI Compatible model profile');
    this.validateBaseUrl(parsed.data.baseUrl);
    const apiKeyCiphertext = parsed.data.apiKey ? this.secrets.encrypt(parsed.data.apiKey) : null;
    if (!apiKeyCiphertext && !this.config.llm.apiKey) throw new BadRequestException('API Key is required');
    try {
      const row = await this.database.transaction(async (client) => {
        const inserted = await client.query<ProfileRow>(`${this.insertSql()} RETURNING ${this.returningColumns()}`, [
          parsed.data.name, parsed.data.baseUrl, parsed.data.model, apiKeyCiphertext,
          parsed.data.timeoutMs, parsed.data.contextWindowTokens, parsed.data.maxOutputTokens,
          parsed.data.structuredOutput, parsed.data.supportsToolCalls, parsed.data.supportsStreaming,
        ]);
        const created = inserted.rows[0];
        await client.query(`INSERT INTO audit_logs(actor_admin_id, action, target_type, target_id, details)
          VALUES ($1, 'llm_profile.created', 'llm_profile', $2, $3)`, [actorId, String(created.id), JSON.stringify({ name: parsed.data.name, model: parsed.data.model })]);
        return created;
      });
      return this.toView(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Only one default model profile is allowed');
      throw error;
    }
  }

  async update(actorId: number, id: number, input: unknown): Promise<LlmProfileView> {
    const parsed = profileInput.partial().safeParse(input);
    if (!parsed.success || Object.keys(parsed.data).length === 0) throw new BadRequestException('No valid profile fields');
    if (parsed.data.baseUrl) this.validateBaseUrl(parsed.data.baseUrl);
    const existing = await this.find(id);
    if (!existing) throw new NotFoundException('LLM profile not found');
    const values: unknown[] = [id];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => { values.push(value); assignments.push(`${column} = $${values.length}`); };
    if (parsed.data.name !== undefined) add('name', parsed.data.name);
    if (parsed.data.baseUrl !== undefined) add('base_url', parsed.data.baseUrl);
    if (parsed.data.model !== undefined) add('model', parsed.data.model);
    if (parsed.data.apiKey !== undefined) add('api_key_ciphertext', this.secrets.encrypt(parsed.data.apiKey));
    if (parsed.data.timeoutMs !== undefined) add('timeout_ms', parsed.data.timeoutMs);
    if (parsed.data.contextWindowTokens !== undefined) add('context_window_tokens', parsed.data.contextWindowTokens);
    if (parsed.data.maxOutputTokens !== undefined) add('max_output_tokens', parsed.data.maxOutputTokens);
    if (parsed.data.structuredOutput !== undefined) add('structured_output', parsed.data.structuredOutput);
    if (parsed.data.supportsToolCalls !== undefined) add('supports_tool_calls', parsed.data.supportsToolCalls);
    if (parsed.data.supportsStreaming !== undefined) add('supports_streaming', parsed.data.supportsStreaming);
    assignments.push('updated_at = now()');
    const row = await this.database.transaction(async (client) => {
      const updated = await client.query<ProfileRow>(`UPDATE llm_profiles SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${this.returningColumns()}`, values);
      const result = updated.rows[0];
      await client.query(`INSERT INTO audit_logs(actor_admin_id, action, target_type, target_id, details)
        VALUES ($1, 'llm_profile.updated', 'llm_profile', $2, $3)`, [actorId, String(id), JSON.stringify({ fields: Object.keys(parsed.data) })]);
      return result;
    });
    if (existing.isDefault) await this.activateRuntime(row);
    return this.toView(row);
  }

  async activate(actorId: number, id: number): Promise<LlmProfileView> {
    const row = await this.find(id);
    if (!row) throw new NotFoundException('LLM profile not found');
    if (!row.enabled) throw new BadRequestException('Disabled profile cannot be activated');
    const active = await this.database.transaction(async (client) => {
      await client.query('UPDATE llm_profiles SET is_default = FALSE, updated_at = now() WHERE is_default = TRUE');
      const updated = await client.query<ProfileRow>(`UPDATE llm_profiles SET is_default = TRUE, updated_at = now() WHERE id = $1 RETURNING ${this.returningColumns()}`, [id]);
      await client.query(`INSERT INTO audit_logs(actor_admin_id, action, target_type, target_id)
        VALUES ($1, 'llm_profile.activated', 'llm_profile', $2)`, [actorId, String(id)]);
      return updated.rows[0];
    });
    await this.activateRuntime(active);
    return this.toView(active);
  }

  async setEnabled(actorId: number, id: number, enabled: boolean): Promise<LlmProfileView> {
    const row = await this.find(id);
    if (!row) throw new NotFoundException('LLM profile not found');
    if (!enabled && row.isDefault) throw new BadRequestException('Activate another profile before disabling the default');
    const updated = await this.database.query<ProfileRow>(`UPDATE llm_profiles SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING ${this.returningColumns()}`, [id, enabled]);
    await this.database.query(`INSERT INTO audit_logs(actor_admin_id, action, target_type, target_id, details)
      VALUES ($1, 'llm_profile.updated', 'llm_profile', $2, $3)`, [actorId, String(id), JSON.stringify({ enabled })]);
    return this.toView(updated.rows[0]);
  }

  async test(id: number): Promise<{ ok: true; model: string; durationMs: number }> {
    const row = await this.find(id);
    if (!row) throw new NotFoundException('LLM profile not found');
    const provider = this.registry.createFromProfile(await this.hydrate(row));
    const response = await provider.chat({ model: String(row.model), messages: [{ role: 'user', content: '只回复：连接成功' }], maxTokens: 16 });
    return { ok: true, model: response.model, durationMs: response.durationMs };
  }

  private async find(id: number): Promise<ProfileRow | null> {
    const result = await this.database.query<ProfileRow>(`${this.selectSql('WHERE id = $1 LIMIT 1')}`, [id]);
    return result.rows[0] ?? null;
  }

  private async hydrate(row: ProfileRow): Promise<LlmProfileRecord> {
    const profile = this.toRecord(row);
    if (typeof row.api_key_ciphertext === 'string' && row.api_key_ciphertext) profile.apiKey = this.secrets.decrypt(row.api_key_ciphertext);
    else profile.apiKey = this.config.llm.apiKey;
    if (!profile.apiKey) throw new BadRequestException('API Key is not configured');
    return profile;
  }

  private async activateRuntime(row: ProfileRow): Promise<void> { this.registry.activateProfile(await this.hydrate(row)); }

  private validateBaseUrl(value: string): void {
    const target = new URL(value);
    const normalized = target.href.replace(/\/+$/, '');
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash
      || !this.config.llm.allowedBaseUrls.some((allowed) => allowed.replace(/\/+$/, '') === normalized)) {
      throw new BadRequestException('Base URL must be an approved HTTPS OpenAI Compatible endpoint');
    }
  }

  private selectSql(suffix: string): string {
    return `SELECT id::int, name, provider_key, adapter_type, base_url, model, api_key_ciphertext,
      timeout_ms, context_window_tokens, max_output_tokens, structured_output,
      supports_tool_calls, supports_streaming, enabled, is_default FROM llm_profiles ${suffix}`;
  }

  private returningColumns(): string {
    return `id::int, name, provider_key, adapter_type, base_url, model, api_key_ciphertext,
      timeout_ms, context_window_tokens, max_output_tokens, structured_output,
      supports_tool_calls, supports_streaming, enabled, is_default`;
  }

  private insertSql(): string {
    return `INSERT INTO llm_profiles
      (name, provider_key, adapter_type, base_url, model, api_key_ciphertext,
       timeout_ms, context_window_tokens, max_output_tokens, structured_output,
       supports_tool_calls, supports_streaming)
      VALUES ($1, 'openai-compatible', 'openai-compatible', $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
  }

  private toRecord(row: ProfileRow): LlmProfileRecord {
    return {
      id: Number(row.id), name: String(row.name), providerKey: 'openai-compatible', adapterType: 'openai-compatible',
      baseUrl: String(row.base_url), model: String(row.model), timeoutMs: Number(row.timeout_ms), contextWindowTokens: Number(row.context_window_tokens),
      maxOutputTokens: Number(row.max_output_tokens), structuredOutput: row.structured_output === 'required' || row.structured_output === 'disabled' ? row.structured_output : 'auto',
      supportsToolCalls: Boolean(row.supports_tool_calls), supportsStreaming: Boolean(row.supports_streaming), enabled: Boolean(row.enabled), isDefault: Boolean(row.is_default),
    };
  }

  private toView(row: ProfileRow): LlmProfileView {
    return { ...this.toRecord(row), hasApiKey: Boolean(row.api_key_ciphertext) || Boolean(this.config.llm.apiKey) };
  }
}
