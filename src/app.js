const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');
const { json } = bodyParser;
const { Pool } = require('pg');
const Redis = require('ioredis');
const { hash, compare } = require('bcrypt');
const { isEmail } = require('validator');
const session = require('express-session');
const axios = require('axios');

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

// Helper function to generate OTP (6-digit numeric code)
function generateOtp() {
    const otp = Math.floor(100000 + Math.random() * 900000);
    return otp.toString();
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

// Check user subscription before proceeding
async function checkUserSubscription(email) {
    try {
        const apiUrl = `${process.env.API_GATEWAY_URL}/check-subscription`;
        const response = await axios.post(apiUrl, { email }, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        return response.data.subscribed;
    } catch (error) {
        console.error('Error checking subscription:', error);
        throw new Error('Failed to check subscription');
    }
}

// Register route
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

        await pool.query(
            'INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING *',
            [email, username, hashedPassword]
        );
        
        const apiUrl = `${process.env.API_GATEWAY_URL}/subscribe?email=${encodeURIComponent(email)}`;
        await axios.post(apiUrl, {}, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });

        res.status(201).json({ message: 'Account created successfully, subscription email sent.' });
    } catch (error) {
        console.error(error);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Email or username already exists' });
        }
        res.status(500).json({ error: 'Failed to create account' });
    }
});

// Login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const isSubscribed = await checkUserSubscription(email);
        if (!isSubscribed) {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const passwordMatch = await compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate OTP
        const otp = generateOtp();
        await redisClient.set(email, otp, 'EX', 60); // Store OTP in Redis for 1 minute

        try {
            const apiUrl = `${process.env.API_GATEWAY_URL}/send-otp`;
            const response = await axios.post(apiUrl, { email, otp }, {
                headers: {
                    'x-api-key': process.env.API_KEY,
                    'Content-Type': 'application/json',
                },
            });

            if (response.status !== 200) {
                return res.status(500).json({ error: 'Failed to send OTP' });
            }
        } catch (error) {
            console.error('Error calling /otp API Gateway:', error);
            return res.status(500).json({ error: 'Failed to send OTP' });
        }

        req.session.userId = user.id;
        req.session.otpVerified = false;
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session:', err);
                return res.status(500).json({ error: 'Login failed' });
            }

            res.cookie('connect.sid', req.sessionID, { httpOnly: true, secure: false, maxAge: 300000 });
            res.json({ message: 'OTP sent. Please verify to complete login.' });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify route
app.post('/verify', async (req, res) => {
    const { otp, email } = req.body;

    try {
        const isSubscribed = await checkUserSubscription(email);
        if (!isSubscribed) {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }

        const storedOtp = await redisClient.get(email);
        if (!storedOtp || storedOtp !== otp) {
            return res.status(401).json({ error: 'Invalid or expired OTP code' });
        }

        req.session.otpVerified = true;
        res.json({ message: 'Verification successful' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Buy-ticket route
app.post('/buy-ticket', async (req, res) => {
    const { expiredDate, email } = req.body;
    const image = `https://source.unsplash.com/random/100x100/?ticket`;
    const qr_code = 'line.png';

    try {
        const isSubscribed = await checkUserSubscription(email);
        if (!isSubscribed) {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }

        const parsedExpiredDate = new Date(expiredDate);
        if (isNaN(parsedExpiredDate)) {
            return res.status(400).json({ error: 'Invalid expiredDate format' });
        }
        if (parsedExpiredDate <= new Date()) {
            return res.status(400).json({ error: 'expiredDate must be in the future' });
        }

        const ticketResult = await pool.query(
            'INSERT INTO tickets (user_id, expiredDate, image, qr_code) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.session.userId, expiredDate, image, qr_code]
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
