import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      default: 'Not provided',
    },
    grade: {
      type: String,
      trim: true,
      default: 'Not provided',
    },
    exam: {
      type: String,
      trim: true,
      default: 'Not provided',
    },
    country: {
      type: String,
      trim: true,
      default: 'Not provided',
    },
    status: {
      type: String,
      enum: ['Pending', 'Contacted', 'Converted', 'Rejected'],
      default: 'Pending',
    },
  },
  {
    timestamps: true, // Auto-generates createdAt and updatedAt
  }
);

// Indexes for fast lookup
leadSchema.index({ status: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ email: 1 });

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
