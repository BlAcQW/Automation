/**
 * One place where every unhandled error becomes an HTTP response.
 *
 * Without this, Fastify's default turns a Zod validation failure into a 500
 * carrying the raw schema error — which is wrong three ways: it is a client
 * error reported as a server error, it publishes the internal validation shape,
 * and it buries genuine 500s in monitoring under a pile of user typos.
 *
 * Rules:
 *  - ZodError            -> 400 with field-level messages the UI can show
 *  - Prisma known errors -> 404 / 409 as appropriate, never the raw driver text
 *  - http-errors         -> passed through untouched (fastify-sensible)
 *  - anything else       -> 500, logged in full, but the client sees only a
 *                           generic message and the request id
 */

import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

interface FieldError {
    field: string;
    message: string;
}

function zodFields(err: ZodError): FieldError[] {
    return err.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
    }));
}

export default fp(async (app) => {
    app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        // --- validation ------------------------------------------------------
        if (error instanceof ZodError) {
            const fields = zodFields(error);
            request.log.info({ fields, url: request.url }, 'Request failed validation');
            return reply.status(400).send({
                statusCode: 400,
                error: 'Bad Request',
                message: fields.map((f) => `${f.field}: ${f.message}`).join('; '),
                fields,
            });
        }

        // Fastify's own schema validation, if a route ever uses it.
        if (error.validation) {
            return reply.status(400).send({
                statusCode: 400,
                error: 'Bad Request',
                message: error.message,
            });
        }

        // --- Prisma ----------------------------------------------------------
        // Codes are stable; the messages are not, and they name columns and
        // constraints we should not expose.
        const code = (error as { code?: string }).code;
        if (code === 'P2025') {
            return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found.' });
        }
        if (code === 'P2002') {
            return reply.status(409).send({
                statusCode: 409,
                error: 'Conflict',
                message: 'That already exists.',
            });
        }
        if (code === 'P2003') {
            return reply.status(400).send({
                statusCode: 400,
                error: 'Bad Request',
                message: 'Referenced record does not exist.',
            });
        }

        // --- explicit http errors (fastify-sensible, httpErrors.*) -----------
        const status = error.statusCode ?? 500;
        if (status < 500) {
            return reply.status(status).send({
                statusCode: status,
                error: error.name ?? 'Error',
                message: error.message,
            });
        }

        // --- everything else --------------------------------------------------
        // Log the whole thing; tell the client nothing but the request id, so a
        // support conversation can still find this exact failure in the logs.
        request.log.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');
        return reply.status(500).send({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Something went wrong on our side. Please try again.',
            requestId: request.id,
        });
    });
}, { name: 'error-handler' });
