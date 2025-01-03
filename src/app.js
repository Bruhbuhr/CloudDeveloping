const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');
const { json } = bodyParser;
const { Pool } = require('pg');
const Redis = require('ioredis');
const { hash, compare } = require('bcrypt');
const { isEmail } = require('validator');
const otpGenerator = require('otp-generator');
const session = require('express-session');

const app = express();
const port = 3000;

// PostgreSQL configuration
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: 5432,
    ssl: false
});

// Redis configuration
const redisClient = new Redis({ 
    host: process.env.REDIS_HOST,
    port: 6379,
});

redisClient.on('connect', () => console.log('Connected to Redis'));
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Middleware
app.use(json());

// Helper function to generate OTP
function generateOtp() {
    return otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        specialChars: false,
    });
}

// Session middleware using Redis store
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'your-session-secret',
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 300000,
        },
        store: new (class extends session.Store {
            constructor(options = {}) {
                super(options);
                this.redisClient = redisClient;
            }

            async get(key, callback) {
                try {
                    const value = await this.redisClient.get(key);
                    callback(null, value ? JSON.parse(value) : null);
                } catch (err) {
                    callback(err);
                }
            }

            async set(key, value, callback) {
                try {
                    await this.redisClient.set(key, JSON.stringify(value), 'EX', 300);
                    callback(null);
                } catch (err) {
                    callback(err);
                }
            }

            async destroy(key, callback) {
                try {
                    await this.redisClient.del(key);
                    callback(null);
                } catch (err) {
                    callback(err);
                }
            }
        })(),
    })
);

// API Routes

// /register route
app.post('/register', async (req, res) => {
    const { email, username, password } = req.body;

    try {
        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!isEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const saltRounds = 10;
        const hashedPassword = await hash(password, saltRounds);

        const result = await pool.query(
            'INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING *',
            [email, username, hashedPassword]
        );

        res.status(201).json({ message: 'Account created successfully' });
    } catch (error) {
        console.error(error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Email or username already exists' });
        }
        res.status(500).json({ error: 'Failed to create account' });
    }
});

// /login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const passwordMatch = await compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate OTP code
        const otp = generateOtp();

        // Store OTP in Redis, expires in 1 minute
        await redisClient.set(email, otp, 'EX', 60);

        // Save user data in session
        req.session.userId = user.id;
        req.session.otpVerified = false;

        req.session.save((err) => {
            if (err) {
                console.error('Error saving session:', err);
                return res.status(500).json({ error: 'Login failed' });
            }

            res.cookie('connect.sid', req.sessionID, {
                httpOnly: true,
                secure: false,  
                maxAge: 300000,
            });

            res.json({ otp, message: 'OTP code generated. Please verify.' });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// /verify route
app.post('/verify', async (req, res) => {
    const { otp } = req.body;

    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }
        const userId = req.session.userId;

        const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        const email = result.rows[0].email;

        // Get OTP from Redis
        const storedOtp = await redisClient.get(email);

        // Validate OTP
        if (!storedOtp || storedOtp !== otp) {
            return res.status(401).json({ error: 'Invalid or expired OTP code' });
        }

        // Mark OTP as verified in session
        req.session.otpVerified = true;

        res.json({ message: 'Verification successful' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// /buy-ticket route
app.post('/buy-ticket', async (req, res) => {
    const { expiredDate } = req.body;
    const image = `https://source.unsplash.com/random/100x100/?ticket`;
    const qr_code = 'line.png';

    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }
        const userId = req.session.userId;

        const parsedExpiredDate = new Date(expiredDate);
        if (isNaN(parsedExpiredDate)) {
            return res.status(400).json({ error: 'Invalid expiredDate format' });
        }
        if (parsedExpiredDate <= new Date()) {
            return res.status(400).json({ error: 'expiredDate must be in the future' });
        }

        const ticketResult = await pool.query(
            'INSERT INTO tickets (user_id, expiredDate, image, qr_code) VALUES ($1, $2, $3, $4) RETURNING *',
            [userId, expiredDate, image, qr_code]
        );

        res.status(201).json({
            message: 'Ticket purchased successfully',
            ticket: ticketResult.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to purchase ticket' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
