import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { SecurityRateLimitService } from '../security/security-rate-limit.service';

@Injectable()
export class ChatRateLimitService {
  private readonly limiter: SecurityRateLimitService;

  constructor(@Optional() limiter?: SecurityRateLimitService, @Optional() config?: AppConfigService) {
    this.limiter = limiter ?? new SecurityRateLimitService(config);
  }

  async run<T>(ip: string, task: () => Promise<T>): Promise<T> {
    return this.limiter.run('chat', ip, task);
  }
}
