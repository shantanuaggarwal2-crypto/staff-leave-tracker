# Staff Leave & Advance Tracker

A small web app for tracking staff leave and salary advances, with an admin
dashboard for you and individual logins for each staff member so they can see
their own status.

## Policy implemented

- Every staff member gets **1 free leave per calendar week** (their weekly
  off) — this never counts against anything.
- On top of that, they get a pool of **20 extra leave days per calendar
  year** (configurable), usable whenever.
- Any leave beyond "1/week" that exceeds the remaining pool is **unpaid** —
  deducted from salary at (monthly salary ÷ divisor) per day.
- Any pool days left unused at year end are shown as a **projected bonus**
  at the same per-day rate.
- Within a week, whichever leave date comes first is treated as the free
  weekly one; later ones that week draw from the pool.
- Advance payments are tracked as "given" / "repaid" entries; the running
  outstanding balance is given/repaid.

These rules, and the salary-day divisor, can be changed from the Admin
dashboard → Policy settings.

## Setup

```bash
npm install
npm run seed     # creates 1 admin + 6 staff accounts (only runs once)
npm start
```

Then open http://localhost:3000

The seed step prints temporary login credentials for the admin and all 6
staff accounts — **change these passwords** (staff can do it themselves from
their dashboard; you can reset any of them from Admin → staff page → Reset
password).

## Day-to-day use

- **You (admin):** log in as `admin`. From the dashboard you can see every
  staff member's leave/pool/deduction/bonus status and advance balance at a
  glance, click into a staff member to log leaves and advances, approve or
  reject leave requests they submit, and edit staff details.
- **Staff:** log in with the account you created for them. They can see
  their own leave balance, salary deduction/bonus projection, and advance
  history, submit a leave request (which lands in your pending queue), and
  change their own password.

## Data storage

Data lives in `data/db.json`, a plain JSON file — no database server needed.
Back it up periodically (e.g. copy it into cloud storage) since it's the only
copy of your records.

## Running it long-term

For daily use on your own machine, keep it running with `npm start` (or a
process manager like `pm2`). If you want staff to reach it from their own
phones/computers, it needs to be deployed somewhere reachable (e.g. a small
VPS or a platform like Railway/Render) — ask if you'd like help with that.
