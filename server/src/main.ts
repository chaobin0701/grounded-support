import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { HttpExceptionFilter } from './security/http-exception.filter';
import { RequestContextMiddleware } from './security/request-context.middleware';
import { RequestLoggerMiddleware } from './security/request-logger.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);
  app.getHttpAdapter().getInstance().set('trust proxy', config.security.trustProxy);
  app.enableCors({ origin: config.security.allowedOrigins.length ? config.security.allowedOrigins : false, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.use(app.get(RequestContextMiddleware).use.bind(app.get(RequestContextMiddleware)));
  app.use(app.get(RequestLoggerMiddleware).use.bind(app.get(RequestLoggerMiddleware)));
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
