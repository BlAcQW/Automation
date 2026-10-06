import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

const pages = vi.hoisted(() => ({ subscribePageToWebhooks: vi.fn(), unsubscribePage: vi.fn() }));
vi.mock('../../services/meta-pages.js', async (orig) => ({
    ...(await orig<typeof import('../../services/meta-pages.js')>()),
    subscribePageToWebhooks: pages.subscribePageToWebhooks,
    unsubscribePage: pages.unsubscribePage,
}));

import channelRoutes from './index.js';
import { encrypt } from '../../services/crypto.js';

let tenant: Record<string, any>;
const audits: any[] = [];

async function build() {
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', {
        tenant: {
            findUnique: vi.fn(async () => ({ ...tenant })),
            findFirst: vi.fn(async () => null),
            update: vi.fn(async ({ data }: any) => { tenant = { ...tenant, ...data }; return tenant; }),
        },
        auditLog: { create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }) },
    } as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role: 'OWNER' }; });
    await app.register(channelRoutes, { prefix: '/channels' });
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
    audits.length = 0;
    tenant = { id: 't1', facebookPageId: null, facebookPageToken: null, instagramUserId: null, whatsappPhoneNumberId: null, whatsappHosted: false };
    pages.subscribePageToWebhooks.mockResolvedValue(undefined);
    pages.unsubscribePage.mockResolvedValue(undefined);
});

describe('Facebook / Instagram connection bookkeeping', () => {
    it('select records who connected the Page and Instagram, and when', async () => {
        const app = await build();
        const selectionToken = encrypt(JSON.stringify({
            at: Date.now(),
            pages: [{ pageId: 'pg1', pageName: 'TURBO Page', pageToken: 'page-tok', instagramUserId: 'ig1', instagramUsername: 'turbo.rides' }],
        }));
        const res = await app.inject({ method: 'POST', url: '/channels/facebook/select', payload: { selectionToken, pageId: 'pg1' } });
        expect(res.statusCode).toBe(200);
        expect(tenant).toMatchObject({ facebookPageId: 'pg1', facebookConnectedByUserId: 'u1', instagramUserId: 'ig1' });
        expect(tenant.facebookConnectedAt).toBeInstanceOf(Date);
        expect(tenant.instagramConnectedAt).toEqual(tenant.facebookConnectedAt);

        const status = (await app.inject({ method: 'GET', url: '/channels/status' })).json();
        expect(status.messenger).toMatchObject({ connected: true, pageName: 'TURBO Page' });
        expect(status.instagram).toMatchObject({ connected: true, username: 'turbo.rides' });
        expect(status.messenger.connectedAt).toBeTruthy();
    });

    it('disconnect unsubscribes the Page, clears the connection record and audits it', async () => {
        tenant = { ...tenant, facebookPageId: 'pg1', facebookPageName: 'TURBO Page', facebookPageToken: encrypt('page-tok'), facebookConnectedAt: new Date(), instagramUserId: 'ig1', instagramUsername: 'turbo.rides' };
        const app = await build();
        const res = await app.inject({ method: 'POST', url: '/channels/facebook/disconnect' });
        expect(res.statusCode).toBe(200);
        expect(pages.unsubscribePage).toHaveBeenCalledWith('pg1', 'page-tok');
        expect(tenant).toMatchObject({ facebookPageId: null, facebookConnectedAt: null, facebookConnectedByUserId: null, instagramUserId: null, instagramConnectedAt: null });
        expect(audits[0]).toMatchObject({ action: 'channels.facebook_disconnected', metadata: { pageName: 'TURBO Page', metaCleanup: 'unsubscribed_page', by: 'owner' } });
    });
});
