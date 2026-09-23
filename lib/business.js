// Leave & pay calculations.
//
// Policy implemented (as described by the business owner):
//  - Every staff member gets 1 free leave per calendar week (their weekly off).
//    This does not count against anything and is not paid/deducted specially.
//  - On top of that, they get a pool of `extraLeavesPerYear` (default 20) leaves
//    for the whole calendar year, usable whenever.
//  - Any leave beyond "1 per week" that exceeds the remaining pool is UNPAID:
//    it is deducted from salary at a per-day rate.
//  - Any pool days left unused at year end are paid out as a bonus at the same
//    per-day rate.
//
// Leaves are classified in chronological order within a year, week by week
// (week = Monday-Sunday), so which leave in a week is "the free one" is
// always the earliest one taken that week.

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function dayRate(monthlySalary, settings) {
  const divisor = settings.salaryDayDivisor || 30;
  return monthlySalary / divisor;
}

// The { year, month } that immediately follows the month a date falls in —
// used because advance salary given in one month is deducted the next.
function nextMonthOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

/**
 * Classify a user's leaves for a given year.
 * @returns {
 *   items: [{ id, date, category: 'weekly_free'|'extra_pool'|'unpaid_deduction' }],
 *   weeklyFreeCount, extraPoolUsed, extraPoolRemaining, unpaidDeductionCount,
 *   deductionAmount, bonusAmount, dayRate
 * }
 */
function classifyLeavesForYear(userLeaves, year, settings, monthlySalary) {
  const poolMax = settings.extraLeavesPerYear ?? 20;
  const yearLeaves = userLeaves
    .filter((l) => l.date.startsWith(String(year)))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));

  const byWeek = new Map();
  for (const leave of yearLeaves) {
    const wk = mondayOf(leave.date);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(leave);
  }

  const weekKeys = Array.from(byWeek.keys()).sort();
  const items = [];
  let poolUsed = 0;

  for (const wk of weekKeys) {
    const weekLeaves = byWeek.get(wk);
    weekLeaves.forEach((leave, idx) => {
      if (idx === 0) {
        items.push({ id: leave.id, date: leave.date, note: leave.note, category: 'weekly_free' });
      } else if (poolUsed < poolMax) {
        poolUsed += 1;
        items.push({ id: leave.id, date: leave.date, note: leave.note, category: 'extra_pool' });
      } else {
        items.push({ id: leave.id, date: leave.date, note: leave.note, category: 'unpaid_deduction' });
      }
    });
  }

  const weeklyFreeCount = items.filter((i) => i.category === 'weekly_free').length;
  const unpaidDeductionCount = items.filter((i) => i.category === 'unpaid_deduction').length;
  const extraPoolRemaining = Math.max(0, poolMax - poolUsed);
  const rate = dayRate(monthlySalary, settings);

  return {
    items,
    poolMax,
    weeklyFreeCount,
    extraPoolUsed: poolUsed,
    extraPoolRemaining,
    unpaidDeductionCount,
    deductionAmount: Math.round(unpaidDeductionCount * rate * 100) / 100,
    bonusAmount: Math.round(extraPoolRemaining * rate * 100) / 100,
    dayRate: Math.round(rate * 100) / 100,
  };
}

/**
 * Salary due/paid status for one staff member for one calendar month.
 * Net due = fixed monthly salary, minus any unpaid-leave deduction for that
 * specific month (worked out from where that month falls in the year's
 * running leave-pool classification), plus overtime earned that month, minus
 * any advance salary that was given out the PRECEDING month (advance salary
 * is recovered the month after it's paid out). Payments logged against the
 * month are summed, so partial/installment payments are supported naturally.
 *
 * Advance salary is intentionally kept separate from the given/repaid
 * "advance" ledger (see advanceSummary) — it nets directly against next
 * month's due amount and never touches the outstanding-advance balance.
 */
function salaryStatusForMonth(user, year, month, userLeaves, userOvertime, userAdvanceSalary, userSalaryPayments, settings) {
  const yearLeaveSummary = classifyLeavesForYear(userLeaves, year, settings, user.monthlySalary);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const unpaidDaysThisMonth = yearLeaveSummary.items.filter(
    (i) => i.category === 'unpaid_deduction' && i.date.startsWith(monthPrefix)
  ).length;
  const deductionThisMonth = Math.round(unpaidDaysThisMonth * yearLeaveSummary.dayRate * 100) / 100;

  const overtimeEntries = userOvertime
    .filter((o) => o.userId === user.id && o.date.startsWith(monthPrefix))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const overtimeThisMonth = Math.round(overtimeEntries.reduce((sum, o) => sum + o.amount, 0) * 100) / 100;

  const sortedAdvanceSalary = userAdvanceSalary.filter((a) => a.userId === user.id);
  const advanceSalaryDeductedEntries = sortedAdvanceSalary
    .filter((a) => {
      const applies = nextMonthOf(a.date);
      return applies.year === year && applies.month === month;
    })
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const advanceSalaryDeductedThisMonth =
    Math.round(advanceSalaryDeductedEntries.reduce((sum, a) => sum + a.amount, 0) * 100) / 100;

  const advanceSalaryGivenEntries = sortedAdvanceSalary
    .filter((a) => a.date.startsWith(monthPrefix))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const advanceSalaryGivenThisMonth =
    Math.round(advanceSalaryGivenEntries.reduce((sum, a) => sum + a.amount, 0) * 100) / 100;

  const netDue =
    Math.round((user.monthlySalary - deductionThisMonth + overtimeThisMonth - advanceSalaryDeductedThisMonth) * 100) /
    100;

  const payments = userSalaryPayments
    .filter((p) => p.userId === user.id && p.year === year && p.month === month)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const totalPaid = Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const balance = Math.round((netDue - totalPaid) * 100) / 100;

  return {
    year,
    month,
    monthlySalary: user.monthlySalary,
    unpaidDaysThisMonth,
    deductionThisMonth,
    overtimeEntries,
    overtimeThisMonth,
    advanceSalaryDeductedEntries,
    advanceSalaryDeductedThisMonth,
    advanceSalaryGivenEntries,
    advanceSalaryGivenThisMonth,
    netDue,
    payments,
    totalPaid,
    balance,
    dayRate: yearLeaveSummary.dayRate,
  };
}

function advanceSummary(userAdvances) {
  let given = 0;
  let repaid = 0;
  for (const a of userAdvances) {
    if (a.type === 'given') given += a.amount;
    else if (a.type === 'repaid') repaid += a.amount;
  }
  return {
    totalGiven: Math.round(given * 100) / 100,
    totalRepaid: Math.round(repaid * 100) / 100,
    outstanding: Math.round((given - repaid) * 100) / 100,
  };
}

module.exports = { mondayOf, dayRate, nextMonthOf, classifyLeavesForYear, salaryStatusForMonth, advanceSummary };
