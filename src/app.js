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
const cors = require('cors');

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
app.use(cors());
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
async function checkUserSubscription(userId) {
    try {
        // Get user email from database using userId
        const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        const email = result.rows[0].email;

        // Now check subscription using email
        const apiUrl = `${process.env.API_GATEWAY_URL}/subscribe?email=${encodeURIComponent(email)}`;
        const response = await axios.post(apiUrl, {}, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        return response.data.message;
    } catch (error) {
        console.error('Error checking subscription:', error);
        throw new Error('Failed to check subscription');
    }
}

// Register route
app.post('/auth/register', async (req, res) => {
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
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Now check subscription using email
        const apiUrl = `${process.env.API_GATEWAY_URL}/subscribe?email=${encodeURIComponent(email)}`;
        const response = await axios.post(apiUrl, {}, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        if (response.data.message != 'Execution started successfully') {
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
app.post('/auth/verify', async (req, res) => {
    const { otp } = req.body;

    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }

        // Check user subscription using userId in session
        const isSubscribed = await checkUserSubscription(req.session.userId);
        if (isSubscribed != 'Execution started successfully') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const storedOtp = await redisClient.get(req.session.userId.toString());
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

// Endpoint to create an event
app.post('/event/create', async (req, res) => {
    const { name, description, location, startDate, endDate, image } = req.body;

    try {
        // Validate input
        if (!name || !startDate || !image) {
            return res.status(400).json({ error: 'Missing required fields: name, startDate, or image' });
        }

        Insert event details into the database (without the image URL yet)
        const result = await pool.query(
            'INSERT INTO events (name, description, location, start_date, end_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, description, location, startDate, endDate]
        );

        const eventId = result.rows[0].id;

        // Prepare image data for API Gateway
        const apiUrl = `${process.env.API_GATEWAY_URL}/create-event`;
        const imageUploadPayload = {
            image,
            event_id: eventId,
        };

        // Call the API Gateway endpoint for image upload
        const uploadResponse = await axios.post(apiUrl, imageUploadPayload, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });

        if (uploadResponse.status !== 200 || !uploadResponse.data.image_url) {
            throw new Error('Image upload failed');
        }

        const imageUrl = `${process.env.CLOUDFRONT_URL}/${eventId}/image.png`;

        // Update the event record with the image URL
        await pool.query(
            'UPDATE events SET image_url = $1 WHERE id = $2',
            [imageUrl, eventId]
        );

        res.status(201).json({
            message: 'Event created successfully'
        });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// Endpoint to get all events
app.get('/event', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not logged in' });
        }

        // Check user subscription using userId in session
        const isSubscribed = await checkUserSubscription(req.session.userId);
        if (isSubscribed != 'Execution started successfully') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }
        
        // Query to fetch all events
        const result = await pool.query('SELECT * FROM events ORDER BY start_date ASC');

        // Return the events in the response
        res.json({ events: result.rows });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
