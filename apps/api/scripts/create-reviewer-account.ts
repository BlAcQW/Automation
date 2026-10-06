/**
 * Create the Bookly login for Meta's App Review team (Instagram + Messenger).
 *
 *   npx tsx scripts/create-reviewer-account.ts --api https://bookly.ikieguy.online/api \
 *       --web https://bookly.ikieguy.online --email meta-review@yourdomain \
 *       [--name "Meta Reviewer"] [--business "Review Salon"]
 *
 * It signs up through the public POST /auth/register endpoint (no database
 * access, nothing written but a normal new account), prints the password once,
 * and prints the notes to paste into the submission. Use an address you can
 * receive mail at; nothing else is needed from the reviewer.
 */
import { parseReviewerArgs, reviewerNotes, reviewerPassword } from '../src/services/reviewer-account.js';

async function main(): Promise<void> {
    const args = parseReviewerArgs(process.argv);
    const webIdx = process.argv.indexOf('--web');
    if (webIdx < 0) throw new Error('--web <Bookly website URL> is required (the address the reviewer signs in at)');
    const web = new URL(process.argv[webIdx + 1]).origin;
    const password = reviewerPassword();

    const res = await fetch(`${args.api}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
            email: args.email, password, name: args.name, businessName: args.businessName,
            businessType: 'SERVICE', timezone: 'Africa/Accra', acceptTerms: true,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Sign-up failed (${res.status}): ${body.slice(0, 300)}`);
    }
    console.log('Reviewer account created. The password is shown only now.\n');
    console.log(reviewerNotes({ web, email: args.email, password }));
}

main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
});
