/**
 * SSRF protection for outgoing webhooks. Subscription URLs are tenant input, so
 * the server must never be steerable at loopback, the private network, cloud
 * metadata (169.254.169.254) or other internal services.
 *
 * Checked at subscription create AND on every delivery. On delivery the check
 * happens inside the socket's `lookup` (see guardedLookup), so the address that
 * was validated is the address connected to: no DNS-rebinding window between
 * check and connect. IP-literal hosts skip Node's lookup, so they are checked
 * up front (assertPublicHost).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsafeUrlError';
    }
}

type V4 = [number, number, number, number];

function parseV4(s: string): V4 | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    return parts.every((p) => p <= 255) ? (parts as V4) : null;
}

/** [prefix, bits] blocked IPv4 ranges. */
const BLOCKED_V4: Array<[V4, number]> = [
    [[0, 0, 0, 0], 8], // "this network", includes 0.0.0.0
    [[10, 0, 0, 0], 8],
    [[100, 64, 0, 0], 10], // CGNAT
    [[127, 0, 0, 0], 8],
    [[169, 254, 0, 0], 16], // link-local incl. metadata
    [[172, 16, 0, 0], 12],
    [[192, 0, 0, 0], 24],
    [[192, 0, 2, 0], 24],
    [[192, 88, 99, 0], 24], // 6to4 relay anycast (deprecated)
    [[192, 168, 0, 0], 16],
    [[198, 18, 0, 0], 15],
    [[198, 51, 100, 0], 24],
    [[203, 0, 113, 0], 24],
    [[224, 0, 0, 0], 4], // multicast
    [[240, 0, 0, 0], 4], // reserved + broadcast
];

const toInt = (a: V4): number => ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;

function v4Blocked(a: V4): boolean {
    const n = toInt(a);
    return BLOCKED_V4.some(([p, bits]) => {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        return ((n & mask) >>> 0) === ((toInt(p) & mask) >>> 0);
    });
}

/** Parse an IPv6 literal into eight 16-bit groups (handles ::, dotted tail, zone). */
function parseV6(input: string): number[] | null {
    let s = input.split('%')[0].toLowerCase();
    if (s.includes('.')) {
        const idx = s.lastIndexOf(':');
        const v4 = parseV4(s.slice(idx + 1));
        if (!v4) return null;
        s = `${s.slice(0, idx + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    }
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const parse = (str: string): number[] | null => {
        if (str === '') return [];
        const out: number[] = [];
        for (const g of str.split(':')) {
            if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
            out.push(parseInt(g, 16));
        }
        return out;
    };
    const head = parse(halves[0]);
    const tail = halves.length === 2 ? parse(halves[1]) : [];
    if (!head || !tail) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

const groupsToV4 = (hi: number, lo: number): V4 => [hi >> 8, hi & 255, lo >> 8, lo & 255];

function v6Blocked(g: number[]): boolean {
    const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
    if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
    if (allZero(0, 5) && g[5] === 0xffff) return v4Blocked(groupsToV4(g[6], g[7])); // ::ffff:a.b.c.d
    if (allZero(0, 6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
    if (g[0] === 0x100 && allZero(1, 4)) return true; // 100::/64 discard-only
    if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo (embeds a v4 server and client)
    if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return v4Blocked(groupsToV4(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return v4Blocked(groupsToV4(g[1], g[2])); // 6to4
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    return false;
}

/** True when the address must never be connected to. Unparseable input is blocked. */
export function isBlockedAddress(address: string): boolean {
    const a = address.trim().replace(/^\[|\]$/g, '');
    const fam = isIP(a.split('%')[0]);
    if (fam === 4) {
        const v4 = parseV4(a);
        return v4 ? v4Blocked(v4) : true;
    }
    if (fam === 6) {
        const g = parseV6(a);
        return g ? v6Blocked(g) : true;
    }
    return true;
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Resolve `hostname` and require EVERY address to be public (a name with one
 * private A record is refused outright). Returns the checked addresses.
 */
export async function assertPublicHost(
    hostname: string,
    resolver: Resolver = defaultResolver,
): Promise<Array<{ address: string; family: number }>> {
    const host = hostname.replace(/^\[|\]$/g, '');
    if (!host) throw new UnsafeUrlError('Webhook URL has no host');
    if (isIP(host.split('%')[0])) {
        if (isBlockedAddress(host)) throw new UnsafeUrlError('Webhook URL points at a private or reserved address');
        return [{ address: host, family: isIP(host.split('%')[0]) }];
    }
    let addrs: Array<{ address: string; family: number }>;
    try {
        addrs = await resolver(host);
    } catch {
        throw new UnsafeUrlError('Webhook host could not be resolved');
    }
    if (addrs.length === 0) throw new UnsafeUrlError('Webhook host could not be resolved');
    if (addrs.some((a) => isBlockedAddress(a.address))) {
        throw new UnsafeUrlError('Webhook host resolves to a private or reserved address');
    }
    return addrs;
}

/** Syntax rules: https only (http only in explicit development/test), no credentials, valid host. */
export function parseWebhookUrl(raw: string): URL {
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        throw new UnsafeUrlError('Webhook URL is not a valid URL');
    }
    // Plain http only when NODE_ENV is EXPLICITLY development or test: an unset
    // or unexpected value (a forgotten variable on a server) behaves as production.
    const allowHttp = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) {
        throw new UnsafeUrlError('Webhook URL must use https');
    }
    if (u.username || u.password) throw new UnsafeUrlError('Webhook URL must not contain credentials');
    if (!u.hostname) throw new UnsafeUrlError('Webhook URL has no host');
    return u;
}

/** Full create-time/delivery-time validation: syntax + resolve + address check. */
export async function validateWebhookUrl(raw: string, resolver?: Resolver): Promise<URL> {
    const u = parseWebhookUrl(raw);
    await assertPublicHost(u.hostname, resolver);
    return u;
}

/**
 * `lookup` for http(s).request: resolves and checks inside the connect path, so
 * the validated address is the one used. Handles both lookup call shapes.
 */
export function makeGuardedLookup(resolver: Resolver = defaultResolver) {
    return (hostname: string, options: any, callback: (...args: any[]) => void): void => {
        const cb = typeof options === 'function' ? options : callback;
        const opts = typeof options === 'function' ? {} : options ?? {};
        assertPublicHost(hostname, resolver).then(
            (addrs) => {
                if (opts.all) cb(null, addrs);
                else cb(null, addrs[0].address, addrs[0].family);
            },
            (err) => cb(err),
        );
    };
}
