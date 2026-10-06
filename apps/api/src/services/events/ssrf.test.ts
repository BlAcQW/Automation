import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicHost, isBlockedAddress, makeGuardedLookup, parseWebhookUrl, validateWebhookUrl } from './ssrf.js';
import { makePostJson } from './http.js';

describe('isBlockedAddress', () => {
    const blocked = [
        '127.0.0.1', '127.255.255.254', '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255',
        '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
        '169.254.169.254', '169.254.0.1', '100.64.0.1', '100.127.255.255',
        '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '240.0.0.1',
        '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1',
        '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:192.168.1.1', '::ffff:169.254.169.254',
        '::ffff:0.0.0.0', '[::1]', '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:a9fe:a9fe::1', '::127.0.0.1', '2001:db8::1',
        '192.88.99.1', '192.88.99.255', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:0:ffff:ffff::1',
        '64:ff9b:1::1', '64:ff9b:1:ffff::1', '100::1', '100:0:0:0:ffff:ffff:ffff:ffff',
        'not-an-ip', '', '1.2.3', '300.1.1.1',
    ];
    it.each(blocked)('blocks %s', (a) => expect(isBlockedAddress(a)).toBe(true));

    const allowed = [
        '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
        '169.253.1.1', '192.167.1.1', '11.0.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e',
        '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1',
        '192.88.98.255', '192.88.100.1', '2001:1::1', '2001:4860:4860::8888', '64:ff9b:2::1', '100:0:0:1::1', '101::1',
    ];
    it.each(allowed)('allows %s', (a) => expect(isBlockedAddress(a)).toBe(false));
});

describe('assertPublicHost', () => {
    it('refuses a name when ANY record is private, accepts all-public', async () => {
        await expect(assertPublicHost('evil.test', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }])).rejects.toThrow(/private or reserved/);
        await expect(assertPublicHost('ok.test', async () => [{ address: '8.8.8.8', family: 4 }])).resolves.toHaveLength(1);
    });
    it('refuses literals and unresolvable names without calling the resolver for literals', async () => {
        const resolver = async () => { throw new Error('should not resolve'); };
        await expect(assertPublicHost('127.0.0.1', resolver)).rejects.toThrow();
        await expect(assertPublicHost('[::1]', resolver)).rejects.toThrow();
        await expect(assertPublicHost('nx.test', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/could not be resolved/);
        await expect(assertPublicHost('empty.test', async () => [])).rejects.toThrow(/could not be resolved/);
    });
});

describe('parseWebhookUrl / validateWebhookUrl', () => {
    const env = process.env.NODE_ENV;
    afterEach(() => { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; });

    it('requires https in production, allows http elsewhere', () => {
        process.env.NODE_ENV = 'production';
        expect(() => parseWebhookUrl('http://example.com/h')).toThrow(/https/);
        expect(parseWebhookUrl('https://example.com/h').hostname).toBe('example.com');
        process.env.NODE_ENV = 'development';
        expect(parseWebhookUrl('http://example.com/h').protocol).toBe('http:');
    });
    it.each([undefined, '', 'staging', 'prod', 'Production'])('treats NODE_ENV=%s as production: http is refused', (value) => {
        if (value === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = value;
        expect(() => parseWebhookUrl('http://example.com/h')).toThrow(/https/);
        expect(parseWebhookUrl('https://example.com/h').protocol).toBe('https:');
    });
    it.each(['development', 'test'])('allows http only when NODE_ENV is explicitly %s', (value) => {
        process.env.NODE_ENV = value;
        expect(parseWebhookUrl('http://example.com/h').protocol).toBe('http:');
    });
    it('rejects other schemes, credentials, garbage', () => {
        for (const u of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com', 'not a url', '']) {
            expect(() => parseWebhookUrl(u)).toThrow();
        }
    });
    it('catches obfuscated loopback forms (the URL parser normalises them to dotted IPv4)', async () => {
        for (const u of ['https://2130706433/', 'https://0x7f.1/', 'https://017700000001/', 'https://127.1/', 'https://[::ffff:127.0.0.1]/', 'https://[::1]:8443/', 'https://169.254.169.254/latest/meta-data']) {
            await expect(validateWebhookUrl(u, async () => { throw new Error('no dns'); })).rejects.toThrow();
        }
    });
    it('rejects a public-looking name that resolves to metadata', async () => {
        await expect(validateWebhookUrl('https://rebind.example.com/h', async () => [{ address: '169.254.169.254', family: 4 }])).rejects.toThrow();
    });
});

describe('connect-time guard (DNS rebinding)', () => {
    it('guarded lookup re-checks at connect and returns the checked address', async () => {
        const answers = [[{ address: '8.8.8.8', family: 4 }], [{ address: '127.0.0.1', family: 4 }]];
        const lookup = makeGuardedLookup(async () => answers.shift()!);
        const first = await new Promise<any[]>((res) => lookup('h.test', {}, (...a: any[]) => res(a)));
        expect(first).toEqual([null, '8.8.8.8', 4]);
        const second = await new Promise<any[]>((res) => lookup('h.test', { all: true }, (...a: any[]) => res(a)));
        expect(second[0]).toBeInstanceOf(Error); // second resolution flipped to loopback -> refused
    });

    it('postJson refuses to connect to loopback/private targets', async () => {
        const post = makePostJson({ resolver: async () => [{ address: '10.0.0.9', family: 4 }] });
        await expect(post({ url: 'http://127.0.0.1:9/x', headers: {}, body: '{}' })).rejects.toThrow(/private or reserved/);
        await expect(post({ url: 'https://internal.example.com/x', headers: {}, body: '{}' })).rejects.toThrow(/private or reserved/);
    });
});
