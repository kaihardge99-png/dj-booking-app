const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { google } = require('googleapis');
const { parseUnavailableDatesFromLabels, getMonthDateRange } = require('./googleAppointmentAvailability');
require('dotenv').config();

let puppeteer = null;
let chromium = null;
try {
  puppeteer = require('puppeteer-core');
    chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
  console.log('✓ Puppeteer and Chromium successfully loaded');
} catch (error) {
  console.warn('Puppeteer/Chromium not available:', error.message);
  console.warn('This is expected if running in a browser environment');
}

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
const usePostgres = Boolean(process.env.DATABASE_URL);
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
let OVERRIDE_GOOGLE_APPOINTMENT_URL = null;
// Use the canonical Google Calendar appointments schedule URL as the fallback
// This is more stable than short dynamic links which can return 'Dynamic Link Not Found'
const FALLBACK_GOOGLE_APPOINTMENT_URL = 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1dBFFce1RD4OkFzmuYGWnmjmyWoWjiAIn0mrPu2v8nMIdfLgMUV22Lpug3UBEzWthPCyxhrKbl';
const GOOGLE_APPOINTMENT_URL = process.env.GOOGLE_APPOINTMENT_URL || FALLBACK_GOOGLE_APPOINTMENT_URL;
const CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH || '';
const APPOINTMENT_AVAILABILITY_CACHE = new Map();

console.log('[CONFIG] Environment variables available:');
console.log('[CONFIG] GOOGLE_APPOINTMENT_URL:', process.env.GOOGLE_APPOINTMENT_URL ? '✓ SET' : '✗ NOT SET', `(using ${GOOGLE_APPOINTMENT_URL === FALLBACK_GOOGLE_APPOINTMENT_URL ? 'fallback' : 'env'})`);
console.log('[CONFIG] GOOGLE_CALENDAR_ICS_URL:', process.env.GOOGLE_CALENDAR_ICS_URL ? '✓ SET' : '✗ NOT SET');
console.log('[CONFIG] NODE_ENV:', process.env.NODE_ENV);
console.log('[CONFIG] PORT:', PORT);
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GOOGLE_CALENDAR_ICS_URL = process.env.GOOGLE_CALENDAR_ICS_URL || '';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Australia/Sydney';
const PRIMARY_AVAILABILITY_SOURCE = GOOGLE_APPOINTMENT_URL ? 'appointment' : (GOOGLE_CALENDAR_ICS_URL ? 'ics' : 'none');

// Ensure JWT secret is set (provide a safe fallback for local development)
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET) {
  if (isProd) {
    process.env.JWT_SECRET = 'Raw101';
  } else {
    console.warn('Warning: JWT_SECRET is not set. Using temporary development secret.');
    process.env.JWT_SECRET = 'dev-secret-change-me';
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve the React admin app for any /admin path without using express route patterns
app.use((req, res, next) => {
  try {
    if (req.path && req.path.startsWith('/admin')) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  } catch (err) {
    console.error('Error serving admin app:', err && err.message);
  }
  next();
});

app.use(express.static('public'));

// Token verification middlewares (placed early so routes can reference them)
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const createSqliteDb = () => {
  const sqlite = new Database('./bookings.db');
  sqlite.pragma('journal_mode = WAL');

  return {
    kind: 'sqlite',
    exec: async (sql) => sqlite.exec(sql),
    prepare: (sql) => {
      const stmt = sqlite.prepare(sql);
      return {
        run: (...params) => stmt.run(...params),
        get: (...params) => stmt.get(...params),
        all: (...params) => stmt.all(...params),
      };
    },
  };
};

const createPostgresDb = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProd ? { rejectUnauthorized: false } : false,
  });

  const normalizePlaceholders = (sql) => {
    let index = 0;
    return sql.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    });
  };

  const appendReturningId = (sql) => {
    const trimmed = sql.trim();
    if (trimmed.endsWith(';')) {
      return `${trimmed.slice(0, -1)} RETURNING id;`;
    }
    return `${trimmed} RETURNING id`;
  };

  const prepare = (sql) => {
    const query = normalizePlaceholders(sql.trim());
    const isInsert = /^INSERT\s+/i.test(query) && !/RETURNING\s+.+/i.test(query);

    return {
      run: async (...params) => {
        const finalSql = isInsert ? appendReturningId(query) : query;
        const result = await pool.query(finalSql, params);
        return {
          lastInsertRowid: result.rows[0]?.id,
          changes: result.rowCount,
        };
      },
      get: async (...params) => {
        const result = await pool.query(query, params);
        return result.rows[0];
      },
      all: async (...params) => {
        const result = await pool.query(query, params);
        return result.rows;
      },
    };
  };

  return {
    kind: 'postgres',
    exec: async (sql) => {
      await pool.query(sql);
    },
    prepare,
  };
};

let db = createSqliteDb();

const initializeDatabaseConnection = async () => {
  if (usePostgres) {
    try {
      const postgresDb = createPostgresDb();
      await postgresDb.exec('SELECT 1');
      db = postgresDb;
      console.log('Using PostgreSQL database');
      return;
    } catch (error) {
      console.warn('PostgreSQL unavailable, falling back to SQLite:', error.message);
    }
  }

  db = createSqliteDb();
  console.log('Using SQLite database');
};

const ensureBlockedDatesColumns = async () => {
  if (db.kind === 'postgres') {
    await db.exec('ALTER TABLE blocked_dates ADD COLUMN IF NOT EXISTS start_time TEXT;');
    await db.exec('ALTER TABLE blocked_dates ADD COLUMN IF NOT EXISTS end_time TEXT;');
  } else {
    const columns = await db.prepare("PRAGMA table_info(blocked_dates);").all();
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('start_time')) {
      await db.exec('ALTER TABLE blocked_dates ADD COLUMN start_time TEXT');
    }
    if (!columnNames.includes('end_time')) {
      await db.exec('ALTER TABLE blocked_dates ADD COLUMN end_time TEXT');
    }
  }
};

const ensureBookingUsernameColumn = async () => {
  if (db.kind === 'postgres') {
    await db.exec('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_username TEXT;');
  } else {
    const columns = await db.prepare("PRAGMA table_info(bookings);").all();
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('booking_username')) {
      await db.exec('ALTER TABLE bookings ADD COLUMN booking_username TEXT');
    }
  }
};

const getSetting = async (key, defaultValue) => {
  try {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = await stmt.get(key);
    return row ? (row.value ? JSON.parse(row.value) : defaultValue) : defaultValue;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error.message);
    return defaultValue;
  }
};

