/**
 * "turbo-founding": TURBO's WhatsApp bot (Founding 50 MVP), as data.
 *
 * Wording is TURBO's own (docs/turbo/USER-FLOW.md). Deviations, all forced by
 * the step catalogue or by decisions in docs/TURBO-BUILD.md:
 *  - options are numbered "1. ..." by the engine, not with keycap emoji;
 *  - the member menu is 1 Book · 2 PAYG · 3 Balance · 4 History · 5 Account · 6 Support
 *    (decision 8: the draft skipped 5 and used 4 twice);
 *  - "Student ID / University" is asked as two questions;
 *  - the newcomer menu shows "PAYG Ride" only while PAYG is open, so it reads
 *    exactly like the draft (1 Pioneer · 2 Learn More · 3 Support) when closed;
 *  - package numbers (GHS 960 credit, the fare bands, 50) come from the
 *    tenant's ride settings, so the copy follows a price change.
 *
 * FARES AND CREDIT (docs/TURBO-BUILD.md decisions 11-18). The Founding Package
 * is GHS ride credit; each ride costs its distance band's fare, deducted when
 * the ride is completed. Booking order depends on `fare_ref` (from
 * turbo.destinations), never on which pickup variables happen to be set:
 *  - fare_ref = yes (fares measured from the reference point): destination
 *    first -> fare shown -> pickup pin (for the driver) -> confirm;
 *  - fare_ref = no: pickup first, then destination (the old order).
 * A package fare the balance does not cover: the whole balance + a Paystack
 * link for the difference (ride_topup), unless the difference is under GHS 2
 * (waived). No balance: offer PAYG.
 *
 * Needs, before validation: the turbo.* actions (registerRideFlowActions) and
 * the ride_package / ride_payg / ride_topup payment kinds (registerRidePayments).
 */

export const TURBO_FLOW_KEY = 'turbo-founding';

const WELCOME = [
    'Heyya, Turber!!',
    'We are currently onboarding our first {founding_cap} Founding Members.',
    '',
    'Founding Package',
    '',
    '• GHS {pkg_price} ride credit',
    '• Valid for {pkg_days} days',
    '',
    'Fare per ride:',
    '{pkg_fares}',
    '',
    '🔥 Only {founding_cap} Founding Packages available.',
].join('\n');

/** First line of every payment success state (texts.ts PAYMENT_CONFIRMED_LINE; flows are data, so repeated here). */
const PAID = '✅ Payment confirmed, thank you!';

const ACTIVATED = [
    PAID,
    '',
    '🎉 WELCOME TO TURBO, {welcome_name}!',
    '',
    "You're officially one of our Founding 50.",
    '',
    '🎟️ Your Package',
    '',
    'GHS {pkg_price} ride credit',
    'Valid for {pkg_days} days',
    '',
    'Balance: GHS {pkg_price}',
    '',
    'You now have priority access to TURBO rides.',
].join('\n');

const PAYG_FULL = "🔴 PAYG is currently unavailable\n\nToday's available PAYG slots have been filled.\n\nPioneer Members receive priority access.\n\nPlease try again later.";
const PAYG_CLOSED = '🔴 PAYG is currently unavailable\n\nPioneer Members receive priority access.\n\nPlease try again later.';
const SHARE_PIN = 'Please share your location: tap 📎 (or +), choose Location, then send your current location.';
const PICKUP_PIN = '📍 Now share your pickup location pin so the driver can find you: tap 📎 (or +) → Location → Send your current location.';
const BALANCE_VARS = [
    'member', 'pass_name', 'balance', 'balance_minor', 'credit_total', 'credit_used', 'rides_taken', 'expiry_date',
    'open_ride', 'open_ride_ref', 'open_ride_status',
];
const QUOTE_VARS = [
    'quote_ok', 'quote_code', 'quote_reason', 'trip_dest', 'trip_dest_lat', 'trip_dest_lng', 'trip_dest_id', 'trip_km',
    'pkg_fare', 'fare_band', 'pay_mode', 'balance', 'balance_after', 'balance_use', 'topup_amount', 'balance_line', 'hold_minutes', 'place_misses',
];
const PAYG_QUOTE_VARS = [
    'quote_ok', 'quote_code', 'quote_reason', 'trip_dest', 'trip_dest_lat', 'trip_dest_lng', 'trip_dest_id', 'trip_km', 'payg_fare', 'fare_band', 'place_misses',
];

