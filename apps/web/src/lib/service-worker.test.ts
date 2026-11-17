import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const SW_SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://booklygh.com';

type FetchHandler = (event: FakeFetchEvent) => void;

interface FakeFetchEvent {
    request: Request;
    respondWith: (response: Promise<unknown> | unknown) => void;
}

/** Runs public/sw.js against a fake worker scope and returns its fetch handler. */
function loadServiceWorker(opts: { network: 'up' | 'down'; cached?: Record<string, Response> }) {
    const handlers: Record<string, FetchHandler> = {};
    const cached = opts.cached ?? {};
    const cachePut = vi.fn();
    const scope = {
        self: {
            location: { origin: ORIGIN },
            addEventListener: (type: string, fn: FetchHandler) => { handlers[type] = fn; },
            skipWaiting: () => undefined,
            clients: { claim: () => undefined },
        },
        caches: {
            match: async (req: Request | string) => cached[typeof req === 'string' ? req : new URL(req.url).pathname],
            open: async () => ({ put: cachePut, addAll: async () => undefined }),
            keys: async () => [],
            delete: async () => true,
        },
        fetch: async () => {
            if (opts.network === 'down') throw new TypeError('Failed to fetch');
            return new Response('fresh', { status: 200 });
        },
        Response,
        URL,
    };
    runInNewContext(SW_SOURCE, scope);
    return { onFetch: handlers.fetch, cachePut };
}

/** Dispatches a fetch the way the browser does; resolves with what respondWith got, or null if not intercepted. */
async function dispatch(onFetch: FetchHandler, request: Request): Promise<unknown | null> {
    let answer: Promise<unknown> | unknown = null;
    onFetch({ request, respondWith: (r) => { answer = r; } });
    return answer === null ? null : await answer;
}

describe('service worker', () => {
    it('answers a failed static-file request with a real Response, never undefined', async () => {
        // Arrange: offline, and the file was never cached.
        const { onFetch } = loadServiceWorker({ network: 'down' });

        // Act
        const answer = await dispatch(onFetch, new Request(`${ORIGIN}/icons/icon-192.png`));

        // Assert: undefined here is what the browser reports as
        // "Failed to convert value to 'Response'".
        expect(answer).toBeInstanceOf(Response);
    });

    it('leaves Next.js in-app page data (RSC) to the network and never caches it', async () => {
        // Arrange: Next.js fetches /settings?_rsc=… with an RSC header when you open Settings from the menu.
        const { onFetch, cachePut } = loadServiceWorker({ network: 'up' });
        const rsc = new Request(`${ORIGIN}/settings?_rsc=abc12`, { headers: { RSC: '1' } });

        // Act
        const answer = await dispatch(onFetch, rsc);

        // Assert
        expect(answer).toBeNull();
        expect(cachePut).not.toHaveBeenCalled();
    });

    it('still serves the offline page when a full page load fails', async () => {
        // Arrange
        const offline = new Response('offline page', { status: 200 });
        const { onFetch } = loadServiceWorker({ network: 'down', cached: { '/offline': offline } });
        const navigation = new Request(`${ORIGIN}/settings`);
        Object.defineProperty(navigation, 'mode', { value: 'navigate' });

        // Act
        const answer = await dispatch(onFetch, navigation);

        // Assert
        expect(answer).toBe(offline);
    });
});
