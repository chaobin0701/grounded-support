import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

export const EMBEDDING_DIMENSIONS = 2048;

type EmbeddingResponse = {
  data?: { embedding?: number[] };
};

@Injectable()
export class EmbeddingService {
  readonly model: string;
  readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config?: AppConfigService) {
    const embedding = (config ?? new AppConfigService()).embedding;
    this.apiKey = embedding.apiKey;
    this.model = embedding.model;
    this.enabled = Boolean(this.apiKey);
    this.baseUrl = embedding.baseUrl.replace(/\/+$/, '');
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (!this.enabled) throw new ServiceUnavailableException('Embedding provider is not configured');
    const all: number[][] = [];
    // The multimodal API produces one vector for the entire input array, so
    // separate document chunks must be sent as separate requests.
    for (const input of inputs) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/embeddings/multimodal`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: this.model, input: [{ type: 'text', text: input }], encoding_format: 'float' }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new ServiceUnavailableException('Embedding provider is unavailable');
      }
      if (!response.ok) throw new ServiceUnavailableException(`Embedding provider returned HTTP ${response.status}`);
      let payload: EmbeddingResponse;
      try {
        payload = await response.json() as EmbeddingResponse;
      } catch {
        throw new ServiceUnavailableException('Embedding provider returned invalid JSON');
      }
      const vector = payload.data?.embedding;
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
        throw new ServiceUnavailableException('Embedding provider returned an invalid vector');
      }
      all.push(vector);
    }
    return all;
  }
}
