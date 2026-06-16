import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import twilio from 'twilio';
// import emailjs from '@emailjs/nodejs';

dotenv.config();

const app = express();

// ══════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════════════

const allowedOrigins = [
  'http://localhost:5173',
  'https://qtutors-frontend.vercel.app',
  'https://www.qumtutors.com/'
];

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app')
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use((req, res, next) => {
  console.log('Origin:', req.headers.origin);
  next();
});

app.use(express.json());

// Request validation middleware
const validateFormData = (req, res, next) => {
  const { name, email, phone, grade, exam, country } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Validation failed',
      details: 'name and email are required'
    });
  }

  if (!email.includes('@')) {
    return res.status(400).json({
      error: 'Validation failed',
      details: 'Invalid email format'
    });
  }

  next();
};

// ══════════════════════════════════════════════════════════════════
//  SERVICES INITIALIZATION
// ══════════════════════════════════════════════════════════════════

// Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// EmailJS initialization

import axios from 'axios';

const EMAILJS_API_URL = 'https://api.emailjs.com/api/v1.0/email/send';

async function sendEmailJS(templateId, templateParams) {
  return axios.post(
    EMAILJS_API_URL,
    {
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: templateId,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: templateParams,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Qtutors-Backend)',
      },
    }
  );
}

// ══════════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Qtutors backend running ✅', timestamp: new Date() });
});

// Main submission route - handles both EmailJS and Twilio
app.post('/api/submit-form', validateFormData, async (req, res) => {
  const { name, email, phone, grade, exam, country } = req.body;

  const results = {
    emailToOwner: null,
    emailToUser: null,
    whatsappNotification: null,
  };

  try {
    // ─────────────────────────────────────────────────────────────
    // Step 1: Send email to owner (business notification)
    // ─────────────────────────────────────────────────────────────
    // Step 1: owner email
    try {
      await sendEmailJS(process.env.EMAILJS_OWNER_TEMPLATE_ID, {
        name,
        email,
        phone: phone || 'Not provided',
        grade: grade || 'Not provided',
        exam: exam || 'Not provided',
        country: country || 'Not provided',
        recipient: 'owner',
      });
      results.emailToOwner = true;
      console.log(`✅ Owner email sent for lead: ${name}`);
    } catch (err) {
      results.emailToOwner = false;
      console.error('❌ Owner email failed:', err.response?.data || err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // Step 2: Send confirmation email to user
    // ─────────────────────────────────────────────────────────────
    // Step 2: user confirmation email
    try {
      await sendEmailJS(process.env.EMAILJS_USER_TEMPLATE_ID, {
        name,
        email,
        phone: phone || 'Not provided',
        grade: grade || 'Not provided',
        exam: exam || 'Not provided',
        country: country || 'Not provided',
        to_email: email,
        recipient: 'user',
      });
      results.emailToUser = true;
      console.log(`✅ User confirmation email sent to: ${email}`);
    } catch (err) {
      results.emailToUser = false;
      console.error('❌ User email failed:', err.response?.data || err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // Step 3: Send WhatsApp notification to owner (if enabled)
    // ─────────────────────────────────────────────────────────────
    if (process.env.SEND_WHATSAPP === 'true' && process.env.TWILIO_WHATSAPP_FROM && process.env.YOUR_WHATSAPP_NUMBER) {
      try {
        const whatsappMessage =
          `🎓 *New Qtutors Lead!*\n\n` +
          `👤 *Name:* ${name}\n` +
          `📧 *Email:* ${email}\n` +
          `📱 *Phone:* ${phone || 'Not provided'}\n` +
          `🎒 *Grade:* ${grade || 'Not provided'}\n` +
          `📝 *Exam:* ${exam || 'Not provided'}\n` +
          `🌍 *Country:* ${country || 'Not provided'}\n\n` +
          `Reply to this student quickly! ⚡`;

        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
          to: `whatsapp:${process.env.YOUR_WHATSAPP_NUMBER}`,
          body: whatsappMessage,
        });

        results.whatsappNotification = true;
        console.log(`✅ WhatsApp sent for lead: ${name}`);
      } catch (err) {
        results.whatsappNotification = false;
        console.error('❌ WhatsApp send failed:', err.message);
      }
    }

    // Success response (even if some services failed)
    const allSucceeded = results.emailToOwner && results.emailToUser;

    res.status(allSucceeded ? 200 : 207).json({
      success: allSucceeded,
      message: allSucceeded
        ? 'Form submitted successfully. Emails sent.'
        : 'Form submitted partially. Some notifications may have failed.',
      results,
    });

  } catch (err) {
    console.error('❌ Form submission error:', err);
    res.status(500).json({
      success: false,
      error: 'Form submission failed',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ══════════════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📧 EmailJS service ID: ${process.env.EMAILJS_SERVICE_ID ? '✅' : '❌'}`);
  console.log(`📧 EmailJS public key: ${process.env.EMAILJS_PUBLIC_KEY ? '✅' : '❌'}`);
  console.log(`📧 EmailJS owner template: ${process.env.EMAILJS_OWNER_TEMPLATE_ID ? '✅' : '❌'}`);
  console.log(`📧 EmailJS user template: ${process.env.EMAILJS_USER_TEMPLATE_ID ? '✅' : '❌'}`);
  console.log(`💬 Twilio configured: ${process.env.TWILIO_ACCOUNT_SID ? '✅' : '❌'}`);
  console.log(`🔒 CORS origin: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});
