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

// Function to log user activity
const logActivity = async (user_id, activity, extra_data = {}) => {
    if (typeof user_id !== 'string') {
        throw new Error('user_id must be a string');
    }
    if (typeof activity !== 'string') {
        throw new Error('activity must be a string');
    }
    if (typeof extra_data !== 'object') {
        throw new Error('extra_data must be an object');
    }

    const activityLogUrl = `${process.env.API_GATEWAY_URL}/log-activity`;
    const activityPayload = {
        user_id,
        activity,
        extra_data,
    };

    try {
        await axios.post(activityLogUrl, activityPayload, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        console.log(`Activity logged: ${activity}`);
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
};

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
        const result = await pool.query(
            'INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING *',
            [email, username, hashedPassword]
        );

        const newUser = result.rows[0];
        
        // Log activity for registration
        await logActivity(
            newUser.id.toString(), 
            'User Registered', 
            { 
                email: email.toString(), 
                username: username.toString() 
            }
        );

        // Send subscription request
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

        await logActivity(user.id.toString(), 'User Login Attempt', { otp: otp.toString() });

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

        await logActivity(user.id.toString(), 'User Verify OTP Attempt', { otp: otp.toString(), stored_otp: storedOtp.toString() });

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

        const imageUrl = `${process.env.S3_BUCKET}/${eventId}/image.png`;

        await pool.query(
            'UPDATE events SET image_url = $1 WHERE id = $2',
            [imageUrl, eventId]
        );

        await logActivity(req.user.id.toString(), 'User Create Event Attempt', { event_id: eventId.toString(), event_name: name.toString() });

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
        if (isSubscribed === 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const cacheKey = 'events:all';
        const cachedEvents = await redisClient.get(cacheKey);

        if (cachedEvents) {
            console.log('Cache hit for all events');
            return res.json({ events: JSON.parse(cachedEvents) });
        }

        console.log('Cache miss for all events');
        const result = await pool.query('SELECT * FROM events ORDER BY start_date ASC');
        await redisClient.set(cacheKey, JSON.stringify(result.rows), 'EX', 30);
        await logActivity(req.user.id.toString(), 'User Get All Events Attempt');
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

        const resultTicket = await pool.query('SELECT id FROM tickets WHERE user_id = $1 AND event_id = $2', [req.user.id, event_id]);
        if (resultTicket.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const ticket = resultTicket.rows[0];
        await logActivity(req.user.id.toString(), 'User Buy Ticket Attempt', {
            event_id: event_id.toString(),
            ticket_id: ticket.id.toString()
        });

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

        const cacheKey = `ticket:all`;
        const cachedTicket = await redisClient.get(cacheKey);

        if (cachedTicket) {
            console.log(`Cache hit for all tickets`);
            return res.json({ ticket: JSON.parse(cachedTicket) });
        }

        console.log(`Cache miss for all tickets`);
        const result = await pool.query(
            `SELECT 
                tickets.id AS ticket_id,
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
        await redisClient.set(cacheKey, JSON.stringify(result.rows), 'EX', 30);
        await logActivity(req.user.id.toString(), 'User Get All Tickets Attempt');

        res.status(200).json({ tickets: result.rows });
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific event by ID
app.get('/event/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    try {
        const isSubscribed = await checkUserSubscription(req.user.id);
        if (isSubscribed === 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const cacheKey = `event:${id}`;
        const cachedEvent = await redisClient.get(cacheKey);

        if (cachedEvent) {
            console.log(`Cache hit for event ID: ${id}`);
            return res.json({ event: JSON.parse(cachedEvent) });
        }

        console.log(`Cache miss for event ID: ${id}`);
        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        await redisClient.set(cacheKey, JSON.stringify(eventResult.rows[0]), 'EX', 30);
        await logActivity(req.user.id.toString(), 'User Get Specific Event Attempt', { event_id: id.toString() });
        res.status(200).json({ event: eventResult.rows[0] });
    } catch (error) {
        console.error('Error fetching event:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific ticket by ID
app.get('/ticket/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    try {
        const isSubscribed = await checkUserSubscription(req.user.id);
        if (isSubscribed === 'FAIL') {
            return res.status(403).json({ error: 'User is not subscribed to notifications' });
        }

        const cacheKey = `ticket:${id}`;
        const cachedTicket = await redisClient.get(cacheKey);

        if (cachedTicket) {
            console.log(`Cache hit for ticket ID: ${id}`);
            return res.json({ ticket: JSON.parse(cachedTicket) });
        }

        console.log(`Cache miss for ticket ID: ${id}`);
        const ticketResult = await pool.query(
            `SELECT 
                tickets.id AS ticket_id,
                tickets.status,
                tickets.price,
                tickets.qr_code_url,
                tickets.created_at,
                events.id AS event_id,
                events.name AS event_name,
                events.start_date,
                events.end_date,
                events.location
             FROM tickets 
             JOIN events ON tickets.event_id = events.id 
             WHERE tickets.id = $1 AND tickets.user_id = $2`,
            [id, req.user.id]
        );

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket not found or access denied' });
        }

        await redisClient.set(cacheKey, JSON.stringify(ticketResult.rows[0]), 'EX', 30);
        await logActivity(req.user.id.toString(), 'User Get Specific Ticket Attempt', { event_id: id.toString() });
        res.status(200).json({ ticket: ticketResult.rows[0] });
    } catch (error) {
        console.error('Error fetching ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pre-signed URL for ticket QR code
app.post('/ticket/generate-qr-code', verifyToken, async (req, res) => {
    const { event_id } = req.body;

    try {
        // Validate the event ID
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

        // Define API Gateway URL and payload
        const apiUrl = `${process.env.API_GATEWAY_URL}/get-qr-code`;
        const payload = {
            event_id,
            user_id: req.user.id,
        };

        // Invoke API Gateway to generate the pre-signed URL
        const response = await axios.post(apiUrl, payload, {
            headers: {
                'x-api-key': process.env.API_KEY,
                'Content-Type': 'application/json',
            },
        });
        
        const resultTicket = await pool.query('SELECT id FROM tickets WHERE user_id = $1 AND event_id = $2', [req.user.id, event_id]);
        if (resultTicket.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const ticket = resultTicket.rows[0];
        await logActivity(req.user.id.toString(), 'User Get Pre-Signed URL For Ticket QR Code Attempt', { ticket_id: ticket.id.toString(), event_id: event_id.toString() });

        // Parse and return the pre-signed URL
        if (response.status === 200) {
            const { presigned_url } = response.data;
            return res.status(200).json({ presigned_url });
        } else {
            return res.status(response.status).json({ error: response.data.error || 'Failed to generate QR code URL' });
        }
    } catch (error) {
        console.error('Error generating QR code pre-signed URL:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// For healthcheck
app.get('/', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
