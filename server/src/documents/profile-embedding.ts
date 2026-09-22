import { z } from 'zod';
import { AppConfigService } from '../config/config.service';

export const embeddingProfileSchema = z.object({
  provider: z.enum(['openai-compatible', 'volcengine-multimodal']),
  baseUrl: z.string().url(), model: z.string().trim().min(1).max(200),
  dimensions: z.number().int().min(1).max(4096),
  maxInputChars: z.number().int().min(200).max(32000).default(8000),
  batchSize: z.number().int().min(1).max(64).default(16),
  secretRef: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/u).default('default'),
}).strict();
export type EmbeddingProfile = z.infer<typeof embeddingProfileSchema>;

/** Explicit credential binding: a profile cannot read arbitrary environment variables.
 * The approved endpoint is deployment configuration, not an admin-supplied SSRF target. */
export function validateProfileEndpoint(profile: EmbeddingProfile, config: AppConfigService): void {
  const target = new URL(profile.baseUrl);
  const connection = profile.secretRef === 'default' ? config.embedding : config.embedding.connections?.[profile.secretRef];
  if (!connection) throw new Error('Unknown embedding credential reference');
  const approved = new URL(connection.baseUrl);
  if (target.username || target.password || target.search || target.hash ||
      target.href.replace(/\/+$/, '') !== approved.href.replace(/\/+$/, '')) {
    throw new Error('Embedding base URL must match the configured EMBEDDING_BASE_URL');
  }
}

export async function embedWithProfile(profile: EmbeddingProfile, inputs: string[], config: AppConfigService): Promise<number[][]> {
  validateProfileEndpoint(profile, config);
  const connection = profile.secretRef === 'default' ? config.embedding : config.embedding.connections?.[profile.secretRef];
  if (!connection?.apiKey) throw new Error('Embedding credential is not configured');
  if (inputs.some((input) => !input.trim() || Array.from(input).length > profile.maxInputChars)) throw new Error('Embedding input exceeds profile limit');
  const batchSize = profile.provider === 'volcengine-multimodal' ? 1 : profile.batchSize;
  const vectors: number[][] = [];
  const vectorSchema = z.array(z.number().finite()).length(profile.dimensions).refine((v) => v.some((n) => n !== 0));
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const batch = inputs.slice(offset, offset + batchSize);
    const multimodal = profile.provider === 'volcengine-multimodal';
    let response: Response;
    try {
      response = await fetch(`${profile.baseUrl.replace(/\/+$/, '')}/embeddings${multimodal ? '/multimodal' : ''}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: profile.model, encoding_format: 'float',
          input: multimodal ? [{ type: 'text', text: batch[0] }] : batch }),
      });
    } catch { throw new Error('Embedding request failed or timed out'); }
    if (!response.ok) throw new Error(`Embedding returned HTTP ${response.status}`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('Invalid embedding response'); }
    if (multimodal) vectors.push(z.object({ data: z.object({ embedding: vectorSchema }) }).parse(payload).data.embedding);
    else {
      const data = z.object({ data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: vectorSchema })).length(batch.length) }).parse(payload).data;
      data.sort((a, b) => a.index - b.index);
      if (data.some((item, index) => item.index !== index)) throw new Error('Invalid embedding batch indexes');
      vectors.push(...data.map((item) => item.embedding));
    }
  }
  return vectors;
}
