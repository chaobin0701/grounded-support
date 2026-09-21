import { Injectable } from '@nestjs/common';
import { AppConfig, EmbeddingConfig, JwtConfig, LlmConfig, readConfigEnvironment, SecurityConfig } from './config.schema';

@Injectable()
export class AppConfigService {
  readonly config: AppConfig;

  constructor() {
    this.config = readConfigEnvironment();
  }

  get port(): number {
    return this.config.port;
  }

  get llm(): LlmConfig {
    return this.config.llm;
  }

  get databaseUrl(): string {
    return this.config.databaseUrl;
  }

  get uploadRoot(): string {
    return this.config.uploadRoot;
  }

  get jwt(): JwtConfig {
    return this.config.jwt;
  }

  get security(): SecurityConfig {
    return this.config.security;
  }

  get embedding(): EmbeddingConfig {
    return this.config.embedding;
  }
}
