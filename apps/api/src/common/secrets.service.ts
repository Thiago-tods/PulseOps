import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SecretBox } from '@pulseops/db';
import type { AppEnv } from '../config/env';
import { splitKeys } from '../config/env';
import { APP_ENV } from './app-env';

/** Cifra e decifra segredos de webhook com a chave do ambiente (AES-256-GCM). */
@Injectable()
export class SecretsService {
  private cached: SecretBox | undefined;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  get box(): SecretBox {
    if (!this.cached) {
      if (!this.env.WEBHOOK_ENCRYPTION_KEY) {
        // Não vaza detalhes de configuração ao cliente; o motivo vai para o log do servidor.
        new Logger(SecretsService.name).error('WEBHOOK_ENCRYPTION_KEY não configurada');
        throw new ServiceUnavailableException('Recurso indisponível nesta instalação');
      }
      this.cached = new SecretBox(
        this.env.WEBHOOK_ENCRYPTION_KEY,
        splitKeys(this.env.WEBHOOK_ENCRYPTION_KEY_PREVIOUS),
      );
    }
    return this.cached;
  }
}
