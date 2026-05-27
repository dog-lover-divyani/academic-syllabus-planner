const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// ==========================================================================
// 1. USER ACCOUNT BLUEPRINT
// ==========================================================================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true }
});

// Security Guard Hook: Automatically hash/encrypt passwords before saving them
UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) { next(err); }
});

// Secure Matcher: Safely check if a login password matches the encrypted database password
UserSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// ==========================================================================
// 2. STUDY PLAN BLUEPRINT (Tied to a specific User ID)
// ==========================================================================
const StudyPlanSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    timestamp: { type: String, default: () => new Date().toLocaleDateString() },
    examDate: String,
    weeklyHours: Number,
    data: {
        courseName: String,
        totalEstimatedWeeks: Number,
        schedule: Array
    }
});

const User = mongoose.model('User', UserSchema);
const StudyPlan = mongoose.model('StudyPlan', StudyPlanSchema);

module.exports = { User, StudyPlan };