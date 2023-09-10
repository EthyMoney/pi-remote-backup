const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const app = express();
const fs = require('fs');

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));

// make config directory if it doesn't exist
if (!fs.existsSync(path.join(__dirname, 'config'))) {
  fs.mkdirSync(path.join(__dirname, 'config'));
}

const db = new Database(path.join(__dirname, 'config', 'devices.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    ip TEXT,
    outputFile TEXT
  );

  CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cron TEXT
  );
`);

let schedule = db.prepare('SELECT cron FROM schedule WHERE id = ?').get(1);
if (!schedule) {
  schedule = '0 2 * * *'; // Default schedule
  db.prepare('INSERT INTO schedule (cron) VALUES (?)').run(schedule);
} else {
  schedule = schedule.cron;
}

function getDevices() {
  return db.prepare('SELECT * FROM devices').all();
}

console.table(getDevices());

function backupDevice(device) {
  const { user, ip } = device;
  const date = new Date();
  const formattedDate = date.toISOString().replace(/[:.]/g, '-'); // Formatting the date to remove characters not suitable for filenames
  const outputFile = `~/backup-${formattedDate}.gz`;

  const command = `ssh ${user}@${ip} "sudo dd if=/dev/mmcblk0 bs=1M | gzip -" | dd of=${outputFile}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error backing up device at ${ip}:`, error);
      return;
    }
    console.log(`Backup for device at ${ip} completed. Output File: ${outputFile}`);
  });
}

function startBackupScheduler() {
  cron.schedule(schedule, () => {
    getDevices().forEach(backupDevice);
  });
  console.log(`Backup scheduler started with schedule: ${schedule}`);
}

app.get('/', (req, res) => {
  res.render('index', { devices: getDevices(), schedule });
});

app.post('/add-device', (req, res) => {
  db.prepare('INSERT INTO devices (user, ip, outputFile) VALUES (?, ?, ?)').run(req.body.user, req.body.ip, req.body.outputFile);
  res.redirect('/');
});

app.post('/set-schedule', (req, res) => {
  schedule = req.body.schedule;
  db.prepare('UPDATE schedule SET cron = ? WHERE id = ?').run(schedule, 1);
  startBackupScheduler();
  res.redirect('/');
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
  startBackupScheduler();
});
