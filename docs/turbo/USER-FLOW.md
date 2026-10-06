# TURBO WhatsApp Bot — Founding 50 MVP (as sent by TURBO, 6 Oct 2026)

Verbatim copy of the client's user flow. The bot's wording comes from here.

## 1. Customer starts WhatsApp

Customer sends: `Hi`

Bot responds:

```
Heyya, Turber!!
We are currently onboarding our first 50 Founding Members.

Founding Package

	•	60 rides
	•	Valid for 60 days
	•	0–6 km rides
	•	GHS 960
	•	That's just GHS 16 per ride

🔥 Only 50 Founding Packages available.

1️⃣ Get Pioneer Package
2️⃣ Learn More
3️⃣ Contact Support
```

## 2. Customer selects "Get Founding Package"

Bot collects: Full Name → Phone Number (automatically captured from WhatsApp)
→ Student ID / University → Email address. Then:

```
You're almost in! 🚗

Founding Package — GHS 960

60 rides
60 days validity
0–6 km

Proceed to payment?

1️⃣ Pay GHS 960
2️⃣ Cancel
```

## 3. Payment

Customer selects Pay GHS 960. The bot generates a payment request/link through
the selected Ghana payment gateway. Ideally support: MTN Mobile Money, Telecel
Cash, AirtelTigo/AT Money where supported, Card. The payment gateway sends the
successful payment confirmation back to the TURBO backend.

Do not activate the package merely because the customer clicked "Pay".
Only: Successful payment → Package activated.

## 4. Package Activation

```
🎉 WELCOME TO TURBO, [NAME]!

You're officially one of our Founding 50.

🎟️ Your Package

60 rides
Valid for 60 days
0–6 km

Balance: 60 rides

You now have priority access to TURBO rides.

What would you like to do?

1️⃣ Book a Ride
2️⃣ Check Balance
3️⃣ Ride History
4️⃣My Account
6️⃣ Support
```

## 5. Booking a Founding Ride

Customer selects 1️⃣ Book a Ride.

```
📍 Where should we pick you up?

Please share your WhatsApp location.
```

Customer shares location.

```
📍 Pickup received.

Where are you going?
```

Customer provides destination. System checks the distance. If eligible:

```
🚗 Your TURBO Ride

Pickup: [Location]
Destination: [Destination]

Package ride: 1 ride

Your current balance: 60

Confirm?

1️⃣ Confirm Ride
2️⃣ Cancel
```

## 6. Booking Confirmation

Customer confirms.

```
✅ Ride Request Received

We're finding your TURBO driver.

Please stay available.
```

TURBO dashboard receives the request: Customer → Pickup → Destination → Package
→ Time → Status. Operations assigns the driver. Customer receives:

```
🚗 Driver Assigned

Driver: [Name]
Vehicle: [Vehicle]
Plate: [Number]

Your driver is on the way.
```

## 7. Ride Completion

Driver/admin marks: COMPLETED. Only then does the system deduct one ride
(example: 60 → 59). Customer receives:

```
✅ Ride Completed

Thanks for riding with TURBO.

1 ride used

🎟️ Remaining balance: 59 rides

Need another ride?
Reply BOOK.
```

## 8. PAY-AS-YOU-GO

This should be a separate option. Customer selects 4️⃣ PAYG Ride. The system
first checks whether PAYG is open. If available:

```
🚗 PAY-AS-YOU-GO

Fare: GHS 25

Enter your pickup location.
```

Customer provides pickup → destination. Bot calculates/confirms the fare.

```
Your ride is GHS 25.

1️⃣ Pay & Book
2️⃣ Cancel
```

Payment request is generated. After successful payment:

```
✅ Payment Received

Your ride is confirmed.

We're assigning your driver now.
```

Then the normal ride process continues.

## 9. PAYG Capacity Control

Critical: initially operating with limited vehicles. Admin dashboard:

```
PAYG: 🟢 OPEN
Daily PAYG Limit: 10
Used: 4/10
```

When the limit is reached:

```
🔴 PAYG is currently unavailable

Today's available PAYG slots have been filled.

Pioneer Members receive priority access.

Please try again later.
```

TURBO should be able to manually switch PAYG OPEN → CLOSED at any time.

## 10. Customer Balance

At any time, 2️⃣ Check Balance:

```
🎟️ Your TURBO Package

Pioneer 50
Rides purchased: 60
Rides used: 12
Rides remaining: 48

Expiry: [Date]
```

## 11. Admin Dashboard

- 👥 Customers: Name, Phone, Student ID, Package, Balance, Expiry
- 🚗 Live Rides: Customer, Pickup, Destination, Driver, Status
- 🎟️ Packages: Packages sold, Packages activated, Rides used, Rides remaining
- 💰 Payments: Pioneer payments, PAYG payments, Successful, Pending, Failed, Transaction IDs
- 📊 Capacity: Pioneer bookings, PAYG bookings, PAYG daily limit, Available PAYG slots, Open/closed status

## Most important requirement

The entire Founding customer journey must be possible through WhatsApp:
Discover TURBO → Purchase → Pay → Account Creation → Package Activation → Book
→ Driver Assignment → Ride → Completion → Balance Deduction → Ride History →
PAYG Payment — all without the customer needing to download the app. When the
TURBO app is ready, the same customer account and balance carry over into the app.