const setSetting = async (key, value) => {
  try {
    const stmt = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now")) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime("now")');
    await stmt.run(key, JSON.stringify(value), JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting ${key}:`, error.message);
  }
};

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_phone TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_hours INTEGER NOT NULL,
    package_type TEXT NOT NULL,
    cdj_count INTEGER,
    mixer_type TEXT,
    djm_v10_addon BOOLEAN DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    total_price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blocked_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    start_time TEXT,
    end_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blocked_date_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    reason TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_events_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_uid TEXT UNIQUE,
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_ignores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

const postgresSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_phone TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_hours INTEGER NOT NULL,
    package_type TEXT NOT NULL,
    cdj_count INTEGER,
    mixer_type TEXT,
    djm_v10_addon BOOLEAN DEFAULT FALSE,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    total_price REAL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_dates (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    start_time TEXT,
    end_time TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_date_segments (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    reason TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_events_cache (
    id SERIAL PRIMARY KEY,
    event_uid TEXT UNIQUE,
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_ignores (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
];

const initializeDatabase = async () => {
  try {
    await initializeDatabaseConnection();

    if (db.kind === 'postgres') {
      for (const statement of postgresSchemaStatements) {
        await db.exec(statement);
      }
    } else {
      await db.exec(sqliteSchema);
    }

    await ensureBlockedDatesColumns();
    await ensureBookingUsernameColumn();
  } catch (error) {
    console.error('Database initialization failed, falling back to SQLite:', error.message);
    db = createSqliteDb();
    await db.exec(sqliteSchema);
    await ensureBlockedDatesColumns();
    await ensureBookingUsernameColumn();
  }
};

// Periodic calendar sync: poll Google Calendar and sync cache/blocks so edits appear automatically
const startCalendarPolling = (intervalMinutes = 5) => {
  const run = async () => {
    try {
      const now = new Date();
      const timeMin = now.toISOString();
      const future = new Date(now);
      future.setDate(future.getDate() + 30);
      const timeMax = future.toISOString();
      const events = await fetchGoogleCalendarEvents(timeMin, timeMax);
      await syncCalendarEventsAndBlockDeleted(events);
      console.log('Calendar sync completed', new Date().toISOString());
    } catch (err) {
      console.error('Periodic calendar sync error:', err.message);
    }
  };

  // Run immediately and then on interval
  run();
  setInterval(run, intervalMinutes * 60 * 1000);
};

// Email configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const ADMIN_EMAILS = ['allfriendsavhire@gmail.com', 'kaihardge@gmail.com'];

// Operating hours
const OPERATING_HOURS = {
  0: null, // Sunday - closed
  1: { open: 10, close: 17 }, // Monday
  2: { open: 10, close: 17 }, // Tuesday
  3: { open: 10, close: 17 }, // Wednesday
  4: { open: 10, close: 22 }, // Thursday
  5: { open: 10, close: 22 }, // Friday
  6: { open: 10, close: 17 }, // Saturday
};

const toMinutes = (time) => {
  if (!time || typeof time !== 'string') return null;
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
};

const toTimeString = (minutes) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const getTimeZoneParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const result = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
  }

  if (!result.year || !result.month || !result.day) return null;

  return {
    date: `${result.year}-${result.month}-${result.day}`,
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
  };
};

const getLocalMinuteInfo = (date, timeZone) => {
  const parts = getTimeZoneParts(date, timeZone);
  if (!parts) return null;
  return {
    date: parts.date,
    minutes: parts.hour * 60 + parts.minute,
  };
};

const getLocalEventRange = (event) => {
  if (event.start?.date && event.end?.date) {
    return {
      fullDay: true,
      startDate: event.start.date,
      endDate: event.end.date,
    };
  }

  const start = new Date(event.start?.dateTime || event.start?.date);
  const end = new Date(event.end?.dateTime || event.end?.date);

  const startInfo = getLocalMinuteInfo(start, APP_TIMEZONE);
  const endInfo = getLocalMinuteInfo(end, APP_TIMEZONE);

  if (!startInfo || !endInfo) return null;

  return {
    fullDay: false,
    startDate: startInfo.date,
    startMinutes: startInfo.minutes,
    endDate: endInfo.date,
    endMinutes: endInfo.minutes,
  };
};

const getEventRangeForDate = (date, event) => {
  const eventRange = getLocalEventRange(event);
  if (!eventRange) return null;

  if (eventRange.fullDay) {
    if (date >= eventRange.startDate && date < eventRange.endDate) {
      return { start: 0, end: 24 * 60 };
    }
    return null;
  }

  const { startDate, endDate, startMinutes, endMinutes } = eventRange;

  if (date < startDate || date > endDate) {
    return null;
  }

  if (date === startDate && date === endDate) {
    return { start: startMinutes, end: endMinutes };
  }

  if (date === startDate) {
    return { start: startMinutes, end: 24 * 60 };
  }

  if (date === endDate) {
    return { start: 0, end: endMinutes };
  }

  return { start: 0, end: 24 * 60 };
};

const overlap = (startA, endA, startB, endB) => startA < endB && endA > startB;

const listDateAvailability = async (date, blockedDatesRows, bookingRows, googleEvents) => {
  const day = new Date(date).getDay();
  const hours = OPERATING_HOURS[day];

  if (!hours) {
    return { slots: [], isUnavailable: true };
  }

  if (blockedDatesRows.some((row) => row.date === date && (!row.start_time || !row.end_time))) {
    return { slots: [], isUnavailable: true };
  }

  const openMinutes = hours.open * 60;
  const closeMinutes = hours.close * 60;

  const googleBusy = googleEvents
    .map((event) => getEventRangeForDate(date, event))
    .filter(Boolean);

  const blockedBusy = blockedDatesRows
    .filter((row) => row.date === date)
    .map((row) => {
      if (!row.start_time || !row.end_time) {
        return { fullDay: true };
      }
      const start = toMinutes(row.start_time);
      const end = toMinutes(row.end_time);
      if (start === null || end === null || start >= end) return null;
      return { start, end };
    })
    .filter(Boolean);

  if (blockedBusy.some((range) => range.fullDay)) {
    return { slots: [], isUnavailable: true };
  }

  const bookingBusy = bookingRows
    .map((row) => {
      const start = toMinutes(row.start_time);
      const end = toMinutes(row.end_time);
      if (start === null || end === null) return null;
      return { start, end };
    })
    .filter(Boolean);

  const blockedRanges = blockedBusy.map((range) => ({ start: range.start, end: range.end })).filter(Boolean);
  const busyRanges = [...googleBusy, ...bookingBusy, ...blockedRanges];

  const slots = [];
  for (let slotStart = openMinutes; slotStart < closeMinutes; slotStart += 60) {
    const slotEnd = slotStart + 60;
    if (slotEnd > closeMinutes) continue;

    const blocked = busyRanges.some((range) => overlap(slotStart, slotEnd, range.start, range.end));
    if (!blocked) {
      slots.push(toTimeString(slotStart));
    }
  }

  return {
    slots,
    isUnavailable: slots.length === 0,
  };
};

const fetchGoogleCalendarEvents = async (timeMin, timeMax) => {
  if (!GOOGLE_CALENDAR_ID && !GOOGLE_CALENDAR_ICS_URL) return [];

  try {
    if (GOOGLE_SERVICE_ACCOUNT_JSON && GOOGLE_CALENDAR_ID) {
      const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
      const calendar = google.calendar({ version: 'v3', auth });
      const response = await calendar.events.list({
        calendarId: GOOGLE_CALENDAR_ID,
        singleEvents: true,
        orderBy: 'startTime',
        timeMin,
        timeMax,
        maxResults: 2500,
      });
      return response.data.items || [];
    }

    if (GOOGLE_API_KEY && GOOGLE_CALENDAR_ID) {
      const response = await axios.get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`, {
        params: {
          key: GOOGLE_API_KEY,
          singleEvents: true,
          orderBy: 'startTime',
          timeMin,
          timeMax,
          maxResults: 2500,
        },
      });

      return response.data.items || [];
    }

    if (GOOGLE_CALENDAR_ICS_URL) {
      const response = await axios.get(GOOGLE_CALENDAR_ICS_URL);
      return parseIcsEvents(response.data || '');
    }

    return [];
  } catch (error) {
    console.error('Google Calendar fetch error:', error.message);
    return [];
  }
};

