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
UserSchema.pre('save', async function() {
    // If the user didn't modify their password text, stop executing right here
    if (!this.isModified('password')) return;

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    } catch (err) {
        throw new Error("Password encryption layer failed: " + err.message);
    }
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

// Explicitly export both models as an object bundle
module.exports = { User, StudyPlan };