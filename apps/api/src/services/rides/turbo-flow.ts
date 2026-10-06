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
 *  - package numbers (60 rides, GHS 960, 0–6 km, 50) come from the tenant's
 *    ride settings, so the copy follows a price change.
 *
 * Needs, before validation: the turbo.* actions (registerRideFlowActions) and
 * the ride_package / ride_payg payment kinds (registerRidePayments).
 */

export const TURBO_FLOW_KEY = 'turbo-founding';

const WELCOME = [
    'Heyya, Turber!!',
    'We are currently onboarding our first {founding_cap} Founding Members.',
    '',
    'Founding Package',
    '',
    '• {pkg_rides} rides',
    '• Valid for {pkg_days} days',
    '• 0–{pkg_max_km} km rides',
    '• GHS {pkg_price}',
    "• That's just GHS {pkg_per_ride} per ride",
    '',
    '🔥 Only {founding_cap} Founding Packages available.',
].join('\n');

const ACTIVATED = [
    '🎉 WELCOME TO TURBO, {welcome_name}!',
    '',
    "You're officially one of our Founding 50.",
    '',
    '🎟️ Your Package',
    '',
    '{pkg_rides} rides',
    'Valid for {pkg_days} days',
    '0–{pkg_max_km} km',
    '',
    'Balance: {pkg_rides} rides',
    '',
    'You now have priority access to TURBO rides.',
].join('\n');

