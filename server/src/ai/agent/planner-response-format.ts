import type { LlmResponseFormat } from '../providers/provider.types';

/**
 * The planner has two valid content shapes: public commentary alongside
 * native tool calls, or the final answer envelope. Keep both shapes valid
 * while constraining known fields; the Agent parser remains authoritative for
 * required fields and tool safety.
 */
export const PLANNER_RESPONSE_FORMAT: LlmResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'agent_response',
    strict: false,
    schema: {
      type: 'object',
      properties: {
        commentary: { type: 'string', maxLength: 160 },
        type: { type: 'string', enum: ['final'] },
        status: { type: 'string', enum: ['answered', 'refused'] },
        answer: { type: 'string', maxLength: 1200 },
        citationIds: { type: 'array', items: { type: 'integer' }, maxItems: 5 },
        productIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      },
      additionalProperties: false,
    },
  },
};
