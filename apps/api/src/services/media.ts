/**
 * Outbound media for human replies (images, video, documents).
 *
 * Two copies of every attachment exist, deliberately:
 *
 *  1. Meta's servers — we upload the bytes to the Cloud API `/media` endpoint
 *     and send the message by `id`. Sending by `link` instead would require
 *     exposing a publicly fetchable URL for every customer attachment; by
 *     uploading we keep the file private and let Meta hold the copy it needs.
 *  2. Local disk — Meta's media IDs expire (~30 days) and reading them back
 *     needs the tenant's token, so the dashboard would eventually show broken
 *     images. Our own copy is what the web and mobile apps render, served by
 *     an authenticated, tenant-scoped route.
 *
 * Storage is the local filesystem under MEDIA_DIR. That suits the current
 * single-process deployment; moving to multiple instances means moving this to
 * object storage, and only this file should need to change.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Every type WhatsApp accepts, with the Prisma MessageType it maps to. */
const ACCEPTED: Record<string, { kind: MediaKind; ext: string }> = {
    'image/jpeg': { kind: 'image', ext: 'jpg' },
    'image/png': { kind: 'image', ext: 'png' },
    'image/webp': { kind: 'sticker', ext: 'webp' },
    'video/mp4': { kind: 'video', ext: 'mp4' },
    'video/3gpp': { kind: 'video', ext: '3gp' },
    'audio/aac': { kind: 'audio', ext: 'aac' },
    'audio/mpeg': { kind: 'audio', ext: 'mp3' },
    'audio/amr': { kind: 'audio', ext: 'amr' },
    'audio/ogg': { kind: 'audio', ext: 'ogg' },
    'application/pdf': { kind: 'document', ext: 'pdf' },
};

export type MediaKind = 'image' | 'video' | 'audio' | 'sticker' | 'document';

/** Prisma MessageType for a given attachment. */
export const MESSAGE_TYPE: Record<MediaKind, 'IMAGE' | 'VIDEO' | 'AUDIO' | 'STICKER' | 'DOCUMENT'> = {
    image: 'IMAGE',
    video: 'VIDEO',
    audio: 'AUDIO',
    sticker: 'STICKER',
    document: 'DOCUMENT',
};

/** Meta's own per-type ceilings. Rejecting here saves a doomed round trip. */
/** Meta's own per-type ceilings. Rejecting here saves a doomed round trip. */
const MAX_BYTES: Record<MediaKind, number> = {
    image: 5 * 1024 * 1024,
    sticker: 500 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
};

export interface StoredMedia {
    /** Path relative to MEDIA_DIR — what goes in Message.metadata. */
    relativePath: string;
    kind: MediaKind;
    mimeType: string;
    size: number;
}

export function mediaRoot(): string {
    return process.env.MEDIA_DIR ?? path.resolve(process.cwd(), 'var/media');
}

export class MediaError extends Error {}

export function classify(mimeType: string): { kind: MediaKind; ext: string } {
    const match = ACCEPTED[mimeType.toLowerCase()];
    if (!match) {
        throw new MediaError(
            `Unsupported file type "${mimeType}". Allowed: ${Object.keys(ACCEPTED).join(', ')}.`,
        );
    }
    return match;
}

export function assertWithinLimit(kind: MediaKind, size: number): void {
    const max = MAX_BYTES[kind];
    if (size > max) {
        throw new MediaError(
            `File is too large for WhatsApp (${(size / 1024 / 1024).toFixed(1)}MB). ` +
            `The limit for ${kind} is ${max / 1024 / 1024}MB.`,
        );
    }
}

/** Write bytes under MEDIA_DIR/<tenantId>/ with an unguessable name. */
export async function storeMedia(args: {
    tenantId: string;
    mimeType: string;
    buffer: Buffer;
}): Promise<StoredMedia> {
    const { kind, ext } = classify(args.mimeType);
    assertWithinLimit(kind, args.buffer.byteLength);

    const dir = path.join(mediaRoot(), args.tenantId);
    await mkdir(dir, { recursive: true });

    const relativePath = path.join(args.tenantId, `${randomUUID()}.${ext}`);
    await writeFile(path.join(mediaRoot(), relativePath), args.buffer);

    return { relativePath, kind, mimeType: args.mimeType, size: args.buffer.byteLength };
}

/**
 * Resolve a stored path to an absolute one, refusing anything that escapes
 * MEDIA_DIR. The value comes from the database rather than a request, but a
 * traversal check is cheap and this function reads files off disk.
 */
export function resolveStoredPath(relativePath: string): string {
    const root = mediaRoot();
    const full = path.resolve(root, relativePath);
    if (full !== root && !full.startsWith(root + path.sep)) {
        throw new MediaError('Invalid media path');
    }
    return full;
}

export async function openStoredMedia(relativePath: string) {
    const full = resolveStoredPath(relativePath);
    const info = await stat(full);
    return { stream: createReadStream(full), size: info.size };
}

export async function deleteStoredMedia(relativePath: string): Promise<void> {
    await unlink(resolveStoredPath(relativePath)).catch(() => undefined);
}

/**
 * Upload bytes to the tenant's WhatsApp number and return Meta's media id.
 * Throws on failure so the caller can avoid persisting a message that was
 * never actually sent.
 */
export async function uploadToWhatsApp(args: {
    phoneNumberId: string;
    accessToken: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
}): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', args.mimeType);
    form.append(
        'file',
        new Blob([new Uint8Array(args.buffer)], { type: args.mimeType }),
        args.filename,
    );

    const response = await fetch(
        `https://graph.facebook.com/v21.0/${args.phoneNumberId}/media`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${args.accessToken}` },
            body: form,
        },
    );

    const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: unknown };
    if (!response.ok || !payload.id) {
        throw new MediaError(
            `WhatsApp rejected the upload: ${JSON.stringify(payload.error ?? response.status)}`,
        );
    }
    return payload.id;
}
