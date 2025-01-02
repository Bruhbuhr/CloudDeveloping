import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import express from 'express';
import bodyParser from 'body-parser';
const { json } = bodyParser; 
import pg from 'pg';
const { Pool } = pg;
import Redis from 'ioredis';
import { hash, compare } from 'bcrypt';
import validator from 'validator';
const { isEmail } = validator;
import otpGenerator from 'otp-generator';
import jwt from 'jsonwebtoken';
import session from 'express-session';

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

// --- Redis configuration (using ioredis) ---
const redisClient = new Redis({ 
    host: process.env.REDIS_HOST,
    port: 6379,
});

redisClient.on('connect', () => console.log('Connected to Redis'));
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Middleware
app.use(json());

// --- Helper Functions ---

// Function to generate OTP
function generateOtp() {
    return otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        specialChars: false,
    });
}

// Function to generate JWT 
function generateJwt(userId) {
    const secretKey = process.env.JWT_SECRET || 'your_jwt_secret';
    const token = jwt.sign({ userId }, secretKey, { expiresIn: '1h' }); 
    return token;
}

// --- Session Middleware ---
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
                    if (value) {
                        callback(null, JSON.parse(value));
                    } else {
                        callback(null, null);
                    }
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

// --- API Routes ---

// /register route
app.post('/register', async (req, res) => {
    const { email, username, password } = req.body;

    try {
        // 1. Validate inputs
        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!isEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // 2. Hash the password
        const saltRounds = 10;
        const hashedPassword = await hash(password, saltRounds);

        // 3. Save user data to PostgreSQL
        const result = await pool.query(
            'INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING *',
            [email, username, hashedPassword]
        );

        res.status(201).json({ message: 'Account created successfully' });
    } catch (error) {
        console.error(error);
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Email or username already exists' });
        }
        res.status(500).json({ error: 'Failed to create account' });
    }
});

// /login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Verify email and password
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const passwordMatch = await compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 2. Generate OTP code
        const otp = generateOtp();

        // 3. Store OTP in Redis with expiration
        await redisClient.set(email, otp, 'EX', 300);

        // *** Set session data ***
        req.session.userId = user.id; 
        req.session.otpVerified = false;

        // *** Save the session before sending the response ***
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session:', err);
                return res.status(500).json({ error: 'Login failed' });
            }

            // *** Send the session ID as a cookie in the response ***
            res.cookie('connect.sid', req.sessionID, {
                httpOnly: true,
                secure: false, // Set to true if using HTTPS
                maxAge: 300000, // 5 minutes
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
        // 1. Get user ID from session
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }
        const userId = req.session.userId;

        // 2. Get user's email from the database
        const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        const email = result.rows[0].email;

        // 3. Get OTP from Redis
        const storedOtp = await redisClient.get(email);

        // 4. Validate OTP
        if (!storedOtp || storedOtp !== otp) {
            return res.status(401).json({ error: 'Invalid or expired OTP code' });
        }

        // 5. Mark OTP as verified in the session
        req.session.otpVerified = true;

        // 6. Generate JWT
        const token = generateJwt(userId);

        res.json({ message: 'Verification successful', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.post('/buy-ticket', async (req, res) => {
    const { expiredDate } = req.body;
    const image = `https://source.unsplash.com/random/100x100/?ticket`; // Random image URL
    const qr_code = 'line.png'; // Placeholder QR code

    try {
        // 1. Get user ID from session
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }
        const userId = req.session.userId;

        // 2. Validate expiredDate
        const parsedExpiredDate = new Date(expiredDate);
        if (isNaN(parsedExpiredDate)) {
            return res.status(400).json({ error: 'Invalid expiredDate format' });
        }
        if (parsedExpiredDate <= new Date()) {
            return res.status(400).json({ error: 'expiredDate must be in the future' });
        }

        // 3. Create a new ticket in the database
        const ticketResult = await pool.query(
            'INSERT INTO tickets (user_id, expiredDate, image, qr_code) VALUES ($1, $2, $3, $4) RETURNING *',
            [userId, expiredDate, image, qr_code]
        );

        // 4. Send a success response
        res.status(201).json({
            message: 'Ticket purchased successfully',
            ticket: ticketResult.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to purchase ticket' });
    }
});

// --- End of API Routes ---

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});