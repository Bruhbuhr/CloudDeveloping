# API Documentation

This document provides details about the API endpoints, request methods, request parameters, and expected responses for the application.

## Base URL
The base URL for the API is: `http://localhost:3000`

---

## Authentication

### 1. **Register**
**Endpoint:** `/auth/register`

**Method:** POST

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "user123",
  "password": "securePassword"
}
```

**Response:**
- **201 Created:**
  ```json
  {
    "message": "Account created successfully, subscription email sent."
  }
  ```
- **400 Bad Request:** Missing or invalid fields.
- **500 Internal Server Error:** Unable to create account.

---

### 2. **Login**
**Endpoint:** `/auth/login`

**Method:** POST

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword"
}
```

**Response:**
- **200 OK:**
  ```json
  {
    "message": "OTP sent. Please verify to complete login."
  }
  ```
- **401 Unauthorized:** Invalid credentials.
- **403 Forbidden:** User is not subscribed to notifications.
- **500 Internal Server Error:** Login failed.

---

### 3. **Verify OTP**
**Endpoint:** `/auth/verify`

**Method:** POST

**Request Body:**
```json
{
  "otp": "123456",
  "email": "user@example.com"
}
```

**Response:**
- **200 OK:**
  ```json
  {
    "message": "Verification successful",
    "token": "JWT_TOKEN"
  }
  ```
- **401 Unauthorized:** Invalid OTP.
- **500 Internal Server Error:** Verification failed.

---

## Events

### 1. **Create Event**
**Endpoint:** `/event/create`

**Method:** POST

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Request Body:**
```json
{
  "name": "Event Name",
  "description": "Event Description",
  "location": "Event Location",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "image": "base64EncodedImageString"
}
```

**Response:**
- **201 Created:**
  ```json
  {
    "message": "Event created successfully"
  }
  ```
- **400 Bad Request:** Missing required fields.
- **500 Internal Server Error:** Event creation failed.

---

### 2. **Get All Events**
**Endpoint:** `/event`

**Method:** GET

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Response:**
- **200 OK:**
  ```json
  {
    "events": [
      {
        "id": 1,
        "name": "Event Name",
        "description": "Event Description",
        "location": "Event Location",
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD"
      }
    ]
  }
  ```
- **500 Internal Server Error:** Failed to fetch events.

---

### 3. **Get Event by ID**
**Endpoint:** `/event/:id`

**Method:** GET

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Response:**
- **200 OK:**
  ```json
  {
    "event": {
      "id": 1,
      "name": "Event Name",
      "description": "Event Description",
      "location": "Event Location",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD"
    }
  }
  ```
- **404 Not Found:** Event not found.
- **500 Internal Server Error:** Failed to fetch event.

---

## Tickets

### 1. **Create Ticket**
**Endpoint:** `/ticket/create`

**Method:** POST

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Request Body:**
```json
{
  "event_id": 1
}
```

**Response:**
- **201 Created:**
  ```json
  {
    "message": "Ticket created successfully"
  }
  ```
- **400 Bad Request:** Missing required fields.
- **404 Not Found:** Event not found.
- **500 Internal Server Error:** Failed to create ticket.

---

### 2. **Get All Tickets**
**Endpoint:** `/ticket`

**Method:** GET

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Response:**
- **200 OK:**
  ```json
  {
    "tickets": [
      {
        "ticket_id": 1,
        "status": "active",
        "price": 50.00,
        "created_at": "YYYY-MM-DD",
        "event_id": 1,
        "event_name": "Event Name"
      }
    ]
  }
  ```
- **500 Internal Server Error:** Failed to fetch tickets.

---

### 3. **Get Ticket by ID**
**Endpoint:** `/ticket/:id`

**Method:** GET

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Response:**
- **200 OK:**
  ```json
  {
    "ticket": {
      "ticket_id": 1,
      "status": "active",
      "price": 50.00,
      "created_at": "YYYY-MM-DD",
      "event_id": 1,
      "event_name": "Event Name",
      "qr_code_url": "http://s3.bucket.url/qrcode.png"
    }
  }
  ```
- **404 Not Found:** Ticket not found or access denied.
- **500 Internal Server Error:** Failed to fetch ticket.

---

### 4. **Generate QR Code**
**Endpoint:** `/ticket/generate-qr-code`

**Method:** POST

**Headers:**
```json
{
  "Authorization": "Bearer JWT_TOKEN"
}
```

**Request Body:**
```json
{
  "event_id": 1
}
```

**Response:**
- **201 Created:**
  ```json
  {
    "qr_code_url": "http://s3.bucket.url/qrcode.png"
  }
  ```
- **400 Bad Request:** Missing required fields.
- **404 Not Found:** Event not found.
- **500 Internal Server Error:** Failed to generate QR code.

---

## Error Handling
Common errors and their status codes:
- **400 Bad Request:** Invalid or missing data in the request.
- **401 Unauthorized:** Authentication required or invalid credentials.
- **403 Forbidden:** Access denied.
- **404 Not Found:** Resource not found.
- **500 Internal Server Error:** General server errors.

## Notes
- Ensure to replace placeholder URLs and tokens with actual values in production.
- All requests that require authentication should include the JWT token in the Authorization header.

