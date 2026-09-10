import { isSafeThumbObjectPath } from '@wrs/shared';
import { z } from 'zod';

import { env } from '../../config/env.js';
import {
  createSignedReadUrl,
  createSignedUploadUrl,
  deleteObject,
  gcsInfo,
} from '../../services/gcs.js';
import { badRequest } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

const signedUrlSchema = z.object({
  folder: z.string().trim().max(80).default('misc'),
  content_type: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().nonnegative().optional(),
  object_path: z.string().trim().min(1).max(400).optional(),
});

const signedReadSchema = z.object({
  object_path: z.string().trim().min(1),
  ttl_seconds: z.coerce.number().int().positive().max(86400).optional(),
});

const deleteSchema = z.object({
  object_path: z.string().trim().min(1),
});

export default async function uploadsRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/status', async () => ({
    ok: true,
    data: {
      enabled: gcsInfo.enabled,
      bucket: gcsInfo.bucket,
      project_id: gcsInfo.projectId,
      client_email: gcsInfo.clientEmail,
      max_bytes: env.GCS_UPLOAD_MAX_BYTES,
      allowed_mime: env.GCS_UPLOAD_ALLOWED_MIME,
    },
  }));

  fastify.post('/signed-url', async (request) => {
    const body = validate(signedUrlSchema, request.body || {});
    if (body.size && body.size > env.GCS_UPLOAD_MAX_BYTES) {
      throw badRequest(
        `File too large (${body.size} bytes, max ${env.GCS_UPLOAD_MAX_BYTES})`
      );
    }
    if (body.object_path && !isSafeThumbObjectPath(body.object_path)) {
      throw badRequest('object_path must be a .thumb.webp object');
    }
    const data = await createSignedUploadUrl({
      folder: body.folder,
      contentType: body.content_type,
      shopId: request.shopId || null,
      objectPath: body.object_path,
    });
    await request.audit('uploads', 'SIGN_WRITE', {
      new: { object_path: data.objectPath, folder: body.folder },
    });
    return {
      ok: true,
      data: {
        upload_url: data.uploadUrl,
        object_path: data.objectPath,
        public_url: data.publicUrl,
        expires_at: data.expiresAt,
      },
    };
  });

  fastify.post('/read-url', async (request) => {
    const body = validate(signedReadSchema, request.body || {});
    const data = await createSignedReadUrl(body.object_path, body.ttl_seconds);
    return { ok: true, data };
  });

  fastify.delete('/', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const body = validate(deleteSchema, request.body || {});
    await deleteObject(body.object_path);
    await request.audit('uploads', 'DELETE', { new: { object_path: body.object_path } });
    return { ok: true, data: { object_path: body.object_path } };
  });
}
