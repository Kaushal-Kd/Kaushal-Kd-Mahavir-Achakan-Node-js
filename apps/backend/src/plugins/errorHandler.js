import fp from 'fastify-plugin';

import { AppError } from '../utils/errors.js';

async function errorHandlerPlugin(fastify) {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: error.message, details: error.validation },
      });
    }

    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    request.log.error({ err: error }, 'Request failed');
    return reply.status(status).send({
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: status >= 500 ? 'Internal server error' : error.message,
      },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      ok: false,
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'errorHandler' });
