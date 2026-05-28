const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai'); 
const path = require('path');
const mongoose = require('mongoose');
const cookieSession = require('cookie-session');
require('dotenv').config();

// Destructure model dependencies explicitly
const { User, StudyPlan } = require('./models');

const app = express();

// ==========================================================================
// SERVERLESS-OPTIMIZED DATABASE CONNECTIVITY ARCHITECTURE
// ==========================================================================
const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) return;
  
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000 
    });
    console.log('🍃 Connected cleanly to live cloud MongoDB database instance.');
  } catch (err) {
    console.error('❌ MongoDB cloud connection failure:', err);
  }
};

app.use(async (req, res, next) => {
  await connectDatabase();
  next();
});

// Standard core middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================================================
// SERVERLESS COOKIE SESSION INITIALIZATION BLOCK
// ==========================================================================
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'fallback_secret_key'],
  maxAge: 24 * 60 * 60 * 1000, // Session duration: 24h
  secure: process.env.NODE_ENV === 'production', 
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
}));

// PURE CUSTOM AUTH SHIELD MIDDLEWARE
const ensureAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ loggedIn: false, error: "Unauthorized access path." });
};

// Configure File Upload Processing
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ai = new GoogleGenAI({ apiKey: process.env.EDUTRACK_API_KEY });

// ==========================================================================
// USER VALIDATION & SIGNUP ROUTES (CUSTOM DRIVEN)
// ==========================================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Provide username and password metrics." });
    }
    
    const cleanUsername = username.toLowerCase().trim();
    const existingUser = await User.findOne({ username: cleanUsername });
    if (existingUser) {
      return res.status(400).json({ error: "Username already assigned." });
    }

    const newUser = new User({ username: cleanUsername, password });
    await newUser.save();
    
    // Save session payload directly into cookie stream
    req.session.user = { id: newUser._id.toString(), username: newUser.username };
    return res.json({ success: true, user: { username: newUser.username } });
  } catch (err) { 
    console.error("🔥 SYSTEM REGISTRATION ERROR:", err);
    return res.status(500).json({ error: "Registration sequence database error." }); 
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password fields." });
    }

    const cleanUsername = username.toLowerCase().trim();
    const user = await User.findOne({ username: cleanUsername });
    if (!user) {
      return res.status(401).json({ error: "Incorrect username or password details." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect username or password details." });
    }

    // Assign custom cookie session payload
    req.session.user = { id: user._id.toString(), username: user.username };
    return res.json({ success: true, user: { username: user.username } });
  } catch (err) {
    console.error("🔥 LOGIN FAILURE:", err);
    return res.status(500).json({ error: "Internal validation failure." });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null; // Instantly destroys cookie payload on browser side
  res.json({ success: true });
});

app.get('/api/auth/session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, username: req.session.user.username });
  } else {
    res.status(200).json({ loggedIn: false });
  }
});

// ==========================================================================
// DATA ACQUISITION STORAGE ROUTES
// ==========================================================================
app.post('/api/parse-syllabus', ensureAuthenticated, upload.single('syllabus'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload a syllabus file." });
    const { examDate, weeklyHours } = req.body;

    let contentsPayload = [];
    let rawText = "";
    try {
      const pdfData = await pdfParse(req.file.buffer);
      rawText = pdfData.text;
    } catch (e) { }

    if (!rawText || rawText.trim().length === 0) {
      contentsPayload = [{ inlineData: { mimeType: "application/pdf", data: req.file.buffer.toString("base64") } }, "Extract curriculum information from raw document assets and map structured week data layouts."];
    } else {
      contentsPayload = [`Syllabus text dataset to parse:\n${rawText}`];
    }

    const systemInstructions = `You are an elite academic advisor. Break down this syllabus into a strict week-by-week study timeline. Respond ONLY with a valid JSON object matching the standard requested format structure layout.`;
    const jsonSchema = { type: "OBJECT", properties: { courseName: { type: "STRING" }, totalEstimatedWeeks: { type: "NUMBER" }, schedule: { type: "ARRAY", items: { type: "OBJECT", properties: { week: { type: "NUMBER" }, topicTitle: { type: "STRING" }, estimatedHours: { type: "NUMBER" }, subtopics: { type: "ARRAY", items: { type: "STRING" } } }, required: ["week", "topicTitle", "estimatedHours", "subtopics"] } } }, required: ["courseName", "totalEstimatedWeeks", "schedule"] };

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contentsPayload,
      config: { systemInstruction: systemInstructions, responseMimeType: "application/json", responseSchema: jsonSchema }
    });

    const structuredSchedule = JSON.parse(aiResponse.text);

    const newPlan = new StudyPlan({
        userId: req.session.user.id, // Pulled straight from custom cookie payload mapping
        examDate,
        weeklyHours,
        data: structuredSchedule
    });
    await newPlan.save();

    res.json(structuredSchedule);
  } catch (error) { res.status(500).json({ error: "Syllabus parsing execution exception." }); }
});

app.get('/api/history', ensureAuthenticated, async (req, res) => {
  try {
    const records = await StudyPlan.find({ userId: req.session.user.id }).sort({ _id: -1 });
    res.json(records);
  } catch (error) { res.status(500).json({ error: "Failed to read database logs." }); }
});

app.post('/api/generate-flashcards', ensureAuthenticated, async (req, res) => {
  try {
    const { notes } = req.body;
    const systemInstructions = `You are a strict active-recall assistant. Respond ONLY with a valid JSON array matching the requested schema.`;
    const jsonSchema = { type: "ARRAY", items: { type: "OBJECT", properties: { q: { type: "STRING" }, a: { type: "STRING" } }, required: ["q", "a"] } };

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate cards based on notes:\n${notes}`,
      config: { systemInstruction: systemInstructions, responseMimeType: "application/json", responseSchema: jsonSchema }
    });
    res.json(JSON.parse(aiResponse.text));
  } catch (e) { res.status(500).json({ error: "Cards processing error." }); }
});

app.post('/api/summarize-notes', ensureAuthenticated, async (req, res) => {
  try {
    const { notes } = req.body;
    const systemInstructions = `You are an expert academic editor. Convert the user notes cleanly into a highly readable plain-text summary structure.`;
    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Summarize notes:\n${notes}`,
      config: { systemInstruction: systemInstructions }
    });
    res.json({ summary: aiResponse.text || "Summary failed." });
  } catch (e) { res.status(500).json({ error: "Summarizer system exception." }); }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`\n🚀 Secure Full-Stack Hub running locally on: http://localhost:${PORT}`));
}

module.exports = app;