export const turboFoundingFlow = {
    key: TURBO_FLOW_KEY,
    version: 1,
    start: 'entry',
    handoffText: "I'm having trouble understanding. Someone from the TURBO team will reply shortly.",
    invalidText: "Sorry, I didn't get that. Please reply with one of the numbers.",
    // "Need another ride? Reply BOOK." arrives after the flow ended: BOOK must start booking, not the menu.
    globalsOnOpen: true,
    globals: {
        menu: { goto: 'entry' },
        hi: { goto: 'entry' },
        hello: { goto: 'entry' },
        book: { goto: 'book' },
        support: { goto: 'support' },
        help: { goto: 'support' },
    },
    states: {
        // ---- every visit starts by reading where the customer stands
        entry: {
            type: 'action', action: 'turbo.balance',
            produces: ['needs_phone', ...BALANCE_VARS],
            next: 'entry_phone', onError: 'oops',
        },
        // WhatsApp hides this customer's number (username). TURBO needs a real,
        // proven number, so confirm it once with an SMS code; the account is
        // only opened/linked after the code comes back (turbo.verify_phone_code).
        entry_phone: { type: 'branch', cases: [{ when: { var: 'needs_phone', op: 'eq', value: 'yes' }, next: 'phone_ask' }], default: 'entry_pkg' },
        phone_ask: {
            type: 'ask',
            prompt: "👋 Welcome to TURBO! Your WhatsApp hides your number from businesses, so we need to confirm it once.\n\nWhat's your phone number? (e.g. 024 123 4567)",
            validate: 'phone', invalid: 'Please send a valid phone number, e.g. 024 123 4567.', var: 'verify_phone', next: 'phone_send',
        },
        phone_send: {
            type: 'action', action: 'turbo.send_phone_code',
            produces: ['code_sent', 'code_hash', 'code_expires', 'code_attempts', 'code_sends', 'phone_reason'],
            next: 'phone_sent_check', onError: 'oops',
        },
        phone_sent_check: { type: 'branch', cases: [{ when: { var: 'code_sent', op: 'eq', value: 'yes' }, next: 'phone_code_ask' }], default: 'phone_hidden' },
        phone_code_ask: {
            type: 'ask',
            prompt: 'We sent a 6-digit code by SMS to {verify_phone}. Please reply with the code.',
            validate: 'free', var: 'verify_code', next: 'phone_verify',
        },
        phone_verify: {
            type: 'action', action: 'turbo.verify_phone_code',
            produces: ['phone_ok', 'code_attempts', 'phone_reason'],
            next: 'phone_verify_check', onError: 'oops',
        },
        phone_verify_check: {
            type: 'branch',
            cases: [
                { when: { var: 'phone_ok', op: 'eq', value: 'yes' }, next: 'phone_confirmed' },
                { when: { var: 'phone_ok', op: 'eq', value: 'retry' }, next: 'phone_code_again' },
            ],
            default: 'phone_restart',
        },
        phone_code_again: { type: 'notify', text: '{phone_reason}', next: 'phone_code_ask' },
        phone_restart: { type: 'notify', text: '{phone_reason}', next: 'phone_ask' },
        phone_confirmed: { type: 'notify', text: '✅ Number confirmed. Thanks!', next: 'entry' },
        // Only when the code could not be sent (SMS unavailable, too many codes).
        phone_hidden: {
            type: 'staff',
            text: '{phone_reason} Connecting you with the TURBO team, who will help you here shortly.',
            queue: 'support', handoff: true,
        },
        entry_pkg: {
            type: 'action', action: 'turbo.founding_available',
            produces: ['pkg_price', 'pkg_days', 'pkg_fares', 'founding_cap', 'founding_left', 'founding_open', 'hold_minutes'],
            next: 'entry_payg', onError: 'oops',
        },
        entry_payg: {
            type: 'action', action: 'turbo.payg_open',
            produces: ['payg_open', 'payg_reason', 'payg_fare_from', 'payg_left', 'hold_minutes'],
            next: 'entry_route', onError: 'oops',
        },
        entry_route: { type: 'branch', cases: [{ when: { var: 'open_ride', op: 'eq', value: 'yes' }, next: 'ride_status' }], default: 'main_route' },
        main_route: {
            type: 'branch',
            cases: [
                { when: { var: 'member', op: 'eq', value: 'yes' }, next: 'member_menu' },
                { when: { var: 'payg_open', op: 'eq', value: 'yes' }, next: 'welcome_payg' },
            ],
            default: 'welcome',
        },

        // ---- newcomers
        welcome: {
            type: 'menu', prompt: WELCOME,
            options: [
                { label: 'Get Pioneer Package', next: 'buy' },
                { label: 'Learn More', next: 'learn' },
                { label: 'Contact Support', next: 'support' },
            ],
        },
        welcome_payg: {
            type: 'menu', prompt: WELCOME,
            options: [
                { label: 'Get Pioneer Package', next: 'buy' },
                { label: 'PAYG Ride', next: 'payg' },
                { label: 'Learn More', next: 'learn' },
                { label: 'Contact Support', next: 'support' },
            ],
        },
        learn: {
            type: 'notify',
            text: 'TURBO gives Central University students safe, reliable rides around campus and town.\n\n🎟️ Founding Package: GHS {pkg_price} of ride credit, valid for {pkg_days} days. Each ride costs its distance fare, taken from your credit when the ride is completed:\n{pkg_fares}\n\nBook any time right here in WhatsApp.\n\n🚗 Pay-as-you-go: single rides when PAYG slots are open.\n\nMore at https://www.turboghana.app',
            next: 'main_route',
        },

        // ---- members
        member_menu: {
            type: 'menu', prompt: 'What would you like to do?',
            options: [
                { label: 'Book a Ride', next: 'book' },
                { label: 'PAYG Ride', next: 'payg' },
                { label: 'Check Balance', next: 'balance' },
                { label: 'Ride History', next: 'history' },
                { label: 'My Account', next: 'account' },
                { label: 'Support', next: 'support' },
            ],
        },
        ride_status: {
            type: 'menu', prompt: '🚗 Your ride {open_ride_ref} is {open_ride_status}.\n\nWhat would you like to do?',
            options: [
                { label: 'Cancel this ride', next: 'cancel_ride' },
                { label: 'Main menu', next: 'main_route' },
                { label: 'Support', next: 'support' },
            ],
        },

        // ---- buy the Founding Package
        buy: { type: 'branch', cases: [{ when: { var: 'member', op: 'eq', value: 'yes' }, next: 'already_member' }, { when: { var: 'founding_open', op: 'neq', value: 'yes' }, next: 'sold_out' }], default: 'reg_name' },
        already_member: { type: 'notify', text: 'You already have an active TURBO package. 🎟️', next: 'member_menu' },
        sold_out: { type: 'notify', text: 'All {founding_cap} Founding Packages have been taken. 😔', next: 'main_route' },
        reg_name: { type: 'ask', prompt: "Let's get you in! 🚗\n\nWhat's your full name?", validate: 'name', invalid: 'Please send your full name (letters only).', var: 'full_name', next: 'reg_student' },
        reg_student: { type: 'ask', prompt: "What's your Student ID?", validate: 'studentId', invalid: 'That doesn\'t look like a Student ID. Please send it again.', var: 'student_id', next: 'reg_university' },
        reg_university: { type: 'ask', prompt: 'Which university are you at?', validate: 'free', var: 'university', next: 'reg_email' },
        reg_email: { type: 'ask', prompt: "What's your email address?", validate: 'email', invalid: "That doesn't look like an email address. Please send it again.", var: 'email', next: 'reg_save' },
        reg_save: { type: 'action', action: 'turbo.register', produces: ['customer_name', 'welcome_name'], next: 'pay_confirm', onError: 'oops' },
        pay_confirm: {
            type: 'menu',
            prompt: "You're almost in! 🚗\n\nFounding Package — GHS {pkg_price}\n\nGHS {pkg_price} ride credit\n{pkg_days} days validity\n\nFare per ride:\n{pkg_fares}\n\nProceed to payment?",
            options: [
                { label: 'Pay GHS {pkg_price}', next: 'pay' },
                { label: 'Cancel', next: 'cancelled' },
            ],
        },
        pay: {
            type: 'payment', kind: 'ride_package', amountVar: 'pkg_price',
            prompt: '💳 Pay GHS {pkg_price} here (Mobile Money or card):\n{payment_url}\n\nYour Founding slot is held for {hold_minutes} minutes. Your package is activated as soon as the payment is confirmed.',
            waitingText: "⏳ We're waiting for your payment to be confirmed. We'll message you here as soon as it is.\n\nPay here: {payment_url}",
            failureText: "Sorry, we couldn't start your payment right now. Please try again later, or reply SUPPORT to talk to the TURBO team.",
            onSuccess: 'activated', onFailure: 'pay_failed',
        },
        activated: { type: 'notify', text: ACTIVATED, next: 'member_menu' },
        pay_failed: { type: 'notify', text: "We couldn't complete your Founding Package purchase. If you were charged, the TURBO team will contact you about a refund.", next: 'entry' },

        // ---- book a package ride (GHS credit)
        book: { type: 'action', action: 'turbo.balance', produces: BALANCE_VARS, next: 'book_check', onError: 'oops' },
        book_check: {
            type: 'branch',
            cases: [
                { when: { var: 'member', op: 'neq', value: 'yes' }, next: 'no_package' },
                { when: { var: 'open_ride', op: 'eq', value: 'yes' }, next: 'ride_status' },
                { when: { var: 'balance_minor', op: 'lte', value: '0' }, next: 'no_balance' },
            ],
            default: 'book_dests',
        },
        no_package: { type: 'notify', text: "You don't have an active TURBO package yet.", next: 'entry' },
        no_balance: {
            type: 'menu',
            prompt: '🎟️ You have no ride credit left on your package (Balance: GHS 0).\n\nYou can still book a single PAYG ride.',
            options: [
                { label: 'PAYG Ride', next: 'payg' },
                { label: 'Main menu', next: 'entry' },
            ],
        },
        book_dests: { type: 'action', action: 'turbo.destinations', produces: ['destination_menu', 'dest_count', 'fare_ref'], next: 'book_order', onError: 'oops' },
        book_order: { type: 'branch', cases: [{ when: { var: 'fare_ref', op: 'eq', value: 'yes' }, next: 'book_dest' }], default: 'book_pickup_first' },
        // fare_ref = yes: destination first, the fare, then the pickup pin.
        book_dest: { type: 'location', acceptText: true, prompt: '📍 Where are you going?\n\n{destination_menu}', var: 'dest', next: 'book_quote' },
        // fare_ref = no: pickup first (the old order).
        book_pickup_first: { type: 'location', prompt: '📍 Where should we pick you up?\n\nPlease share your WhatsApp location.', invalid: SHARE_PIN, var: 'pickup', next: 'book_dest_after_pickup' },
        book_dest_after_pickup: { type: 'location', acceptText: true, prompt: '📍 Pickup received.\n\nWhere are you going?\n\n{destination_menu}', var: 'dest', next: 'book_quote' },
        book_quote: { type: 'action', action: 'turbo.quote_ride', produces: QUOTE_VARS, next: 'book_quoted', onError: 'oops' },
        book_quoted: {
            type: 'branch',
            cases: [
                { when: { var: 'quote_ok', op: 'eq', value: 'yes' }, next: 'book_after_quote' },
                { when: { var: 'place_misses', op: 'gte', value: '3' }, next: 'place_help' },
                { when: { var: 'quote_code', op: 'eq', value: 'unknown_place' }, next: 'book_dest_again' },
                { when: { var: 'quote_code', op: 'eq', value: 'no_balance' }, next: 'no_balance' },
            ],
            default: 'book_refused',
        },
        book_dest_again: { type: 'notify', text: '{quote_reason}', next: 'book_dest_retry' },
        book_dest_retry: { type: 'branch', cases: [{ when: { var: 'fare_ref', op: 'eq', value: 'yes' }, next: 'book_dest' }], default: 'book_dest_after_pickup' },
        place_help: { type: 'notify', text: "I still couldn't find that place, so I'm passing you to the TURBO team.", next: 'support' },
        book_refused: { type: 'notify', text: '{quote_reason}', next: 'entry' },
        book_after_quote: { type: 'branch', cases: [{ when: { var: 'fare_ref', op: 'eq', value: 'yes' }, next: 'book_pickup' }], default: 'book_pay_route' },
        book_pickup: {
            type: 'location',
            prompt: `🚗 {trip_dest} · about {trip_km} km · Fare: GHS {pkg_fare}\n\n${PICKUP_PIN}`,
            invalid: SHARE_PIN, var: 'pickup', next: 'book_pay_route',
        },
        book_pay_route: { type: 'branch', cases: [{ when: { var: 'pay_mode', op: 'eq', value: 'topup' }, next: 'book_topup_confirm' }], default: 'book_confirm' },
        book_confirm: {
            type: 'menu',
            prompt: '🚗 Your TURBO Ride\n\nPickup: {pickup_label}\nDestination: {trip_dest}\nAbout {trip_km} km ({fare_band})\n\nFare: GHS {pkg_fare}\n{balance_line}\n\nThe fare is taken from your balance when the ride is completed.\n\nConfirm?',
            options: [
                { label: 'Confirm Ride', next: 'book_request' },
                { label: 'Cancel', next: 'cancelled' },
            ],
        },
        book_request: { type: 'action', action: 'turbo.request_ride', produces: ['request_ok', 'request_reason', 'ride_ref'], next: 'book_requested', onError: 'oops' },
        book_requested: { type: 'branch', cases: [{ when: { var: 'request_ok', op: 'eq', value: 'yes' }, next: 'book_done' }], default: 'book_request_refused' },
        book_request_refused: { type: 'notify', text: '{request_reason}', next: 'entry' },
        book_done: { type: 'end', text: "✅ Ride Request Received\n\nWe're finding your TURBO driver.\n\nPlease stay available." },
        // The balance does not cover the fare (difference of GHS 2 or more): balance + top-up.
        book_topup_confirm: {
            type: 'menu',
            prompt: '🚗 Your TURBO Ride\n\nPickup: {pickup_label}\nDestination: {trip_dest}\nAbout {trip_km} km ({fare_band})\n\nFare: GHS {pkg_fare}\nFrom your balance: GHS {balance_use}\nTo pay now: GHS {topup_amount}\n\nYour balance does not cover this ride, so we use all of it and you pay the difference.',
            options: [
                { label: 'Pay GHS {topup_amount} & Book', next: 'book_topup_pay' },
                { label: 'Cancel', next: 'cancelled' },
            ],
        },
        book_topup_pay: {
            type: 'payment', kind: 'ride_topup', amountVar: 'topup_amount',
            prompt: '💳 Pay GHS {topup_amount} here (Mobile Money or card):\n{payment_url}\n\nYour ride is booked as soon as the payment is confirmed (held for {hold_minutes} minutes).',
            waitingText: "⏳ We're waiting for your payment to be confirmed. We'll message you here as soon as it is.\n\nPay here: {payment_url}",
            failureText: "Sorry, we couldn't start your payment. The fare or your balance may have changed: please book again, or reply SUPPORT to talk to the TURBO team.",
            onSuccess: 'book_topup_paid', onFailure: 'book_topup_failed',
        },
        book_topup_paid: {
            type: 'end',
            text: `${PAID}\n\nYour ride is confirmed.\n\nGHS {balance_use} from your balance is deducted when the ride is completed.\n\nWe're finding your TURBO driver.`,
        },
        book_topup_failed: { type: 'notify', text: "We couldn't complete your top-up payment, so the ride is not booked. If you were charged, the TURBO team will contact you about a refund.", next: 'entry' },

        // ---- PAYG (same order rule as package rides)
        payg: { type: 'action', action: 'turbo.payg_open', produces: ['payg_open', 'payg_reason', 'payg_fare_from', 'payg_left', 'hold_minutes'], next: 'payg_check', onError: 'oops' },
        payg_check: {
            type: 'branch',
            cases: [
                { when: { var: 'payg_reason', op: 'eq', value: 'full' }, next: 'payg_full' },
                { when: { var: 'payg_reason', op: 'eq', value: 'closed' }, next: 'payg_closed' },
            ],
            default: 'payg_dests',
        },
        payg_full: { type: 'notify', text: PAYG_FULL, next: 'entry' },
        payg_closed: { type: 'notify', text: PAYG_CLOSED, next: 'entry' },
        payg_dests: { type: 'action', action: 'turbo.destinations', produces: ['destination_menu', 'dest_count', 'fare_ref'], next: 'payg_order', onError: 'oops' },
        payg_order: { type: 'branch', cases: [{ when: { var: 'fare_ref', op: 'eq', value: 'yes' }, next: 'payg_dest' }], default: 'payg_pickup' },
        payg_dest: { type: 'location', acceptText: true, prompt: '🚗 PAY-AS-YOU-GO\n\nWhere are you going?\n\n{destination_menu}', var: 'dest', next: 'payg_quote' },
        payg_pickup: { type: 'location', prompt: '🚗 PAY-AS-YOU-GO\n\nFares from GHS {payg_fare_from}\n\nEnter your pickup location.\n\nShare your WhatsApp location.', invalid: SHARE_PIN, var: 'pickup', next: 'payg_dest_after_pickup' },
        payg_dest_after_pickup: { type: 'location', acceptText: true, prompt: '📍 Pickup received.\n\nWhere are you going?\n\n{destination_menu}', var: 'dest', next: 'payg_quote' },
        payg_quote: { type: 'action', action: 'turbo.payg_quote', produces: PAYG_QUOTE_VARS, next: 'payg_quoted', onError: 'oops' },
        payg_quoted: {
            type: 'branch',
            cases: [
                { when: { var: 'quote_ok', op: 'eq', value: 'yes' }, next: 'payg_after_quote' },
                { when: { var: 'place_misses', op: 'gte', value: '3' }, next: 'place_help' },
                { when: { var: 'quote_code', op: 'eq', value: 'unknown_place' }, next: 'payg_dest_again' },
            ],
            default: 'payg_refused',
        },
        payg_dest_again: { type: 'notify', text: '{quote_reason}', next: 'payg_dest_retry' },
        payg_dest_retry: { type: 'branch', cases: [{ when: { var: 'fare_ref', op: 'eq', value: 'yes' }, next: 'payg_dest' }], default: 'payg_dest_after_pickup' },
        payg_refused: { type: 'notify', text: '{quote_reason}', next: 'entry' },
        payg_after_quote: { type: 'branch', cases: [{ when: { var: 'fare_ref', op: 'eq', value: 'yes' }, next: 'payg_pickup_pin' }], default: 'payg_confirm' },
        payg_pickup_pin: {
            type: 'location',
            prompt: `🚗 {trip_dest} · about {trip_km} km · Fare: GHS {payg_fare}\n\n${PICKUP_PIN}`,
            invalid: SHARE_PIN, var: 'pickup', next: 'payg_confirm',
        },
        payg_confirm: {
            type: 'menu', prompt: 'Your ride is GHS {payg_fare}.',
            options: [
                { label: 'Pay & Book', next: 'payg_pay' },
                { label: 'Cancel', next: 'cancelled' },
            ],
        },
        payg_pay: {
            type: 'payment', kind: 'ride_payg', amountVar: 'payg_fare',
            prompt: '💳 Pay GHS {payg_fare} here (Mobile Money or card):\n{payment_url}\n\nYour PAYG slot is held for {hold_minutes} minutes.',
            waitingText: "⏳ We're waiting for your payment to be confirmed. We'll message you here as soon as it is.\n\nPay here: {payment_url}",
            failureText: "Sorry, we couldn't book your PAYG ride just now. Today's PAYG slots may have just filled.",
            onSuccess: 'payg_paid', onFailure: 'payg_failed',
        },
        payg_paid: { type: 'end', text: `${PAID}\n\nYour ride is confirmed.\n\nWe're assigning your driver now.` },
        payg_failed: { type: 'notify', text: "We couldn't complete your PAYG booking. If you were charged, the TURBO team will contact you about a refund.", next: 'entry' },

        // ---- balance, history, account
        balance: { type: 'action', action: 'turbo.balance', produces: BALANCE_VARS, next: 'balance_check', onError: 'oops' },
        balance_check: { type: 'branch', cases: [{ when: { var: 'member', op: 'eq', value: 'yes' }, next: 'balance_show' }], default: 'no_package' },
        balance_show: {
            type: 'notify',
            text: '🎟️ Your TURBO Package\n\n{pass_name}\nRide credit: GHS {credit_total}\nUsed: GHS {credit_used} ({rides_taken} rides)\nBalance: GHS {balance}\n\nExpiry: {expiry_date}',
            next: 'member_menu',
        },
        history: { type: 'action', action: 'turbo.history', produces: ['history_text', 'history_count'], next: 'history_show', onError: 'oops' },
        history_show: { type: 'notify', text: '🧾 Your recent rides\n\n{history_text}', next: 'entry' },
        account: {
            type: 'action', action: 'turbo.account',
            produces: ['account_name', 'account_phone', 'account_email', 'account_student_id', 'account_university', 'package_status'],
            next: 'account_show', onError: 'oops',
        },
        account_show: {
            type: 'notify',
            text: '👤 My Account\n\nName: {account_name}\nPhone: {account_phone}\nEmail: {account_email}\nStudent ID: {account_student_id}\nUniversity: {account_university}\n\nPackage: {package_status}',
            next: 'entry',
        },

        // ---- cancel, support, errors
        cancel_ride: { type: 'action', action: 'turbo.cancel_ride', produces: ['cancel_ok', 'cancel_reason'], next: 'cancel_show', onError: 'oops' },
        cancel_show: { type: 'notify', text: '{cancel_reason}', next: 'entry' },
        cancelled: { type: 'notify', text: 'No problem, nothing was booked.', next: 'entry' },
        support: { type: 'staff', text: '👋 Connecting you with the TURBO team. Someone will reply here shortly.', queue: 'support', handoff: true },
        oops: { type: 'end', text: 'Sorry, something went wrong on our side. Please reply MENU to try again.' },
    },
} as const;
