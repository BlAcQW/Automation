/**
 * Disconnecting an organisation's Facebook Page (Messenger) and the Instagram
 * account that rides on it. Shared by the owner's /channels routes and the
 * platform admin (routes/admin/channels.ts). The caller audits.
 */

import { decrypt } from './crypto.js';
import { unsubscribePage } from './meta-pages.js';
import { scrubMetaText } from './meta-graph.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export const CLEARED_FACEBOOK = {
    facebookPageId: null,
    facebookPageName: null,
    facebookPageToken: null,
    facebookConnectedAt: null,
    facebookConnectedByUserId: null,
    instagramUserId: null,
    instagramUsername: null,
    instagramConnectedAt: null,
} as const;

export interface FacebookDisconnectOutcome {
    hadPage: boolean;
    pageId: string | null;
    pageName: string | null;
    instagramUsername: string | null;
    metaCleanup: 'unsubscribed_page' | 'skipped' | 'failed';
}

/**
 * Unsubscribe the Page from our app (best effort: a Meta failure never traps a
 * tenant in a connection) and clear the Page + Instagram columns.
 */
export async function disconnectFacebookPage(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    log: { error: (obj: object, msg: string) => void },
): Promise<FacebookDisconnectOutcome> {
    const db = prisma;
    const t = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { facebookPageId: true, facebookPageName: true, facebookPageToken: true, instagramUsername: true },
    });
    let metaCleanup: FacebookDisconnectOutcome['metaCleanup'] = 'skipped';
    if (t?.facebookPageId && t.facebookPageToken) {
        try {
            await unsubscribePage(t.facebookPageId, decrypt(t.facebookPageToken));
            metaCleanup = 'unsubscribed_page';
        } catch (err) {
            metaCleanup = 'failed';
            log.error({ reason: scrubMetaText((err as Error).message) }, 'page unsubscribe failed — subscription may need manual cleanup');
        }
    }
    await db.tenant.update({ where: { id: tenantId }, data: CLEARED_FACEBOOK });
    return {
        hadPage: !!t?.facebookPageId,
        pageId: t?.facebookPageId ?? null,
        pageName: t?.facebookPageName ?? null,
        instagramUsername: t?.instagramUsername ?? null,
        metaCleanup,
    };
}

/** Stop routing Instagram for this tenant; the Page (Messenger) stays connected. */
export async function unlinkInstagram(prisma: ExtendedPrismaClient, tenantId: string): Promise<{ hadInstagram: boolean; instagramUsername: string | null }> {
    const db = prisma;
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { instagramUserId: true, instagramUsername: true } });
    await db.tenant.update({
        where: { id: tenantId },
        data: { instagramUserId: null, instagramUsername: null, instagramConnectedAt: null },
    });
    return { hadInstagram: !!t?.instagramUserId, instagramUsername: t?.instagramUsername ?? null };
}
