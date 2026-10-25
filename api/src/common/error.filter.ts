import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppError, Errors } from './errors';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

const zodDetails = (err: ZodError) => err.issues.map((i) => ({ path: i.path, message: i.message }));

/** Toda respuesta de error sale como { code, message, details }. */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    if (!res.headersSent) res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    const fromApp = (e: AppError) => ({
      status: e.status,
      body: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) },
    });

    if (exception instanceof AppError) return fromApp(exception);

    if (exception instanceof ZodValidationException) {
      const zerr = exception.getZodError();
      return fromApp(Errors.validation(zerr instanceof ZodError ? zodDetails(zerr) : undefined));
    }
    if (exception instanceof ZodError) return fromApp(Errors.validation(zodDetails(exception)));

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return fromApp(Errors.conflict('CONFLICT', 'Ese valor ya está en uso.'));
      if (exception.code === 'P2025') return fromApp(Errors.notFound());
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return fromApp(Errors.notFound('esa ruta'));
      if (status === 413) return fromApp(new AppError('PAYLOAD_TOO_LARGE', 413, 'La solicitud es demasiado grande.'));
      if (status === 400) {
        // ParseUUIDPipe, JSON mal formado, etc.
        return fromApp(Errors.validation(undefined, 'La solicitud no tiene un formato válido.'));
      }
      if (status < 500) return fromApp(new AppError('HTTP_ERROR', status, 'No pudimos procesar la solicitud.'));
    }
    return fromApp(Errors.internal());
  }
}