const normalizeAppointmentDate = (timestampSeconds) => {
  const date = new Date(timestampSeconds * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const normalizeAppointmentTime = (timestampSeconds) => {
  const date = new Date(timestampSeconds * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isAppointmentRpcUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return /AppointmentBookingService|ListAvailableSlots|calendar-pa\.clients6\.google\.com/.test(url);
};

const parseAppointmentSlotsPayload = (payload) => {
  const slots = [];

  const extractTimestamp = (node) => {
    if (typeof node === 'string') return node;
    if (!Array.isArray(node) || node.length === 0) return null;

    for (const item of node) {
      const candidate = extractTimestamp(item);
      if (candidate) return candidate;
    }

    return null;
  };

  const visit = (node) => {
    if (!node || !Array.isArray(node)) return;

    if (node.length === 2 && typeof node[1] === 'number') {
      const timestampString = extractTimestamp(node[0]);
      const timestamp = Number(timestampString);
      if (!Number.isNaN(timestamp)) {
        slots.push({ timestamp, duration: node[1] });
      }
    }

    for (const item of node) {
      visit(item);
    }
  };

  visit(payload);
  return slots;
};

const buildAppointmentAvailabilityFromSlots = (payload, month) => {
  const slots = parseAppointmentSlotsPayload(payload);
  const map = {};

  slots.forEach(({ timestamp }) => {
    const date = normalizeAppointmentDate(timestamp);
    const time = normalizeAppointmentTime(timestamp);
    if (!map[date]) map[date] = new Set();
    map[date].add(time);
  });

  const formatted = {};
  for (const [date, times] of Object.entries(map)) {
    formatted[date] = Array.from(times).sort();
  }

  const unavailableDates = [];
  if (month && typeof month === 'string') {
    const [yearStr, monthStr] = String(month).split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    if (!Number.isNaN(year) && !Number.isNaN(monthIndex)) {
      const { firstDay, lastDay } = getMonthDateRange(year, monthIndex);
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        if (!formatted[dateStr]) {
          unavailableDates.push(dateStr);
        }
      }
    }
  }

  return { slotsByDate: formatted, unavailableDates };
};

const fetchGoogleAppointmentAvailability = async (month, appointmentUrl) => {
  appointmentUrl = appointmentUrl || OVERRIDE_GOOGLE_APPOINTMENT_URL || GOOGLE_APPOINTMENT_URL;
  if (!appointmentUrl) return [];

  console.log('[Appointment] Fetching availability for month:', month);
  console.log('[Appointment] Using appointment URL:', appointmentUrl);
  console.log('[Appointment] Browser available:', !!puppeteer && !!chromium);

  try {
    if (!puppeteer || !chromium) {
      console.warn('[Appointment] Browser not available for appointment page scraping, skipping');
      return [];
    }

    const browserArgs = (chromium && chromium.args) ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'];
    let executablePath = CHROME_EXECUTABLE_PATH;
    if (!executablePath && process.platform === 'darwin') {
      const defaultChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (fs.existsSync(defaultChromePath)) {
        executablePath = defaultChromePath;
      }
    }
    if (!executablePath && chromium && chromium.executablePath) {
      executablePath = await chromium.executablePath();
    }
    if (!executablePath) {
      console.warn('[Appointment] No browser executable path available, skipping appointment availability fetch');
      return [];
    }

    console.log('[Appointment] Launching browser...');
    const browser = await puppeteer.launch({
      args: browserArgs,
      executablePath,
      headless: true,
      defaultViewport: chromium.defaultViewport || null,
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(120000);
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
      console.log('[Appointment] Navigating to:', appointmentUrl);

      let appointmentResponse = null;
      const onResponse = (response) => {
        const url = response.url();
        if (isAppointmentRpcUrl(url) && response.status() === 200) {
          appointmentResponse = response;
          console.log('[Appointment] Captured RPC response URL:', url);
        }
      };
      page.on('response', onResponse);
      page.on('requestfailed', (request) => {
        if (isAppointmentRpcUrl(request.url())) {
          console.warn('[Appointment] Appointment request failed:', request.url(), request.failure()?.errorText || 'unknown');
        }
      });

      await page.goto(appointmentUrl, {
        waitUntil: 'networkidle2',
        timeout: 120000,
      });

      await page.waitForFunction(
        () => document.readyState === 'complete' || document.querySelector('button[aria-label]'),
        { timeout: 30000 }
      ).catch(() => null);

      await sleep(3000);

      if (!appointmentResponse) {
        try {
          const response = await page.waitForResponse(
            (res) => isAppointmentRpcUrl(res.url()) && res.status() === 200,
            { timeout: 60000 }
          );
          if (response) {
            appointmentResponse = response;
          }
        } catch (waitErr) {
          console.warn('[Appointment] Could not capture appointment RPC response:', waitErr.message);
        }
      }

      if (!appointmentResponse) {
        console.warn('[Appointment] No ListAvailableSlots response found, attempting WIZ_global_data fallback');

        // First try to extract a candidate payload from window.WIZ_global_data
        const wizCandidate = await page.evaluate(() => {
          try {
            const root = window.WIZ_global_data;
            if (!root) return null;

            const visited = new WeakSet();

            const looksLikeSlotNode = (node) => {
              if (!Array.isArray(node)) return false;
              // find at least one child that matches [something, number]
              for (const item of node) {
                if (Array.isArray(item) && item.length === 2 && typeof item[1] === 'number') return true;
              }
              return false;
            };

            const findNode = (node) => {
              if (!node || typeof node !== 'object') return null;
              if (visited.has(node)) return null;
              visited.add(node);

              if (looksLikeSlotNode(node)) return node;

              if (Array.isArray(node)) {
                for (const child of node) {
                  const res = findNode(child);
                  if (res) return res;
                }
              } else {
                for (const k of Object.keys(node)) {
                  const res = findNode(node[k]);
                  if (res) return res;
                }
              }

              return null;
            };

            return findNode(root) || null;
          } catch (err) {
            return null;
          }
        });

        if (wizCandidate) {
          console.log('[Appointment] Found WIZ_global_data candidate payload, parsing');
          // Use the same parsing helpers used for ListAvailableSlots payloads
          try {
            const appointmentData = buildAppointmentAvailabilityFromSlots(wizCandidate, month);
            console.log('[Appointment] Parsed unavailable appointment dates (WIZ):', appointmentData.unavailableDates.length);
            await page.close();
            return appointmentData;
          } catch (err) {
            console.warn('[Appointment] WIZ_global_data parsing failed:', err && err.message);
            // fall through to label parse below
          }
        }

        // Last-resort: label parse as before
        console.warn('[Appointment] Falling back to label parse (no WIZ candidate)');
        const labels = await page.evaluate(() => {
          const out = [];
          const nodes = Array.from(document.querySelectorAll('[aria-label]'));
          nodes.forEach((el) => {
            const value = el.getAttribute('aria-label');
            if (value) out.push(value.trim());
          });
          const buttons = Array.from(document.querySelectorAll('button'));
          buttons.forEach((button) => {
            const aria = button.getAttribute('aria-label');
            if (aria) out.push(aria.trim());
          });
          const texts = Array.from(document.querySelectorAll('button,div,span'));
          texts.forEach((el) => {
            const text = el.textContent?.trim();
            if (text && /no available times|no availability|no available slots|fully booked/i.test(text)) {
              out.push(text);
            }
          });
          return Array.from(new Set(out)).filter(Boolean);
        });
        console.log('[Appointment] Fallback labels sample:', labels.slice(0, 20));
        console.log('[Appointment] Label fallback count:', labels.length);
        await page.close();
        return {
          slotsByDate: {},
          unavailableDates: parseUnavailableDatesFromLabels(labels, month),
        };
      }

      let responseText = '';
      try {
        responseText = await appointmentResponse.text();
      } catch (textErr) {
        try {
          const buffer = await appointmentResponse.buffer();
          responseText = buffer.toString('utf8');
        } catch (bufferErr) {
          console.error('[Appointment] Failed to read ListAvailableSlots response:', bufferErr.message);
          await page.close();
          return { slotsByDate: {}, unavailableDates: [] };
        }
      }

      await page.close();
      let payload;
      try {
        payload = JSON.parse(responseText);
      } catch (parseErr) {
        console.error('[Appointment] Failed to parse ListAvailableSlots response:', parseErr.message);
        console.error('[Appointment] Response text sample:', responseText.slice(0, 1000));
        return { slotsByDate: {}, unavailableDates: [] };
      }

      const appointmentData = buildAppointmentAvailabilityFromSlots(payload, month);
      console.log('[Appointment] Parsed available appointment dates:', Object.keys(appointmentData.slotsByDate).length);
      console.log('[Appointment] Parsed unavailable appointment dates:', appointmentData.unavailableDates.length);
      return appointmentData;
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('[Appointment] Error:', error.message);
    console.error('[Appointment] Stack:', error.stack);
    return [];
  }
};

const getCachedAppointmentAvailability = async (month, appointmentUrl) => {
  if (!GOOGLE_APPOINTMENT_URL && !appointmentUrl) {
    return { slotsByDate: {}, unavailableDates: [] };
  }
  const key = `${month}|${appointmentUrl || GOOGLE_APPOINTMENT_URL}`;
  const cached = APPOINTMENT_AVAILABILITY_CACHE.get(key);

  // If we have a fresh cache entry, return it immediately
  if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
    return cached.data;
  }

  // If we have a stale cache entry, return it immediately and refresh in background
  if (cached) {
    // background refresh (don't await)
    fetchGoogleAppointmentAvailability(month, appointmentUrl)
      .then((data) => {
        const normalizedData = {
          slotsByDate: data?.slotsByDate || {},
          unavailableDates: Array.isArray(data?.unavailableDates) ? data.unavailableDates : [],
        };
        APPOINTMENT_AVAILABILITY_CACHE.set(key, { data: normalizedData, fetchedAt: Date.now() });
        console.log('[Appointment] Background refreshed cache for', key);
      })
      .catch((err) => console.warn('[Appointment] Background refresh failed:', err && err.message));

    return cached.data;
  }

  // No cache: kick off a background fetch and return an immediate empty/default result
  fetchGoogleAppointmentAvailability(month, appointmentUrl)
    .then((data) => {
      const normalizedData = {
        slotsByDate: data?.slotsByDate || {},
        unavailableDates: Array.isArray(data?.unavailableDates) ? data.unavailableDates : [],
      };
      APPOINTMENT_AVAILABILITY_CACHE.set(key, { data: normalizedData, fetchedAt: Date.now() });
      console.log('[Appointment] Primed cache for', key);
    })
    .catch((err) => console.warn('[Appointment] Priming cache failed:', err && err.message));

  return { slotsByDate: {}, unavailableDates: [] };
};

// Periodic background scraper to proactively fetch and cache appointment availability
const startAppointmentBackgroundScraper = (intervalMinutes = 10, monthsAhead = 2) => {
  const run = async () => {
    try {
      const now = new Date();
      for (let i = 0; i <= monthsAhead; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const key = `${monthKey}|${GOOGLE_APPOINTMENT_URL}`;
        console.log('[Appointment] Background fetch for', monthKey);
        try {
          const data = await fetchGoogleAppointmentAvailability(monthKey, GOOGLE_APPOINTMENT_URL);
          const normalizedData = {
            slotsByDate: data?.slotsByDate || {},
            unavailableDates: Array.isArray(data?.unavailableDates) ? data.unavailableDates : [],
          };
          APPOINTMENT_AVAILABILITY_CACHE.set(key, { data: normalizedData, fetchedAt: Date.now() });
          console.log('[Appointment] Background cached', monthKey, '→', normalizedData.unavailableDates.length, 'unavailable');
        } catch (err) {
          console.warn('[Appointment] Background fetch failed for', monthKey, err && err.message);
        }
      }
    } catch (err) {
      console.error('[Appointment] Background scraper error:', err && err.message);
    }
  };

  // Run immediately, then on interval
  run();
  setInterval(run, intervalMinutes * 60 * 1000);
};

// Start background scraper on module load
try {
  startAppointmentBackgroundScraper(10, 2);
} catch (err) {
  console.warn('[Appointment] Failed to start background scraper:', err && err.message);
}

const filterEventsForDate = (date, events) => {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  return events.filter((event) => {
    const eventStart = new Date(event.start?.dateTime || event.start?.date);
    const eventEnd = new Date(event.end?.dateTime || event.end?.date);

    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) {
      return false;
    }

    return eventStart <= dayEnd && eventEnd >= dayStart;
  });
};

const parseIcsDate = (value) => {
  if (!value) return null;
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const hour = value.slice(9, 11);
    const minute = value.slice(11, 13);
    const second = value.slice(13, 15);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const hour = value.slice(9, 11);
    const minute = value.slice(11, 13);
    const second = value.slice(13, 15);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  }

  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return new Date(`${year}-${month}-${day}T00:00:00`);
  }

  return null;
};

