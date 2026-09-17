import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

@Injectable()
export class ChatRateLimitService {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private active = 0;

  async run<T>(ip: string, task: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const previous = this.windows.get(ip);
    const window = previous && previous.resetAt > now ? previous : { count: 0, resetAt: now + 60_000 };
    if (!previous && this.windows.size >= 10_000) {
      for (const [key, value] of this.windows) if (value.resetAt <= now) this.windows.delete(key);
      if (this.windows.size >= 10_000) throw new HttpException('Chat is busy; please try again shortly', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (window.count >= 10 || this.active >= 5) throw new HttpException('Chat is busy; please try again shortly', HttpStatus.TOO_MANY_REQUESTS);
    window.count += 1;
    this.windows.set(ip, window);
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
    }
  }
}