const PAYG_FULL = "🔴 PAYG is currently unavailable\n\nToday's available PAYG slots have been filled.\n\nPioneer Members receive priority access.\n\nPlease try again later.";
const PAYG_CLOSED = '🔴 PAYG is currently unavailable\n\nPioneer Members receive priority access.\n\nPlease try again later.';
const SHARE_PIN = 'Please share your location: tap 📎 (or +), choose Location, then send your current location.';

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
            produces: ['member', 'pass_name', 'rides_total', 'rides_used', 'rides_left', 'expiry_date', 'open_ride', 'open_ride_ref', 'open_ride_status'],
            next: 'entry_pkg', onError: 'oops',
        },
        entry_pkg: {
            type: 'action', action: 'turbo.founding_available',
            produces: ['pkg_price', 'pkg_rides', 'pkg_days', 'pkg_max_km', 'pkg_per_ride', 'founding_cap', 'founding_left', 'founding_open', 'hold_minutes'],
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
            text: 'TURBO gives Central University students safe, reliable rides around campus and town.\n\n🎟️ Founding Package: {pkg_rides} rides for GHS {pkg_price}, valid for {pkg_days} days, trips of 0–{pkg_max_km} km. Book any time right here in WhatsApp.\n\n🚗 Pay-as-you-go: single rides when PAYG slots are open.\n\nMore at https://www.turboghana.app',
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
            prompt: "You're almost in! 🚗\n\nFounding Package — GHS {pkg_price}\n\n{pkg_rides} rides\n{pkg_days} days validity\n0–{pkg_max_km} km\n\nProceed to payment?",
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

        // ---- book a package ride
        book: { type: 'action', action: 'turbo.balance', produces: ['member', 'pass_name', 'rides_total', 'rides_used', 'rides_left', 'expiry_date', 'open_ride', 'open_ride_ref', 'open_ride_status'], next: 'book_check', onError: 'oops' },
        book_check: {
            type: 'branch',
            cases: [
                { when: { var: 'member', op: 'neq', value: 'yes' }, next: 'no_package' },
                { when: { var: 'open_ride', op: 'eq', value: 'yes' }, next: 'ride_status' },
                { when: { var: 'rides_left', op: 'lte', value: '0' }, next: 'no_rides' },
            ],
            default: 'book_dests',
        },
        no_package: { type: 'notify', text: "You don't have an active TURBO package yet.", next: 'entry' },
        no_rides: { type: 'notify', text: "You've used all the rides on your package. 🎟️", next: 'entry' },
        book_dests: { type: 'action', action: 'turbo.destinations', produces: ['destination_menu', 'dest_count'], next: 'book_pickup', onError: 'oops' },
        book_pickup: { type: 'location', prompt: '📍 Where should we pick you up?\n\nPlease share your WhatsApp location.', invalid: SHARE_PIN, var: 'pickup', next: 'book_dest' },
        book_dest: { type: 'location', acceptText: true, prompt: '📍 Pickup received.\n\nWhere are you going?\n\n{destination_menu}', var: 'dest', next: 'book_quote' },
        book_quote: {
            type: 'action', action: 'turbo.quote_ride',
            produces: ['quote_ok', 'quote_code', 'quote_reason', 'trip_dest', 'trip_dest_lat', 'trip_dest_lng', 'trip_dest_id', 'trip_km', 'rides_left', 'place_misses'],
            next: 'book_quoted', onError: 'oops',
        },
        book_quoted: {
            type: 'branch',
            cases: [
                { when: { var: 'quote_ok', op: 'eq', value: 'yes' }, next: 'book_confirm' },
                { when: { var: 'place_misses', op: 'gte', value: '3' }, next: 'place_help' },
                { when: { var: 'quote_code', op: 'eq', value: 'unknown_place' }, next: 'book_dest_again' },
            ],
            default: 'book_refused',
        },
        book_dest_again: { type: 'notify', text: '{quote_reason}', next: 'book_dest' },
        place_help: { type: 'notify', text: "I still couldn't find that place, so I'm passing you to the TURBO team.", next: 'support' },
        book_refused: { type: 'notify', text: '{quote_reason}', next: 'entry' },
        book_confirm: {
            type: 'menu',
            prompt: '🚗 Your TURBO Ride\n\nPickup: {pickup_label}\nDestination: {trip_dest}\n\nPackage ride: 1 ride\n\nYour current balance: {rides_left}\n\nConfirm?',
            options: [
                { label: 'Confirm Ride', next: 'book_request' },
                { label: 'Cancel', next: 'cancelled' },
            ],
        },
        book_request: { type: 'action', action: 'turbo.request_ride', produces: ['request_ok', 'request_reason', 'ride_ref'], next: 'book_requested', onError: 'oops' },
        book_requested: { type: 'branch', cases: [{ when: { var: 'request_ok', op: 'eq', value: 'yes' }, next: 'book_done' }], default: 'book_request_refused' },
        book_request_refused: { type: 'notify', text: '{request_reason}', next: 'entry' },
        book_done: { type: 'end', text: "✅ Ride Request Received\n\nWe're finding your TURBO driver.\n\nPlease stay available." },

        // ---- PAYG
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
        payg_dests: { type: 'action', action: 'turbo.destinations', produces: ['destination_menu', 'dest_count'], next: 'payg_pickup', onError: 'oops' },
        payg_pickup: { type: 'location', prompt: '🚗 PAY-AS-YOU-GO\n\nFare: GHS {payg_fare_from}\n\nEnter your pickup location.\n\nShare your WhatsApp location.', invalid: SHARE_PIN, var: 'pickup', next: 'payg_dest' },
        payg_dest: { type: 'location', acceptText: true, prompt: '📍 Pickup received.\n\nWhere are you going?\n\n{destination_menu}', var: 'dest', next: 'payg_quote' },
        payg_quote: {
            type: 'action', action: 'turbo.payg_quote',
            produces: ['quote_ok', 'quote_code', 'quote_reason', 'trip_dest', 'trip_dest_lat', 'trip_dest_lng', 'trip_dest_id', 'trip_km', 'payg_fare', 'place_misses'],
            next: 'payg_quoted', onError: 'oops',
        },
        payg_quoted: {
            type: 'branch',
            cases: [
                { when: { var: 'quote_ok', op: 'eq', value: 'yes' }, next: 'payg_confirm' },
                { when: { var: 'place_misses', op: 'gte', value: '3' }, next: 'place_help' },
                { when: { var: 'quote_code', op: 'eq', value: 'unknown_place' }, next: 'payg_dest_again' },
            ],
            default: 'payg_refused',
        },
        payg_dest_again: { type: 'notify', text: '{quote_reason}', next: 'payg_dest' },
        payg_refused: { type: 'notify', text: '{quote_reason}', next: 'entry' },
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
        payg_paid: { type: 'end', text: "✅ Payment Received\n\nYour ride is confirmed.\n\nWe're assigning your driver now." },
        payg_failed: { type: 'notify', text: "We couldn't complete your PAYG booking. If you were charged, the TURBO team will contact you about a refund.", next: 'entry' },

        // ---- balance, history, account
        balance: { type: 'action', action: 'turbo.balance', produces: ['member', 'pass_name', 'rides_total', 'rides_used', 'rides_left', 'expiry_date', 'open_ride', 'open_ride_ref', 'open_ride_status'], next: 'balance_check', onError: 'oops' },
        balance_check: { type: 'branch', cases: [{ when: { var: 'member', op: 'eq', value: 'yes' }, next: 'balance_show' }], default: 'no_package' },
        balance_show: {
            type: 'notify',
            text: '🎟️ Your TURBO Package\n\n{pass_name}\nRides purchased: {rides_total}\nRides used: {rides_used}\nRides remaining: {rides_left}\n\nExpiry: {expiry_date}',
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