const parseIcsEvents = (icsText) => {
  const unfoldedText = icsText.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfoldedText.split('\n');
  const events = [];
  let event = null;

  lines.forEach((line) => {
    if (line.startsWith('BEGIN:VEVENT')) {
      event = {};
      return;
    }

    if (line.startsWith('END:VEVENT')) {
      if (event?.start && event?.end) {
        events.push({
          start: event.start,
          end: event.end,
        });
      }
      event = null;
      return;
    }

    if (!event) return;

    const [rawKey, rawValue] = line.split(':');
    if (!rawKey || !rawValue) return;

    const key = rawKey.split(';')[0];
    if (key === 'DTSTART') {
      const date = parseIcsDate(rawValue.trim());
      if (date) {
        if (/^\d{8}$/.test(rawValue.trim())) {
          event.start = { date: date.toISOString().slice(0, 10) };
        } else {
          event.start = { dateTime: date.toISOString() };
        }
      }
    }

    if (key === 'DTEND') {
      const date = parseIcsDate(rawValue.trim());
      if (date) {
        if (/^\d{8}$/.test(rawValue.trim())) {
          event.end = { date: date.toISOString().slice(0, 10) };
        } else {
          event.end = { dateTime: date.toISOString() };
        }
      }
    }

    if (key === 'UID') {
      event.uid = rawValue.trim();
    }
  });

  return events;
};

