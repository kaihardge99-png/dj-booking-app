const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
const usePostgres = Boolean(process.env.DATABASE_URL);

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
app.use(express.static('public'));

const createSqliteDb = () => {
  const sqlite = new Database('./bookings.db');
  sqlite.pragma('journal_mode = WAL');

  return {
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
    exec: async (sql) => {
      await pool.query(sql);
    },
    prepare,
  };
};

const db = usePostgres ? createPostgresDb() : createSqliteDb();

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
];

const initializeDatabase = async () => {
  if (usePostgres) {
    for (const statement of postgresSchemaStatements) {
      await db.exec(statement);
    }
  } else {
    await db.exec(sqliteSchema);
  }
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

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find user
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    const user = await stmt.get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Check password
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
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

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('Error sending reset email:', err.message);
      } else {
        console.log('Password reset email sent to:', email);
      }
    });

    res.json({ message: 'If an account exists with this email, a reset link has been sent.' });
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
app.get('/api/bookings', async (req, res) => {
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

  const djmAddon = Boolean(djm_v10_addon);
  const total_price = PRICING[package_type] * durationHours + (djmAddon ? PRICING.djm_v10_addon * durationHours : 0);
  const duration_hours = Number(durationHours.toFixed(2));
  const djm_v10 = djmAddon ? 1 : 0;

  try {
    const stmt = db.prepare(`
      INSERT INTO bookings (
        user_name, user_email, user_phone, booking_date, start_time, end_time,
        duration_hours, package_type, cdj_count, mixer_type, djm_v10_addon, notes, total_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      total_price
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
app.put('/api/bookings/:id', async (req, res) => {
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
    const stmt = db.prepare('SELECT * FROM blocked_dates ORDER BY date');
    const rows = await stmt.all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add blocked date
app.post('/api/blocked-dates', async (req, res) => {
  try {
    const { date, reason } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const stmt = db.prepare('INSERT INTO blocked_dates (date, reason) VALUES (?, ?)');
    const result = await stmt.run(date, reason);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete blocked date
app.delete('/api/blocked-dates/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const stmt = db.prepare('DELETE FROM blocked_dates WHERE id = ?');
    await stmt.run(id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (password === 'admin123') {
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

// Middleware to verify JWT token
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

// Get user bookings by username
app.get('/api/bookings/user/:username', verifyToken, async (req, res) => {
  try {
    const { username } = req.params;

    // Verify that the user is requesting their own bookings
    if (req.user.username !== username) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const stmt = db.prepare('SELECT * FROM bookings WHERE user_name = ? ORDER BY booking_date DESC');
    const rows = await stmt.all(username);
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

// Start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
