// Run once with: npm run seed
// Creates an admin account and 6 staff accounts with temporary passwords.
const bcrypt = require('bcryptjs');
const db = require('./db');

const STAFF_NAMES = ['Staff 1', 'Staff 2', 'Staff 3', 'Staff 4', 'Staff 5', 'Staff 6'];

function main() {
  const data = db.load();

  if (data.users.length > 0) {
    console.log('Users already exist — seed skipped. Delete data/db.json to reseed from scratch.');
    return;
  }

  const credentials = [];

  const adminPassword = 'admin123';
  data.users.push({
    id: db.nextId(data),
    name: 'Owner',
    username: 'admin',
    passwordHash: bcrypt.hashSync(adminPassword, 10),
    role: 'admin',
    monthlySalary: 0,
    active: true,
  });
  credentials.push({ username: 'admin', password: adminPassword, role: 'admin' });

  STAFF_NAMES.forEach((name, idx) => {
    const username = `staff${idx + 1}`;
    const password = `staff${idx + 1}pass`;
    data.users.push({
      id: db.nextId(data),
      name,
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'staff',
      monthlySalary: 20000,
      active: true,
    });
    credentials.push({ username, password, role: 'staff' });
  });

  db.save(data);

  console.log('Seeded admin + 6 staff accounts. TEMPORARY LOGIN CREDENTIALS (change these!):\n');
  credentials.forEach((c) => console.log(`  ${c.role.padEnd(6)}  username: ${c.username.padEnd(8)}  password: ${c.password}`));
  console.log('\nEdit staff names and salaries from the Admin dashboard after logging in.');
}

main();
