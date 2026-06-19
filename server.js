import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import twilio from 'twilio';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import connectDB from './db.js';
import Lead from './models/Lead.js';
import Admin from './models/Admin.js';
import protect from './middleware/auth.js';
import { loginLimiter, apiLimiter } from './middleware/rateLimiter.js';

dotenv.config();

// Connect to MongoDB
connectDB().then(() => {
  seedDefaultAdmin();
});

// Seed function for default admin
async function seedDefaultAdmin() {
  try {
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'Admin@Qtutors123';
      const passwordHash = await bcrypt.hash(password, 12);
      
      await Admin.create({
        username,
        passwordHash
      });
      console.log('🛡️ Default admin user seeded successfully.');
      if (!process.env.ADMIN_PASSWORD) {
        console.warn('⚠️ WARNING: Default admin password "Admin@Qtutors123" is in use. Please change it immediately via settings or the .env file!');
      }
    }
  } catch (error) {
    console.error('❌ Failed to seed default admin:', error.message);
  }
}

const app = express();

// Use Helmet for basic HTTP security headers
app.use(helmet({
  crossOriginResourcePolicy: false // Allow loading assets across origins if needed
}));

// ══════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════════════

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174', // Allow local admin panel dev server
  'https://qtutors-frontend.vercel.app',
  'https://www.qumtutors.com'
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

  // Save lead to MongoDB first (fail-safe fallback)
  try {
    const lead = await Lead.create({
      name,
      email,
      phone: phone || 'Not provided',
      grade: grade || 'Not provided',
      exam: exam || 'Not provided',
      country: country || 'Not provided',
    });
    console.log(`💾 Lead saved to MongoDB: ${lead._id}`);
  } catch (dbErr) {
    console.error('❌ Failed to save lead to database:', dbErr.message);
  }

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

// ══════════════════════════════════════════════════════════════════
//  ADMIN PANEL SECURE API ROUTES
// ══════════════════════════════════════════════════════════════════

// Admin Login Route (Rate limited to prevent brute force)
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request',
      details: 'Username and password are required',
    });
  }

  try {
    const admin = await Admin.findOne({ username: username.toLowerCase() });
    if (!admin) {
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        details: 'Invalid username or password',
      });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        details: 'Invalid username or password',
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Create JWT token
    const token = jwt.sign(
      { id: admin._id, username: admin.username },
      process.env.JWT_SECRET || 'qtutors_super_secret_key_change_me',
      { expiresIn: '2h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        username: admin.username,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      details: 'Internal server error',
    });
  }
});

// Admin Change Password Route (Protected)
app.post('/api/admin/change-password', protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request',
      details: 'Current password and new password are required',
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request',
      details: 'New password must be at least 6 characters long',
    });
  }

  try {
    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin not found',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: 'Invalid credentials',
        details: 'Current password is incorrect',
      });
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 12);
    await admin.save();

    res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('❌ Password update error:', error);
    res.status(500).json({
      success: false,
      error: 'Password update failed',
      details: 'Internal server error',
    });
  }
});

// Fetch All Leads (Protected, Rate limited, with filters & pagination)
app.get('/api/admin/leads', protect, apiLimiter, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { status, search, country, grade, exam } = req.query;

    const query = {};

    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }

    // Filter by country
    if (country && country !== 'all') {
      query.country = country;
    }

    // Filter by grade
    if (grade && grade !== 'all') {
      query.grade = grade;
    }

    // Filter by exam
    if (exam && exam !== 'all') {
      query.exam = exam;
    }

    // Search by Name, Email, Phone
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    // Fetch leads and total count
    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalLeads = await Lead.countDocuments(query);

    res.json({
      success: true,
      leads,
      pagination: {
        total: totalLeads,
        page,
        limit,
        pages: Math.ceil(totalLeads / limit),
      },
    });
  } catch (error) {
    console.error('❌ Fetch leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leads',
      details: 'Internal server error',
    });
  }
});

// Update Lead Status (Protected)
app.put('/api/admin/leads/:id', protect, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['Pending', 'Contacted', 'Converted', 'Rejected'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request',
      details: 'Invalid status value',
    });
  }

  try {
    const lead = await Lead.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
      });
    }

    res.json({
      success: true,
      message: 'Lead status updated successfully',
      lead,
    });
  } catch (error) {
    console.error('❌ Update lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update lead status',
      details: 'Internal server error',
    });
  }
});

// Delete a Lead (Protected)
app.delete('/api/admin/leads/:id', protect, async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await Lead.findByIdAndDelete(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
      });
    }

    res.json({
      success: true,
      message: 'Lead deleted successfully',
    });
  } catch (error) {
    console.error('❌ Delete lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete lead',
      details: 'Internal server error',
    });
  }
});

// Get Dashboard Stats (Protected, Rate limited)
app.get('/api/admin/stats', protect, apiLimiter, async (req, res) => {
  try {
    // 1. Core Counts
    const totalLeads = await Lead.countDocuments();
    const pendingLeads = await Lead.countDocuments({ status: 'Pending' });
    const contactedLeads = await Lead.countDocuments({ status: 'Contacted' });
    const convertedLeads = await Lead.countDocuments({ status: 'Converted' });
    const rejectedLeads = await Lead.countDocuments({ status: 'Rejected' });

    // 2. Leads in last 7 days (for trend chart)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const leadsByDate = await Lead.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // 3. Leads by Country
    const leadsByCountry = await Lead.aggregate([
      {
        $group: {
          _id: "$country",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);

    // 4. Leads by Grade
    const leadsByGrade = await Lead.aggregate([
      {
        $group: {
          _id: "$grade",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);

    // 5. Leads by Exam
    const leadsByExam = await Lead.aggregate([
      {
        $group: {
          _id: "$exam",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);

    res.json({
      success: true,
      stats: {
        total: totalLeads,
        status: {
          pending: pendingLeads,
          contacted: contactedLeads,
          converted: convertedLeads,
          rejected: rejectedLeads,
        },
        conversionRate: totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0,
        leadsByDate,
        leadsByCountry,
        leadsByGrade,
        leadsByExam
      }
    });
  } catch (error) {
    console.error('❌ Stats generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      details: 'Internal server error',
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
