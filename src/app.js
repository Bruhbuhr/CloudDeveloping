// Required modules
const dotenv = require('dotenv');
dotenv.config();

const QRCode = require('qrcode');
const express = require('express');
const bodyParser = require('body-parser');
const { json } = bodyParser;
const { Pool } = require('pg');
const Redis = require('ioredis');
const { hash, compare } = require('bcrypt');
const { isEmail } = require('validator');
const jwt = require('jsonwebtoken');
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

// Function to generate QR code
const generateQRCode = async (text) => {
    try {
        const qrCodeDataURL = await QRCode.toDataURL(text);
        return qrCodeDataURL;
    } catch (error) {
        throw new Error('Failed to generate QR code');
    }
};

// Helper functions
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Authorization token required' });
    }
    try {
        const decoded = jwt.verify(token, "jwt-secret");
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

async function checkUserSubscription(userId) {
    try {
        const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        const email = result.rows[0].email;

        const apiUrl = `${process.env.API_GATEWAY_URL}/subscribe?email=${encodeURIComponent(email)}`;
        const response = await axios.post(apiUrl, {}, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        return response.data.status;
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

        const hashedPassword = await hash(password, 10);
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
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User does not exist' });
        }

        const user = result.rows[0];
        const passwordMatch = await compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const apiUrlSubscriptionCheck = `${process.env.API_GATEWAY_URL}/subscribe?email=${encodeURIComponent(email)}`;
        const response = await axios.post(apiUrlSubscriptionCheck, {}, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        if (response.data.status == 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const otp = generateOtp();
        await redisClient.set(email, otp, 'EX', 60);

        const apiUrl = `${process.env.API_GATEWAY_URL}/send-otp`;
        await axios.post(apiUrl, { email, otp }, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });

        res.json({ message: 'OTP sent. Please verify to complete login.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify route
app.post('/auth/verify', async (req, res) => {
    const { otp, email } = req.body;

    try {
        const resultEmail = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
        if (resultEmail.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = resultEmail.rows[0];

        const apiUrlSubscriptionCheck = `${process.env.API_GATEWAY_URL}/subscribe?email=${encodeURIComponent(email)}`;
        const response = await axios.post(apiUrlSubscriptionCheck, {}, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        if (response.data.status == 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }
        
        // Retrieve the OTP stored in Redis
        const storedOtp = await redisClient.get(email);
        if (!storedOtp) {
            return res.status(400).json({ error: 'OTP expired or not found' });
        }

        // Compare the provided OTP with the stored OTP
        if (storedOtp !== otp) {
            return res.status(401).json({ error: 'Invalid OTP' });
        }

        // OTP matches, generate JWT token
        const token = jwt.sign({ id: user.id, email: user.email }, "jwt-secret", { expiresIn: '1h' });

        // Clear the OTP from Redis after successful verification
        await redisClient.del(email);

        res.json({ message: 'Verification successful', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Endpoint to create an event
app.post('/event/create', verifyToken, async (req, res) => {
    const { name, description, location, startDate, endDate, image } = req.body;

    try {
        if (!name || !startDate || !image) {
            return res.status(400).json({ error: 'Missing required fields: name, startDate, or image' });
        }

        const result = await pool.query(
            'INSERT INTO events (name, description, location, start_date, end_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [name, description, location, startDate, endDate]
        );

        const eventId = result.rows[0].id;

        const apiUrl = `${process.env.API_GATEWAY_URL}/create-event`;
        const imageUploadPayload = {
            image,
            event_id: eventId,
        };

        const uploadResponse = await axios.post(apiUrl, imageUploadPayload, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });

        if (uploadResponse.status !== 200 || !uploadResponse.data.image_url) {
            throw new Error('Image upload failed');
        }

        const imageUrl = `${eventId}/image.png`;

        await pool.query(
            'UPDATE events SET image_url = $1 WHERE id = $2',
            [imageUrl, eventId]
        );

        res.status(201).json({ message: 'Event created successfully' });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// Endpoint to get all events
app.get('/event', verifyToken, async (req, res) => {
    try {
        const isSubscribed = await checkUserSubscription(req.user.id);
        if (isSubscribed == 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const result = await pool.query('SELECT * FROM events ORDER BY start_date ASC');
        res.json({ events: result.rows });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Endpoint to create a ticket for an event
app.post('/ticket/create', verifyToken, async (req, res) => {
    const { event_id } = req.body;

    try {
        if (!event_id) {
            return res.status(400).json({ error: 'Event ID is required' });
        }

        // Check user subscription
        const isSubscribed = await checkUserSubscription(req.user.id);
        if (isSubscribed === 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        // Ensure the event exists
        const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1', [event_id]);
        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Generate a unique ticket code
        const ticketCode = `TICKET-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        // Generate QR code
        const qrCodeDataURL = await generateQRCode(ticketCode);

        // Decode QR Code Data URL to binary
        const qrCodeBuffer = Buffer.from(qrCodeDataURL.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        // Prepare API Gateway payload
        const apiUrl = `${process.env.API_GATEWAY_URL}/create-ticket`;
        const payload = {
            event_id,
            user_id: req.user.id,
            image: qrCodeBuffer.toString('base64'),
        };

        // Call API Gateway to upload QR code and get S3 URL
        const uploadResponse = await axios.post(apiUrl, payload, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });

        if (uploadResponse.status !== 200 || !uploadResponse.data.image_url) {
            throw new Error('Image upload failed');
        }

        // Get the uploaded QR code URL
        const qrCodeUrl = uploadResponse.data.image_url;

        // Insert ticket into the database
        const ticketPrice = 50.00; // Placeholder value
        await pool.query(
            `INSERT INTO tickets (user_id, event_id, ticket_code, price, qr_code_url)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, ticket_code, status, price, qr_code_url, created_at`,
            [req.user.id, event_id, ticketCode, ticketPrice, qrCodeUrl]
        );

        // Return success response with ticket details
        res.status(201).json({ message: 'Ticket created successfully' });
    } catch (error) {
        console.error('Error creating ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to fetch all tickets for the authenticated user
app.get('/ticket', verifyToken, async (req, res) => {
    try {
        // Check user subscription
        const isSubscribed = await checkUserSubscription(req.user.id);
        if (isSubscribed === 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        // Fetch tickets from the database with additional details
        const result = await pool.query(
            `SELECT 
                tickets.id AS ticket_id,
                tickets.ticket_code,
                tickets.status,
                tickets.price,
                tickets.created_at,
                events.id AS event_id,
                events.name AS event_name,
                events.start_date,
                events.end_date,
                events.location
             FROM tickets 
             JOIN events ON tickets.event_id = events.id 
             WHERE tickets.user_id = $1 
             ORDER BY tickets.created_at DESC`,
            [req.user.id]
        );

        res.status(200).json({ tickets: result.rows });
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
