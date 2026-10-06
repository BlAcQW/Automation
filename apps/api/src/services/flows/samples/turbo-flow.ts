/**
 * TURBO-shaped sample flow (data only). Proves the engine against the journey
 * the real TURBO pack will need: register, buy a ride package, book a ride,
 * dispatch, and check balance.
 *
 * Needs, registered before validation: payment kind `ride_package`
 * (registerPaymentFulfiller) and action `turbo_balance` (registerFlowAction)
 * returning vars { rides_left }.
 */
export const turboSampleFlow = {
    key: 'turbo-rides',
    version: 1,
    start: 'menu',
    handoffText: "I'm having trouble understanding. Someone from the TURBO team will reply shortly.",
    globals: {
        menu: { goto: 'menu' },
        help: { goto: 'help' },
    },
    states: {
        menu: {
            type: 'menu',
            prompt: 'Welcome to TURBO Rides! What would you like to do?',
            options: [
                { label: 'Register', next: 'reg_name' },
                { label: 'Buy a ride package', next: 'pkg_choose' },
                { label: 'Book a ride', next: 'ride_pickup' },
                { label: 'Check my balance', next: 'balance' },
            ],
        },

        // --- registration
        reg_name: { type: 'ask', prompt: 'What is your full name?', validate: 'name', var: 'full_name', next: 'reg_student' },
        reg_student: {
            type: 'ask', prompt: 'Your student ID?', validate: 'studentId', pattern: '^\\d{8,10}$',
            invalid: 'Student IDs are 8 to 10 digits.', var: 'student_id', next: 'reg_university',
        },
        reg_university: { type: 'ask', prompt: 'Which university are you at?', validate: 'free', var: 'university', next: 'reg_email' },
        reg_email: { type: 'ask', prompt: 'And your email address?', validate: 'email', var: 'email', next: 'reg_confirm' },
        reg_confirm: {
            type: 'confirm',
            prompt: 'Please confirm:\n{full_name}\nID {student_id}\n{university}\n{email}',
            yes: 'registered',
            no: 'reg_name',
        },
        registered: { type: 'notify', text: "Thanks {full_name}, you're registered. Let's get you a ride package.", next: 'pkg_choose' },

        // --- package purchase
        pkg_choose: {
            type: 'choose',
            prompt: 'Pick a ride package:',
            var: 'package',
            items: [
                { label: '5 rides - GHS 25', value: 'pkg_5', attrs: { price: '25', rides: 5 } },
                { label: '12 rides - GHS 55', value: 'pkg_12', attrs: { price: '55', rides: 12 } },
            ],
            next: 'pkg_pay',
        },
        pkg_pay: {
            type: 'payment',
            kind: 'ride_package',
            amountVar: 'package_price',
            prompt: 'Pay GHS {package_price} for {package_label} here: {payment_url}',
            waitingText: "We're waiting for your payment. We'll confirm here as soon as it lands.",
            failureText: "Sorry, we couldn't create a payment link.",
            onSuccess: 'pkg_active',
            onFailure: 'pkg_failed',
        },
        pkg_active: { type: 'notify', text: 'Payment received. Your {package_label} package is active!', next: 'ride_pickup' },
        pkg_failed: { type: 'end', text: 'We could not complete your purchase. Send "menu" to try again.' },

        // --- book a ride
        ride_pickup: {
            type: 'location',
            prompt: 'Share your pickup location (tap the + and choose Location).',
            fallback: [{ label: 'Main gate', latitude: 5.6505, longitude: -0.1873 }, { label: 'Night market', latitude: 5.6537, longitude: -0.1861 }],
            var: 'pickup',
            next: 'ride_dest',
        },
        ride_dest: {
            type: 'choose',
            prompt: 'Where to?',
            var: 'destination',
            items: [
                { label: 'Campus North', value: 'north', attrs: { zone: 'A' } },
                { label: 'Accra Mall', value: 'mall', attrs: { zone: 'B' } },
                { label: 'Airport', value: 'airport', attrs: { zone: 'C' } },
            ],
            next: 'ride_confirm',
        },
        ride_confirm: {
            type: 'confirm',
            prompt: 'Book a ride from {pickup} to {destination_label}?',
            yes: 'ride_dispatch',
            no: 'menu',
        },
        ride_dispatch: { type: 'staff', text: 'Booked! A rider is being assigned and will message you shortly.', queue: 'dispatch', next: 'ride_done' },
        ride_done: { type: 'end', text: 'Safe travels. Send "menu" any time.' },

        // --- balance
        balance: { type: 'action', action: 'turbo_balance', produces: ['rides_left'], next: 'balance_show', onError: 'balance_error' },
        balance_show: { type: 'notify', text: 'You have {rides_left} rides left.', next: 'done' },
        balance_error: { type: 'end', text: "We couldn't find your balance. Register first, or send \"help\"." },
        done: { type: 'end', text: 'Send "menu" any time.' },

        // --- human
        help: { type: 'staff', text: 'Connecting you with the team...', queue: 'support', handoff: true },
    },
} as const;
