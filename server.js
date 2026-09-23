const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const db = require('./lib/db');
const { classifyLeavesForYear, salaryStatusForMonth, advanceSummary } = require('./lib/business');

const app = express();
const PORT = process.env.PORT || 3000;

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = path.join(__dirname, 'data', 'session-secret.txt');
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, secret);
  return secret;
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 },
  })
);

// ---------- helpers ----------

function currentYear() {
  return new Date().getFullYear();
}

function currentMonth() {
  return new Date().getMonth() + 1;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  const data = db.load();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!user || user.role !== 'admin') return res.status(403).send('Forbidden');
  req.currentUser = user;
  req.data = data;
  next();
}

function loadUser(req, res, next) {
  const data = db.load();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!user) return res.redirect('/login');
  req.currentUser = user;
  req.data = data;
  next();
}

const PAYMENT_MODES = ['cash', 'bank_transfer'];

function buildStaffSummary(data, user, year, month) {
  const leaves = data.leaves.filter((l) => l.userId === user.id);
  const advances = data.advances.filter((a) => a.userId === user.id);
  const overtime = data.overtime.filter((o) => o.userId === user.id);
  const advanceSalary = data.advanceSalary.filter((a) => a.userId === user.id);
  const salaryPayments = data.salaryPayments.filter((p) => p.userId === user.id);
  const leaveSummary = classifyLeavesForYear(leaves, year, data.settings, user.monthlySalary);
  const salaryStatus = salaryStatusForMonth(
    user,
    year,
    month,
    leaves,
    overtime,
    advanceSalary,
    salaryPayments,
    data.settings
  );
  const advSummary = advanceSummary(advances);
  const pendingRequests = data.leaveRequests.filter((r) => r.userId === user.id && r.status === 'pending');
  return { leaves, advances, overtime, advanceSalary, salaryPayments, leaveSummary, salaryStatus, advSummary, pendingRequests };
}

// ---------- auth ----------

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const data = db.load();
  const user = data.users.find((u) => u.username === username && u.active !== false);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.render('login', { error: 'Invalid username or password.' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, (req, res) => {
  const data = db.load();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!user) return res.redirect('/login');
  res.redirect(user.role === 'admin' ? '/admin' : '/me');
});

// ---------- admin ----------

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const year = parseInt(req.query.year, 10) || currentYear();
  const thisMonth = currentMonth();
  const thisYear = currentYear();
  const staff = data.users
    .filter((u) => u.role === 'staff')
    .map((u) => {
      const s = buildStaffSummary(data, u, year, thisMonth);
      // salaryStatus above is for the overview's selected `year`, but the
      // at-a-glance "due" column should always reflect the current month,
      // regardless of which year the leave table is showing.
      const salaryStatus =
        year === thisYear
          ? s.salaryStatus
          : salaryStatusForMonth(
              u,
              thisYear,
              thisMonth,
              s.leaves,
              s.overtime,
              s.advanceSalary,
              s.salaryPayments,
              data.settings
            );
      return { user: u, ...s, salaryStatus };
    });
  const pendingRequests = data.leaveRequests
    .filter((r) => r.status === 'pending')
    .map((r) => ({ ...r, user: data.users.find((u) => u.id === r.userId) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  res.render('admin_dashboard', {
    currentUser: req.currentUser,
    staff,
    year,
    settings: data.settings,
    pendingRequests,
  });
});

app.get('/admin/staff/new', requireAuth, requireAdmin, (req, res) => {
  res.render('admin_staff_new', { currentUser: req.currentUser, error: null });
});

app.post('/admin/staff/new', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const { name, username, password, monthlySalary } = req.body;
  if (!name || !username || !password) {
    return res.render('admin_staff_new', { currentUser: req.currentUser, error: 'All fields are required.' });
  }
  if (data.users.some((u) => u.username === username)) {
    return res.render('admin_staff_new', { currentUser: req.currentUser, error: 'That username is already taken.' });
  }
  data.users.push({
    id: db.nextId(data),
    name,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'staff',
    monthlySalary: parseFloat(monthlySalary) || 0,
    active: true,
  });
  db.save(data);
  res.redirect('/admin');
});

app.get('/admin/staff/:id', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const user = data.users.find((u) => u.id === parseInt(req.params.id, 10));
  if (!user) return res.status(404).send('Not found');
  const year = parseInt(req.query.year, 10) || currentYear();
  const month = parseInt(req.query.month, 10) || currentMonth();
  const summary = buildStaffSummary(data, user, year, month);
  const myRequests = data.leaveRequests
    .filter((r) => r.userId === user.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  res.render('admin_staff_detail', {
    currentUser: req.currentUser,
    user,
    year,
    month,
    ...summary,
    leaveRequests: myRequests,
  });
});

app.post('/admin/staff/:id/edit', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const user = data.users.find((u) => u.id === parseInt(req.params.id, 10));
  if (!user) return res.status(404).send('Not found');
  const { name, monthlySalary, active } = req.body;
  user.name = name || user.name;
  user.monthlySalary = parseFloat(monthlySalary) || 0;
  user.active = active === 'on';
  db.save(data);
  res.redirect(`/admin/staff/${user.id}`);
});

app.post('/admin/staff/:id/password', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const user = data.users.find((u) => u.id === parseInt(req.params.id, 10));
  if (!user) return res.status(404).send('Not found');
  const { password } = req.body;
  if (password && password.length >= 4) {
    user.passwordHash = bcrypt.hashSync(password, 10);
    db.save(data);
  }
  res.redirect(`/admin/staff/${user.id}`);
});

