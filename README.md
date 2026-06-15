# Qtutors — Backend

Backend API server for **Qtutors**, an online tutoring platform offering personalized coaching for NAPLAN, 11+, GCSE/IGCSE, and SAT.

This service handles the contact/trial-booking form submissions from the frontend and sends out:
- An email notification to the Qtutors team (owner)
- A confirmation email to the student/parent
- A WhatsApp notification to the team via Twilio

## Tech Stack

- **Node.js** + **Express** — REST API server
- **EmailJS** (REST API via Axios) — transactional emails
- **Twilio API** — WhatsApp notifications
- **CORS** — restricts API access to the frontend domain

## Features

- `POST /api/submit-form` — accepts trial booking form data, validates it, and triggers email + WhatsApp notifications
- `GET /` — health check endpoint
- Graceful handling: if one notification channel fails (e.g. email), the others still attempt to send, and the response reports per-channel status

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/hadeedhaider2698/Qtutors-backend.git
cd Qtutors-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root directory (this file is gitignored and must **never** be committed):

```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# EmailJS (https://www.emailjs.com)
EMAILJS_SERVICE_ID=your_service_id
EMAILJS_PUBLIC_KEY=your_public_key
EMAILJS_PRIVATE_KEY=your_private_key
EMAILJS_OWNER_TEMPLATE_ID=your_owner_template_id
EMAILJS_USER_TEMPLATE_ID=your_user_template_id

# Twilio WhatsApp (https://www.twilio.com)
SEND_WHATSAPP=true
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=+14155238886
YOUR_WHATSAPP_NUMBER=+92xxxxxxxxxx
```

### 4. Run the server

```bash
npm run dev
```

Server starts at `http://localhost:3001`. On startup, the console logs the configuration status of each integration (✅ / ❌) so you can quickly verify your `.env` is set up correctly.

## API Endpoints

### `GET /`
Health check. Returns:
```json
{ "status": "Qtutors backend running ✅", "timestamp": "..." }
```

### `POST /api/submit-form`
Submits a trial booking request.

**Request body:**
```json
{
  "name": "Syed Ali Raza",
  "email": "student@example.com",
  "phone": "+923165252586",
  "grade": "5",
  "exam": "SAT",
  "country": "Pakistan"
}
```

**Required fields:** `name`, `email`

**Response (200 / 207):**
```json
{
  "success": true,
  "message": "Form submitted successfully. Emails sent.",
  "results": {
    "emailToOwner": true,
    "emailToUser": true,
    "whatsappNotification": true
  }
}
```

- `200` — all notifications sent successfully
- `207` — form accepted, but one or more notifications failed (check `results`)
- `400` — validation error (missing/invalid name or email)
- `500` — unexpected server error

## Deployment

This backend is deployed on [Render](https://render.com):

- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- All environment variables from `.env` must be added under Render → Environment

After deploying the frontend, update `FRONTEND_URL` in the Render environment variables to match the live frontend URL (for correct CORS behavior).

## Security Notes

- Never commit `.env` — it's listed in `.gitignore`
- If any secret (Twilio Auth Token, EmailJS Private Key, etc.) is ever exposed, regenerate it immediately from the respective dashboard

## License

Private project — all rights reserved.