const syncCalendarEventsAndBlockDeleted = async (currentEvents) => {
  try {
    // Get all currently cached events
    const cachedStmt = db.prepare('SELECT event_uid, event_date, start_time, end_time FROM calendar_events_cache');
    const cachedEvents = await cachedStmt.all();

    // Build a set of current event UIDs for quick lookup
    const currentEventUids = new Set(currentEvents.filter((e) => e.uid).map((e) => e.uid));

    // Check for deleted events (were cached, but not in current events)
    for (const cached of cachedEvents) {
      if (cached.event_uid && !currentEventUids.has(cached.event_uid)) {
        // This event was deleted from Google Calendar
        // Auto-block this time slot
        const reason = 'Auto-blocked: removed from Google Calendar';

        const checkStmt = db.prepare('SELECT id FROM blocked_dates WHERE date = ?');
        const existing = await checkStmt.get(cached.event_date);

        if (!existing) {
          const insertStmt = db.prepare(
            'INSERT INTO blocked_dates (date, start_time, end_time, reason) VALUES (?, ?, ?, ?)',
          );
          await insertStmt.run(cached.event_date, cached.start_time, cached.end_time, reason);
        }

        // Remove from cache
        const deleteStmt = db.prepare('DELETE FROM calendar_events_cache WHERE event_uid = ?');
        await deleteStmt.run(cached.event_uid);
      }
    }

    // Update cache with current events
    for (const event of currentEvents) {
      if (!event.uid) continue;

      const eventRange = getLocalEventRange(event);
      if (!eventRange) continue;

      const eventDate = eventRange.startDate;
      const startTime = eventRange.fullDay ? null : toTimeString(eventRange.startMinutes);
      const endTime = eventRange.fullDay ? null : toTimeString(eventRange.endMinutes);

      // Delete old entry if it exists
      const deleteStmt = db.prepare('DELETE FROM calendar_events_cache WHERE event_uid = ?');
      await deleteStmt.run(event.uid);

      // Insert new entry
      const insertStmt = db.prepare(
        `INSERT INTO calendar_events_cache (event_uid, event_date, start_time, end_time, last_seen)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      );
      await insertStmt.run(event.uid, eventDate, startTime, endTime);
    }
  } catch (error) {
    console.error('Calendar sync error:', error.message);
  }
};

// Pricing
const PRICING = {
  package1: 50,
  package2: 100,
  djm_v10_addon: 15,
};

const parseDurationHours = (start_time, end_time) => {
  if (!start_time || !end_time) return null;

  const [startHour, startMin] = start_time.split(':').map(Number);
  const [endHour, endMin] = end_time.split(':').map(Number);

  if (
    Number.isNaN(startHour) ||
    Number.isNaN(startMin) ||
    Number.isNaN(endHour) ||
    Number.isNaN(endMin)
  ) {
    return null;
  }

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  if (endMinutes <= startMinutes) return null;

  return (endMinutes - startMinutes) / 60;
};

const isSlotAvailableForBooking = async (booking_date, start_time, end_time) => {
  const blockedStmt = db.prepare('SELECT date, start_time, end_time FROM blocked_dates WHERE date = ? UNION ALL SELECT date, start_time, end_time FROM blocked_date_segments WHERE date = ?');
  const blockedRows = await blockedStmt.all(booking_date, booking_date);

  const existingBookingsStmt = db.prepare('SELECT start_time, end_time FROM bookings WHERE booking_date = ? AND status != ?');
  const existingBookings = await existingBookingsStmt.all(booking_date, 'cancelled');

  const dayStartIso = new Date(`${booking_date}T00:00:00`).toISOString();
  const dayEndIso = new Date(`${booking_date}T23:59:59`).toISOString();
  const googleEvents = await fetchGoogleCalendarEvents(dayStartIso, dayEndIso);
  const calendarEvents = filterEventsForDate(booking_date, googleEvents);

  const appointmentAvailability = GOOGLE_APPOINTMENT_URL
    ? await getCachedAppointmentAvailability(booking_date.slice(0, 7))
    : { slotsByDate: {}, unavailableDates: [] };

  if (appointmentAvailability.unavailableDates.includes(booking_date)) {
    return false;
  }

  // Check if this date is configured to ignore Google Calendar events
  const ignoreStmt = db.prepare('SELECT date FROM calendar_ignores WHERE date = ?');
  const ignoreRows = await ignoreStmt.all(booking_date);
  const finalCalendarEvents = ignoreRows.length ? [] : calendarEvents;

  const availability = await listDateAvailability(booking_date, blockedRows, existingBookings, finalCalendarEvents);
  const appointmentSlots = appointmentAvailability.slotsByDate[booking_date] || null;
  if (appointmentSlots) {
    return appointmentSlots.includes(start_time);
  }
  return availability.slots.includes(start_time);
};

// Authentication Routes

// User Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Insert user
    const stmt = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');
    const result = await stmt.run(username, email, hashedPassword);

    // Create JWT token
    const token = jwt.sign({ userId: result.lastInsertRowid, username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, username });
  } catch (error) {
    console.error('Signup error:', error.message);
    if (error.message.includes('UNIQUE constraint failed') || error.message.includes('unique constraint')) {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const identifier = (username || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find user by username or email
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
    const user = await stmt.get(identifier, identifier);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username, email or password' });
    }

    // Check password
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username, email or password' });
    }

    // Create JWT token
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Forgot password
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user by email
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    const user = await stmt.get(email);

    if (!user) {
      // Don't reveal if email exists for security
      return res.json({ message: 'If an account exists with this email, a reset link has been sent.' });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    
    // Send reset email
    const resetLink = `${FRONTEND_URL}/?reset=${resetToken}`;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset - AllFriends AV',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #000;">
            <h2 style="margin: 0; color: #000;">AllFriends AV</h2>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">DJ Practice Sessions</p>
          </div>
          
          <div style="padding: 30px 20px;">
            <h2 style="color: #000; margin-top: 0;">Password Reset Request</h2>
            <p>Hi ${user.username},</p>
            <p>We received a request to reset your password. Click the link below to create a new password:</p>
            
            <p style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #000; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Reset Password
              </a>
            </p>
            
            <p style="color: #666; font-size: 12px;">
              This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.
            </p>
            
            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
              AllFriends AV<br>
              DJ Practice Sessions
            </p>
          </div>
        </div>
      `,
    };

    let resetResponse = { message: 'If an account exists with this email, a reset link has been sent.' };
    const debugMode = !isProd || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD;

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('Error sending reset email:', err.message);
        if (debugMode) {
          resetResponse.debugResetLink = resetLink;
        }
      } else {
        console.log('Password reset email sent to:', email);
        if (debugMode) {
          resetResponse.debugResetLink = resetLink;
        }
      }
    });

    res.json(resetResponse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
  try {
    const { resetToken, password } = req.body;

    if (!resetToken || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the reset token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired reset link' });
    }

    // Hash the new password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Update the user's password
    const stmt = db.prepare('UPDATE users SET password = ? WHERE id = ?');
    await stmt.run(hashedPassword, decoded.userId);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Routes

// Get all bookings
app.get('/api/bookings', verifyAdminToken, async (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM bookings ORDER BY booking_date DESC');
    const rows = await stmt.all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bookings by email
app.get('/api/bookings/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const stmt = db.prepare('SELECT * FROM bookings WHERE user_email = ? ORDER BY booking_date DESC');
    const rows = await stmt.all(email);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  const {
    user_name,
    user_email,
    user_phone,
    booking_date,
    start_time,
    end_time,
    package_type,
    cdj_count,
    mixer_type,
    djm_v10_addon,
    notes,
  } = req.body;

  // Validate required fields
  if (!user_name || !user_email || !user_phone || !booking_date || !start_time || !end_time || !package_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // Enforce maximum booking window (configurable from settings)
  const parseDateOnly = (s) => {
    try {
      const d = new Date(`${s}T00:00:00`);
      if (Number.isNaN(d.getTime())) return null;
      d.setHours(0,0,0,0);
      return d;
    } catch (e) {
      return null;
    }
  };

  const bookingDateObj = parseDateOnly(booking_date);
  if (!bookingDateObj) {
    return res.status(400).json({ error: 'Invalid booking_date' });
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const maxBookingDays = await getSetting('max_booking_days', 30);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + maxBookingDays);

  if (bookingDateObj < today) {
    return res.status(400).json({ error: 'Cannot book past dates' });
  }

  if (bookingDateObj > maxDate) {
    return res.status(400).json({ error: `Bookings can only be made up to ${maxBookingDays} days in advance` });
  }

  if (!PRICING[package_type]) {
    return res.status(400).json({ error: 'Invalid package type' });
  }

  const durationHours = parseDurationHours(start_time, end_time);
  if (durationHours === null) {
    return res.status(400).json({ error: 'Invalid booking time range' });
  }

  if (durationHours < 2) {
    return res.status(400).json({ error: 'Minimum booking is 2 hours' });
  }

      const bookingStart = toMinutes(start_time);
      const bookingEnd = toMinutes(end_time);
      if (bookingStart === null || bookingEnd === null) {
        return res.status(400).json({ error: 'Invalid booking times' });
      }

      if (bookingEnd <= bookingStart) {
        return res.status(400).json({ error: 'End time must be later than start time' });
      }

      const bookingDay = new Date(booking_date).getDay();
      const operatingHours = OPERATING_HOURS[bookingDay];
      if (!operatingHours) {
        return res.status(400).json({ error: 'This date is not available for booking' });
      }

      const openMinutes = operatingHours.open * 60;
      const closeMinutes = operatingHours.close * 60;
      if (bookingStart < openMinutes || bookingEnd > closeMinutes) {
        return res.status(400).json({ error: `Operating hours are ${operatingHours.open}:00 - ${operatingHours.close}:00` });
      }

      try {
        const blockedStmt = db.prepare('SELECT date, start_time, end_time FROM blocked_dates WHERE date = ? UNION ALL SELECT date, start_time, end_time FROM blocked_date_segments WHERE date = ?');
        const blockedRows = await blockedStmt.all(booking_date, booking_date);
        for (const blocked of blockedRows) {
          if (!blocked.start_time || !blocked.end_time) {
            return res.status(400).json({ error: 'This date has been blocked and is not available for booking' });
          }
          const blockedStart = toMinutes(blocked.start_time);
          const blockedEnd = toMinutes(blocked.end_time);
          if (blockedStart !== null && blockedEnd !== null && overlap(bookingStart, bookingEnd, blockedStart, blockedEnd)) {
            return res.status(400).json({ error: 'This booking overlaps a blocked time range' });
          }
        }
        const slotOk = await isSlotAvailableForBooking(booking_date, start_time, end_time);
        if (!slotOk) {
          return res.status(400).json({ error: 'Selected start time is not available on this date' });
        }

        const existingBookingsStmt = db.prepare('SELECT start_time, end_time FROM bookings WHERE booking_date = ? AND status != ?');
        const existingBookings = await existingBookingsStmt.all(booking_date, 'cancelled');
        for (const existing of existingBookings) {
          const existingStart = toMinutes(existing.start_time);
          const existingEnd = toMinutes(existing.end_time);
          if (existingStart !== null && existingEnd !== null && overlap(bookingStart, bookingEnd, existingStart, existingEnd)) {
            return res.status(400).json({ error: 'This booking overlaps an existing booking' });
          }
        }

        const dayStartIso = new Date(`${booking_date}T00:00:00`).toISOString();
        const dayEndIso = new Date(`${booking_date}T23:59:59`).toISOString();
        const googleEvents = await fetchGoogleCalendarEvents(dayStartIso, dayEndIso);
        const calendarEvents = filterEventsForDate(booking_date, googleEvents);

        // If this date is configured to ignore Google Calendar, skip overlap checks
        const ignoreStmt2 = db.prepare('SELECT date FROM calendar_ignores WHERE date = ?');
        const ignoreRows2 = await ignoreStmt2.all(booking_date);
        if (ignoreRows2.length === 0) {
          for (const event of calendarEvents) {
            const eventRange = getEventRangeForDate(booking_date, event);
            if (eventRange && overlap(bookingStart, bookingEnd, eventRange.start, eventRange.end)) {
              return res.status(400).json({ error: 'This booking overlaps a busy Google Calendar event' });
            }
          }
        }
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }

  const djmAddon = Boolean(djm_v10_addon);
  const total_price = PRICING[package_type] * durationHours + (djmAddon ? PRICING.djm_v10_addon * durationHours : 0);
  const duration_hours = Number(durationHours.toFixed(2));
  const djm_v10 = djmAddon ? 1 : 0;
  const booking_username = req.body.booking_username || req.body.username || user_name;

  try {
    const stmt = db.prepare(`
      INSERT INTO bookings (
        user_name, user_email, user_phone, booking_date, start_time, end_time,
        duration_hours, package_type, cdj_count, mixer_type, djm_v10_addon, notes, total_price, booking_username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = await stmt.run(
      user_name,
      user_email,
      user_phone,
      booking_date,
      start_time,
      end_time,
      duration_hours,
      package_type,
      cdj_count,
      mixer_type,
      djm_v10,
      notes,
      total_price,
      booking_username
    );

    // Send confirmation email to user
    const userMailOptions = {
      from: process.env.EMAIL_USER,
      to: user_email,
      subject: 'Booking Confirmation - AllFriends AV DJ Practice Sessions',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #000;">
            <img src="https://localhost:5000/logo.webp" alt="AllFriends AV Logo" style="height: 50px; margin-bottom: 10px;">
            <h2 style="margin: 0; color: #000;">AllFriends AV</h2>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">DJ Practice Sessions</p>
          </div>
          
          <div style="padding: 30px 20px;">
            <h2 style="color: #000; margin-top: 0;">Booking Confirmation</h2>
            <p>Hi ${user_name},</p>
            <p>Thank you for booking with AllFriends AV! Your DJ practice session has been received.</p>
            
            <p style="font-weight: bold; color: #000;">Booking Details:</p>
            <ul style="color: #333;">
              <li>Date: ${booking_date}</li>
              <li>Time: ${start_time} - ${end_time}</li>
              <li>Duration: ${duration_hours} hours</li>
              <li>Package: ${package_type === 'package1' ? 'Standard ($50/hr)' : 'Premium ($100/hr)'}</li>
              <li>Total Price: $${total_price}</li>
            </ul>
            
            <p style="font-weight: bold; color: #000;">Next Steps:</p>
            <p>We will confirm your booking and send you an invoice shortly. Please keep an eye on your inbox for further details.</p>
            <p>If you have any questions, feel free to reach out to us.</p>
            
            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
              Thank you for choosing AllFriends AV!<br>
              <strong>AllFriends AV</strong><br>
              DJ Practice Sessions
            </p>
          </div>
        </div>
      `,
    };

    transporter.sendMail(userMailOptions, (err, info) => {
      if (err) {
        console.error('Error sending user email:', err.message);
      } else {
        console.log('User confirmation email sent to:', user_email);
      }
    });

    // Send notification to admins
    const adminMailOptions = {
      from: process.env.EMAIL_USER,
      to: ADMIN_EMAILS.join(','),
      subject: 'New Booking - AllFriends AV DJ Practice Sessions',
      html: `
        <h2>New Booking Received</h2>
        <p><strong>Customer Details:</strong></p>
        <ul>
          <li>Name: ${user_name}</li>
          <li>Email: ${user_email}</li>
          <li>Phone: ${user_phone}</li>
        </ul>
        <p><strong>Booking Details:</strong></p>
        <ul>
          <li>Date: ${booking_date}</li>
          <li>Time: ${start_time} - ${end_time}</li>
          <li>Duration: ${duration_hours} hours</li>
          <li>Package: ${package_type === 'package1' ? 'Standard ($50/hr)' : 'Premium ($100/hr)'}</li>
          <li>Total Price: $${total_price}</li>
          <li>Notes: ${notes || 'None'}</li>
        </ul>
        <p><a href="${FRONTEND_URL}">View in Admin Dashboard</a></p>
      `,
    };

    transporter.sendMail(adminMailOptions, (err, info) => {
      if (err) {
        console.error('Error sending admin email:', err.message);
      } else {
        console.log('Admin notification email sent to:', ADMIN_EMAILS.join(', '));
      }
    });

    res.status(201).json({ id: result.lastInsertRowid, total_price });
  } catch (error) {
    console.error('Booking error:', error.message);
    if (error.message.includes('NOT NULL constraint failed') || error.message.includes('null value in column')) {
      res.status(400).json({ error: 'Booking could not be saved. Please check all fields and try again.' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Update booking status
app.put('/api/bookings/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const stmt = db.prepare('UPDATE bookings SET status = ? WHERE id = ?');
    await stmt.run(status, id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get blocked dates
app.get('/api/blocked-dates', async (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, date, reason, start_time, end_time, created_at, 'blocked' AS source
      FROM blocked_dates
      UNION ALL
      SELECT id, date, reason, start_time, end_time, created_at, 'segment' AS source
      FROM blocked_date_segments
      ORDER BY date
    `);
    const rows = await stmt.all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk import blocked dates/segments
app.post('/api/blocked-dates/bulk', verifyAdminToken, async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected an array of blocked date items' });

    const inserted = [];
    for (const it of items) {
      const { date, reason, start_time, end_time } = it;
      if (!date) continue;
      if ((start_time && !end_time) || (!start_time && end_time)) continue;

      if (!start_time && !end_time) {
        const stmt = db.prepare('INSERT INTO blocked_dates (date, reason, start_time, end_time) VALUES (?, ?, ?, ?)');
        const result = await stmt.run(date, reason || null, null, null);
        inserted.push({ id: result.lastInsertRowid || result.lastInsertId || null, date, type: 'blocked' });
      } else {
        const stmt = db.prepare('INSERT INTO blocked_date_segments (date, reason, start_time, end_time) VALUES (?, ?, ?, ?)');
        const result = await stmt.run(date, reason || null, start_time, end_time);
        inserted.push({ id: result.lastInsertRowid || result.lastInsertId || null, date, type: 'segment' });
      }
    }

    res.status(201).json({ inserted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/availability', async (req, res) => {
  try {
    const { month } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month query is required in YYYY-MM format' });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;

    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);

    const startDate = `${yearStr}-${monthStr}-01`;
    const endDate = `${yearStr}-${monthStr}-${String(lastDay.getDate()).padStart(2, '0')}`;

    const blockedStmt = db.prepare('SELECT date, start_time, end_time FROM blocked_dates WHERE date >= ? AND date <= ? UNION ALL SELECT date, start_time, end_time FROM blocked_date_segments WHERE date >= ? AND date <= ?');
    const blockedRows = await blockedStmt.all(startDate, endDate, startDate, endDate);

    const bookingsStmt = db.prepare('SELECT booking_date, start_time, end_time, status FROM bookings WHERE booking_date >= ? AND booking_date <= ?');
    const bookingRows = await bookingsStmt.all(startDate, endDate);

    const activeBookingRows = bookingRows.filter((row) => row.status !== 'cancelled');
    const dayStartIso = new Date(year, monthIndex, 1, 0, 0, 0).toISOString();
    const dayEndIso = new Date(year, monthIndex + 1, 0, 23, 59, 59).toISOString();
    const googleEvents = await fetchGoogleCalendarEvents(dayStartIso, dayEndIso);
    // Support per-request override of the Google appointment URL for testing
    OVERRIDE_GOOGLE_APPOINTMENT_URL = (req && req.query && req.query.googleAppointmentUrl) ? req.query.googleAppointmentUrl : null;
    const appointmentAvailability = await getCachedAppointmentAvailability(month, OVERRIDE_GOOGLE_APPOINTMENT_URL);

    // Sync calendar events and auto-block deleted availability slots
    await syncCalendarEventsAndBlockDeleted(googleEvents);

    // Re-fetch blocked dates after sync
    const blockedStmtAfterSync = db.prepare('SELECT date, start_time, end_time, reason FROM blocked_dates WHERE date >= ? AND date <= ? UNION ALL SELECT date, start_time, end_time, reason FROM blocked_date_segments WHERE date >= ? AND date <= ?');
    const blockedRowsAfterSync = await blockedStmtAfterSync.all(startDate, endDate, startDate, endDate);

    // Fetch any calendar ignore rules (dates where Google Calendar should be ignored)
    const ignoreStmt = db.prepare('SELECT date FROM calendar_ignores WHERE date >= ? AND date <= ?');
    const ignoreRows = await ignoreStmt.all(startDate, endDate);
    const ignoreSet = new Set(ignoreRows.map((r) => r.date));

    const fullDayBlockedDates = [];
    const partialBlockedSegments = [];
    for (const row of blockedRowsAfterSync) {
      if (!row.start_time && !row.end_time) {
        fullDayBlockedDates.push(row.date);
      } else if (row.start_time && row.end_time) {
        partialBlockedSegments.push({
          date: row.date,
          start_time: row.start_time,
          end_time: row.end_time,
          reason: row.reason || null,
        });
      }
    }

    const unavailableDates = [];
    const slotsByDate = {};
    const appointmentUnavailableSet = new Set(appointmentAvailability.unavailableDates || []);
    const appointmentSlotsByDate = appointmentAvailability.slotsByDate || {};

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
      const dayBookings = activeBookingRows.filter((row) => row.booking_date === date);
      const dayEvents = ignoreSet.has(date) ? [] : filterEventsForDate(date, googleEvents);
      const availability = await listDateAvailability(date, blockedRowsAfterSync, dayBookings, dayEvents);

      let finalSlots = availability.slots;
      if (appointmentSlotsByDate[date]) {
        finalSlots = availability.slots.filter((slot) => appointmentSlotsByDate[date].includes(slot));
      }
      if (appointmentUnavailableSet.has(date)) {
        finalSlots = [];
      }
      const finalIsUnavailable = appointmentUnavailableSet.has(date) || finalSlots.length === 0;

      slotsByDate[date] = finalSlots;
      if (finalIsUnavailable) {
        unavailableDates.push(date);
      }
    }

    // clear override after processing
    OVERRIDE_GOOGLE_APPOINTMENT_URL = null;

    return res.json({
      month,
      unavailableDates,
      slotsByDate,
      fullDayBlockedDates,
      partialBlockedSegments,
      appointmentUnavailableDates: appointmentAvailability.unavailableDates || [],
      appointmentSlotsByDate: appointmentAvailability.slotsByDate || {},
      source: {
        googleCalendarLinked: Boolean((GOOGLE_CALENDAR_ID && (GOOGLE_API_KEY || GOOGLE_SERVICE_ACCOUNT_JSON)) || GOOGLE_CALENDAR_ICS_URL || GOOGLE_APPOINTMENT_URL),
        authMode: GOOGLE_SERVICE_ACCOUNT_JSON
          ? 'adc_service_account'
          : GOOGLE_API_KEY
          ? 'api_key'
          : GOOGLE_CALENDAR_ICS_URL && GOOGLE_APPOINTMENT_URL
          ? 'ics_url_and_appointment_page'
          : GOOGLE_CALENDAR_ICS_URL
          ? 'ics_url'
          : GOOGLE_APPOINTMENT_URL
          ? 'appointment_page'
          : 'none',
        appointmentUrl: Boolean(GOOGLE_APPOINTMENT_URL),
      },
    });
  } catch (error) {
    OVERRIDE_GOOGLE_APPOINTMENT_URL = null;
    return res.status(500).json({ error: error.message });
  }
});

// Add blocked date
app.post('/api/blocked-dates', verifyAdminToken, async (req, res) => {
  try {
    const { date, reason, start_time, end_time } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    if ((start_time && !end_time) || (!start_time && end_time)) {
      return res.status(400).json({ error: 'Both start_time and end_time are required for partial-day blocks' });
    }

    if (start_time && end_time) {
      const start = toMinutes(start_time);
      const end = toMinutes(end_time);
      if (start === null || end === null || start >= end) {
        return res.status(400).json({ error: 'Invalid start_time or end_time' });
      }
    }

    const stmt = db.prepare('INSERT INTO blocked_dates (date, reason, start_time, end_time) VALUES (?, ?, ?, ?)');
    const result = await stmt.run(date, reason || null, start_time || null, end_time || null);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete blocked date
app.delete('/api/blocked-dates/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Try delete from primary blocked_dates
    const deleteStmt = db.prepare('DELETE FROM blocked_dates WHERE id = ?');
    const result = await deleteStmt.run(id);

    // If no row deleted, try blocked_date_segments
    if (!result.changes || result.changes === 0) {
      const delSeg = db.prepare('DELETE FROM blocked_date_segments WHERE id = ?');
      await delSeg.run(id);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add calendar ignore (ignore Google Calendar events for a specific date)
// Basic admin auth middleware (uses ADMIN_PASSWORD env var)

const getAdminPassword = () => {
  const envPass = process.env.ADMIN_PASSWORD;
  if (envPass) return envPass;
  if (isProd) {
    console.warn('Warning: ADMIN_PASSWORD not set in production; using default password. Set ADMIN_PASSWORD to secure admin endpoints.');
  }
  return 'admin123';
};

const basicAuthMiddleware = (req, res, next) => {
  const adminPass = getAdminPassword();
  if (!adminPass) return res.status(500).json({ error: 'Admin password not configured' });

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  if (user !== 'admin' || pass !== adminPass) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

// Add calendar ignore (ignore Google Calendar events for a specific date)
app.post('/api/calendar-ignore', basicAuthMiddleware, async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Date is required' });

    const stmt = db.prepare('INSERT INTO calendar_ignores (date, reason) VALUES (?, ?)');
    const result = await stmt.run(date, reason || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove calendar ignore for a date
app.delete('/api/calendar-ignore/:date', basicAuthMiddleware, async (req, res) => {
  try {
    const { date } = req.params;
    const del = db.prepare('DELETE FROM calendar_ignores WHERE date = ?');
    await del.run(date);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List calendar ignores
app.get('/api/calendar-ignores', basicAuthMiddleware, async (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, date, reason, created_at FROM calendar_ignores ORDER BY date');
    const rows = await stmt.all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve admin UI without Basic Auth so the login page can be used
// (Handled earlier by simple middleware to avoid path-to-regexp parsing)

app.put('/api/blocked-dates/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, start_time, end_time, reason } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    // Try update in blocked_dates first
    const checkStmt = db.prepare('SELECT id FROM blocked_dates WHERE id = ?');
    const exists = await checkStmt.get(id);
    if (exists) {
      const stmt = db.prepare(
        'UPDATE blocked_dates SET date = ?, start_time = ?, end_time = ?, reason = ? WHERE id = ?',
      );
      await stmt.run(date, start_time || null, end_time || null, reason || null, id);
    } else {
      const stmt = db.prepare(
        'UPDATE blocked_date_segments SET date = ?, start_time = ?, end_time = ?, reason = ? WHERE id = ?',
      );
      await stmt.run(date, start_time || null, end_time || null, reason || null, id);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// (debug endpoints removed)

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = getAdminPassword();

  if (password === adminPassword) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Get operating hours
app.get('/api/operating-hours', (req, res) => {
  res.json(OPERATING_HOURS);
});

// Get pricing
app.get('/api/pricing', (req, res) => {
  res.json(PRICING);
});

// Get settings
app.get('/api/settings', async (req, res) => {
  try {
    const maxBookingDays = await getSetting('max_booking_days', 30);
    res.json({ max_booking_days: maxBookingDays });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings (admin only)
app.put('/api/settings', verifyAdminToken, async (req, res) => {
  try {
    const { max_booking_days } = req.body;

    if (max_booking_days !== undefined) {
      if (typeof max_booking_days !== 'number' || max_booking_days < 1 || max_booking_days > 365) {
        return res.status(400).json({ error: 'max_booking_days must be a number between 1 and 365' });
      }
      await setSetting('max_booking_days', max_booking_days);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Get user bookings by username
app.get('/api/bookings/user/:username', verifyToken, async (req, res) => {
  try {
    const { username } = req.params;

    // Verify that the user is requesting their own bookings
    if (req.user.username !== username) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const stmt = db.prepare(
      'SELECT * FROM bookings WHERE booking_username = ? OR user_name = ? ORDER BY booking_date DESC'
    );
    const rows = await stmt.all(username, username);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user info by username
app.get('/api/user/info/:username', verifyToken, async (req, res) => {
  try {
    const { username } = req.params;

    // Verify that the user is requesting their own info
    if (req.user.username !== username) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const stmt = db.prepare('SELECT username, email FROM users WHERE username = ?');
    const user = await stmt.get(username);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user info by username
app.put('/api/user/update/:username', verifyToken, async (req, res) => {
  try {
    const { username } = req.params;
    const { email } = req.body;

    // Verify that the user is updating their own info
    if (req.user.username !== username) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const stmt = db.prepare('UPDATE users SET email = ? WHERE username = ?');
    await stmt.run(email, username);

    res.json({ message: 'Profile updated successfully', username, email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Diagnostic endpoint for deployments: confirm which availability sources are configured.
app.get('/api/availability-source', (req, res) => {
  res.json({
    appointmentUrlConfigured: Boolean(process.env.GOOGLE_APPOINTMENT_URL),
    appointmentUrlEffective: Boolean(GOOGLE_APPOINTMENT_URL),
    appointmentUrlSource: process.env.GOOGLE_APPOINTMENT_URL ? 'env' : 'fallback',
    appointmentUrl: GOOGLE_APPOINTMENT_URL,
    icsUrlConfigured: Boolean(GOOGLE_CALENDAR_ICS_URL),
    primaryAvailabilitySource: PRIMARY_AVAILABILITY_SOURCE,
    authMode: GOOGLE_SERVICE_ACCOUNT_JSON
      ? 'adc_service_account'
      : GOOGLE_API_KEY
      ? 'api_key'
      : GOOGLE_CALENDAR_ICS_URL && GOOGLE_APPOINTMENT_URL
      ? 'ics_url_and_appointment_page'
      : GOOGLE_CALENDAR_ICS_URL
      ? 'ics_url'
      : GOOGLE_APPOINTMENT_URL
      ? 'appointment_page'
      : 'none',
  });
});

// Start server
initializeDatabase().then(() => {
  // start periodic calendar polling (keeps Google edits synced automatically)
  startCalendarPolling(5);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}).catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