app.post('/admin/staff/:id/leave', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const { date, note } = req.body;
  if (date) {
    data.leaves.push({ id: db.nextId(data), userId, date, note: note || '' });
    db.save(data);
  }
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/leave/:leaveId/delete', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const leaveId = parseInt(req.params.leaveId, 10);
  data.leaves = data.leaves.filter((l) => l.id !== leaveId);
  db.save(data);
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/advance', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const { date, amount, type, note } = req.body;
  const amt = parseFloat(amount);
  if (date && amt > 0 && (type === 'given' || type === 'repaid')) {
    data.advances.push({ id: db.nextId(data), userId, date, amount: amt, type, note: note || '' });
    db.save(data);
  }
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/advance/:advId/delete', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const advId = parseInt(req.params.advId, 10);
  data.advances = data.advances.filter((a) => a.id !== advId);
  db.save(data);
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/salary-payment', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const { year, month, date, amount, mode, note } = req.body;
  const amt = parseFloat(amount);
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const paymentMode = PAYMENT_MODES.includes(mode) ? mode : PAYMENT_MODES[0];
  if (date && amt > 0 && y && m >= 1 && m <= 12) {
    data.salaryPayments.push({
      id: db.nextId(data),
      userId,
      year: y,
      month: m,
      date,
      amount: amt,
      mode: paymentMode,
      note: note || '',
    });
    db.save(data);
  }
  res.redirect(`/admin/staff/${userId}?year=${y}&month=${m}`);
});

app.post('/admin/staff/:id/salary-payment/:paymentId/delete', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const paymentId = parseInt(req.params.paymentId, 10);
  const payment = data.salaryPayments.find((p) => p.id === paymentId);
  data.salaryPayments = data.salaryPayments.filter((p) => p.id !== paymentId);
  db.save(data);
  const y = payment ? payment.year : currentYear();
  const m = payment ? payment.month : currentMonth();
  res.redirect(`/admin/staff/${userId}?year=${y}&month=${m}`);
});

app.post('/admin/staff/:id/overtime', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const { date, amount, note } = req.body;
  const amt = parseFloat(amount);
  if (date && amt > 0) {
    data.overtime.push({ id: db.nextId(data), userId, date, amount: amt, note: note || '' });
    db.save(data);
  }
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/overtime/:otId/delete', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const otId = parseInt(req.params.otId, 10);
  data.overtime = data.overtime.filter((o) => o.id !== otId);
  db.save(data);
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/advance-salary', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const { date, amount, note } = req.body;
  const amt = parseFloat(amount);
  if (date && amt > 0) {
    data.advanceSalary.push({ id: db.nextId(data), userId, date, amount: amt, note: note || '' });
    db.save(data);
  }
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/staff/:id/advance-salary/:asId/delete', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const userId = parseInt(req.params.id, 10);
  const asId = parseInt(req.params.asId, 10);
  data.advanceSalary = data.advanceSalary.filter((a) => a.id !== asId);
  db.save(data);
  res.redirect(`/admin/staff/${userId}`);
});

app.post('/admin/requests/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const reqId = parseInt(req.params.id, 10);
  const request = data.leaveRequests.find((r) => r.id === reqId);
  if (request && request.status === 'pending') {
    request.status = 'approved';
    request.decidedAt = new Date().toISOString();
    data.leaves.push({ id: db.nextId(data), userId: request.userId, date: request.date, note: request.reason || '' });
    db.save(data);
  }
  res.redirect(req.get('Referer') || '/admin');
});

app.post('/admin/requests/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const reqId = parseInt(req.params.id, 10);
  const request = data.leaveRequests.find((r) => r.id === reqId);
  if (request && request.status === 'pending') {
    request.status = 'rejected';
    request.decidedAt = new Date().toISOString();
    db.save(data);
  }
  res.redirect(req.get('Referer') || '/admin');
});

app.post('/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const data = req.data;
  const { extraLeavesPerYear, salaryDayDivisor } = req.body;
  data.settings.extraLeavesPerYear = parseInt(extraLeavesPerYear, 10) || data.settings.extraLeavesPerYear;
  data.settings.salaryDayDivisor = parseFloat(salaryDayDivisor) || data.settings.salaryDayDivisor;
  db.save(data);
  res.redirect('/admin');
});

// ---------- staff self-service ----------

app.get('/me', requireAuth, loadUser, (req, res) => {
  const data = req.data;
  const user = req.currentUser;
  if (user.role === 'admin') return res.redirect('/admin');
  const year = parseInt(req.query.year, 10) || currentYear();
  const month = parseInt(req.query.month, 10) || currentMonth();
  const summary = buildStaffSummary(data, user, year, month);
  const myRequests = data.leaveRequests
    .filter((r) => r.userId === user.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  res.render('staff_dashboard', {
    currentUser: user,
    year,
    month,
    ...summary,
    leaveRequests: myRequests,
  });
});

app.post('/me/leave-request', requireAuth, loadUser, (req, res) => {
  const data = req.data;
  const user = req.currentUser;
  const { date, reason } = req.body;
  if (date) {
    data.leaveRequests.push({
      id: db.nextId(data),
      userId: user.id,
      date,
      reason: reason || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      decidedAt: null,
    });
    db.save(data);
  }
  res.redirect('/me');
});

app.post('/me/password', requireAuth, loadUser, (req, res) => {
  const data = req.data;
  const user = req.currentUser;
  const { currentPassword, newPassword } = req.body;
  if (bcrypt.compareSync(currentPassword || '', user.passwordHash) && newPassword && newPassword.length >= 4) {
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    db.save(data);
  }
  res.redirect('/me');
});

app.listen(PORT, () => {
  console.log(`Staff leave tracker running at http://localhost:${PORT}`);
});
