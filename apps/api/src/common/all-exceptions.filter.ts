import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@pulseops/shared';

const STATUS_PT: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  409: 'Conflito',
  429: 'Muitas requisições',
  500: 'Erro interno do servidor',
};

/** Normaliza erros. Nunca expõe stack traces nem mensagens internas em 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = STATUS_PT[status] ?? 'Erro';
    let details: unknown;
    if (exception instanceof HttpException && status < 500) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as { message?: unknown; details?: unknown };
        if (typeof b.message === 'string' && status !== 404) message = b.message;
        details = b.details;
      }
    } else if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const payload: ApiError = {
      statusCode: status,
      error: STATUS_PT[status] ?? 'Erro',
      message,
      details,
    };
    res.status(status).json(payload);
  }
}
