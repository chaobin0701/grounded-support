import { Injectable } from '@nestjs/common';
import { AppConfig, LlmConfig, readConfigEnvironment } from './config.schema';

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
}
