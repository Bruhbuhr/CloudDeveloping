import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import express from 'express';
import bodyParser from 'body-parser'; // Import body-parser
const { json } = bodyParser;  // Use json from body-parser
import pg from 'pg';
const { Pool } = pg;
import redis from 'redis';
import { hash, compare } from 'bcrypt';
import validator from 'validator'; // Import validator
const { isEmail } = validator; // Use isEmail from validator
import otpGenerator from 'otp-generator'; // For OTP generation
import jwt from 'jsonwebtoken'; // For JWTs

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
const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: 6379,
    },
});

// Connect to Redis
(async () => {
    try {
        await redisClient.connect();
        console.log('Connected to Redis');
    } catch (error) {
        console.error('Error connecting to Redis:', error);
    }
})();

redisClient.on('error', (err) => console.log('Redis Client Error', err));

//Middleware
app.use(json());

// --- Helper Functions ---

// Function to generate OTP
function generateOtp() {
    return otpGenerator.generate(6, {
        upperCaseAlphabets: false,
        specialChars: false,
    });
}

// // Function to generate JWT
// function generateJwt(userId) {
//     // Replace with your actual JWT secret
//     const secretKey = process.env.JWT_SECRET || 'your_jwt_secret';
//     const token = jwt.sign({ userId }, secretKey, { expiresIn: '1h' }); // 1 hour expiration
//     return token;
// }

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
        await redisClient.set(email, otp, 'EX', 300); // Expire in 5 minutes

        res.json({ otp, message: 'OTP code generated. Please verify.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// /verify route
app.post('/verify', async (req, res) => {
    const { email, password, otp } = req.body;

    try {
        // 1. Get OTP from Redis
        const storedOtp = await redisClient.get(email);

        // 2. Validate OTP
        if (!storedOtp || storedOtp !== otp) {
            return res.status(401).json({ error: 'Invalid or expired OTP code' });
        }

        // 3. (Optional) Verify email and password again
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const passwordMatch = await compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // // 4. Generate JWT
        // const token = generateJwt(user.id);

        res.json({ message: 'Verification successful', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// --- End of API Routes ---

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});