// Tiny JSON-file data store. Fine at this scale (a handful of staff);
// avoids native DB dependencies entirely.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DATA = {
  settings: {
    extraLeavesPerYear: 20,
    salaryDayDivisor: 30, // used to derive a "per day" rate from monthly salary
  },
  users: [],
  leaves: [], // { id, userId, date: 'YYYY-MM-DD', note }
  advances: [], // { id, userId, date, amount, type: 'given'|'repaid', note }
  leaveRequests: [], // { id, userId, date, reason, status: 'pending'|'approved'|'rejected', createdAt, decidedAt }
  salaryPayments: [], // { id, userId, year, month (1-12), date, amount, mode: 'cash'|'bank_transfer', note }
  overtime: [], // { id, userId, date, amount, note }
  advanceSalary: [], // { id, userId, date, amount, note } — deducted from the following month's salary due; kept separate from the given/repaid advance ledger
  nextId: 1,
};

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(DEFAULT_DATA);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const data = JSON.parse(raw);
  // fill in any keys missing from an older db file
  for (const key of Object.keys(DEFAULT_DATA)) {
    if (!(key in data)) data[key] = DEFAULT_DATA[key];
  }
  return data;
}

function save(data) {
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

function nextId(data) {
  const id = data.nextId;
  data.nextId += 1;
  return id;
}

module.exports = { load, save, nextId, DB_PATH };
