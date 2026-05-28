const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai') || {}; // Safe destructuring fallback
const GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI; // Classic SDK import
const path = require('path');
const mongoose = require('mongoose');
const cookieSession = require('cookie-session');
require('dotenv').config();

const { User, StudyPlan } = require('./models');

const app = express();

// ==========================================================================
// ROBUST SERVERLESS DATABASE CONNECTIVITY ENGINE
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================================================
// SERVERLESS COOKIE SESSION INITIALIZATION BLOCK
// ==========================================================================
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'fallback_secret_key'],
  maxAge: 24 * 60 * 60 * 1000, 
  secure: process.env.NODE_ENV === 'production', 
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
}));

const ensureAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ loggedIn: false, error: "Unauthorized access path." });
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ==========================================================================
// UNIVERSAL GOOGLE GEMINI INITIALIZATION ENGINE
// ==========================================================================
const activeApiKey = process.env.EDUTRACK_API_KEY || process.env.GEMINI_API_KEY;
let aiEngineInstance = null;
let isNewSDK = false;

if (GoogleGenAI && typeof GoogleGenAI === 'function') {
    try {
        aiEngineInstance = new GoogleGenAI({ apiKey: activeApiKey });
        isNewSDK = true;
    } catch(e) { aiEngineInstance = null; }
}

if (!aiEngineInstance && GoogleGenerativeAI) {
    try {
        aiEngineInstance = new GoogleGenerativeAI(activeApiKey);
        isNewSDK = false;
    } catch(e) { console.error("Critical AI Initialization Trace Failure:", e); }
}

// ==========================================================================
// USER VALIDATION & SIGNUP ROUTES
// ==========================================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Provide parameters." });
    
    const cleanUsername = username.toLowerCase().trim();
    const existingUser = await User.findOne({ username: cleanUsername });
    if (existingUser) return res.status(400).json({ error: "Username assigned." });

    const newUser = new User({ username: cleanUsername, password });
    await newUser.save();
    
    req.session.user = { id: newUser._id.toString(), username: newUser.username };
    return res.json({ success: true, user: { username: newUser.username } });
  } catch (err) { 
    return res.status(500).json({ error: "Registration database sequence exception." }); 
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Incorrect credentials." });
    }
    req.session.user = { id: user._id.toString(), username: user.username };
    return res.json({ success: true, user: { username: user.username } });
  } catch (err) {
    return res.status(500).json({ error: "Validation failure." });
  }
});

app.post('/api/auth/logout', (req, res) => { req.session = null; res.json({ success: true }); });
app.get('/api/auth/session', (req, res) => {
  if (req.session && req.session.user) res.json({ loggedIn: true, username: req.session.user.username });
  else res.status(200).json({ loggedIn: false });
});

// ==========================================================================
// DATA ACQUISITION AND PARSING STUDY PLAN ROUTES
// ==========================================================================
app.post('/api/parse-syllabus', ensureAuthenticated, upload.single('syllabus'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Syllabus asset missing." });
    const { examDate, weeklyHours } = req.body;

    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text || "Empty document transcript layer.";

    const systemInstructions = `You are an elite academic advisor. Break down this syllabus into a strict week-by-week study timeline. Respond ONLY with a valid JSON object matching this schema layout structure format without codeblocks:
    { "courseName": "String", "totalEstimatedWeeks": 12, "schedule": [ { "week": 1, "topicTitle": "String", "estimatedHours": 4, "subtopics": ["String"] } ] }`;

    let generatedTextResult = "";

    // Hybrid Router Execution: Run whatever SDK package is actively loaded on Vercel
    if (isNewSDK && aiEngineInstance.models) {
        const aiResponse = await aiEngineInstance.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [`Syllabus context text layout:\n${rawText}`],
          config: { systemInstruction: systemInstructions, responseMimeType: "application/json" }
        });
        generatedTextResult = aiResponse.text;
    } else if (aiEngineInstance) {
        const legacyModel = aiEngineInstance.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `${systemInstructions}\n\nSyllabus raw dataset text to interpret:\n${rawText}`;
        const aiResponse = await legacyModel.generateContent(prompt);
        generatedTextResult = aiResponse.response.text();
    } else {
        throw new Error("No functional AI connection engine instantiated.");
    }

    const structuredSchedule = JSON.parse(generatedTextResult.replace(/```json/g, '').replace(/```/g, '').trim());

    const newPlan = new StudyPlan({
        userId: req.session.user.id,
        examDate,
        weeklyHours,
        data: structuredSchedule
    });
    await newPlan.save();

    res.json(structuredSchedule);
  } catch (error) { 
    console.error("AI ROUTE EXCEPTION:", error);
    res.status(500).json({ error: "Syllabus parsing execution exception." }); 
  }
});

app.get('/api/history', ensureAuthenticated, async (req, res) => {
  try {
    const records = await StudyPlan.find({ userId: req.session.user.id }).sort({ _id: -1 });
    res.json(records);
  } catch (error) { res.status(500).json({ error: "Database log query failure." }); }
});

app.post('/api/generate-flashcards', ensureAuthenticated, async (req, res) => {
  try {
    const { notes } = req.body;
    if (!aiEngineInstance) return res.status(500).json({ error: "AI Unconfigured." });

    const systemInstructions = `Respond ONLY with a valid JSON array format matching this schema without markdown formatting blocks: [{"q": "Question Text", "a": "Answer Text"}]`;
    let resultText = "";

    if (isNewSDK) {
        const response = await aiEngineInstance.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [`Generate active recall flashcards from notes:\n${notes}`],
            config: { systemInstruction: systemInstructions, responseMimeType: "application/json" }
        });
        resultText = response.text;
    } else {
        const model = aiEngineInstance.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const resWrap = await model.generateContent(`${systemInstructions}\n\nNotes:\n${notes}`);
        resultText = resWrap.response.text();
    }

    res.json(JSON.parse(resultText.replace(/```json/g, '').replace(/```/g, '').trim()));
  } catch (e) { res.status(500).json({ error: "Flashcard processing error." }); }
});

app.post('/api/summarize-notes', ensureAuthenticated, async (req, res) => {
  try {
    const { notes } = req.body;
    let summaryOut = "";

    if (isNewSDK) {
        const resp = await aiEngineInstance.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [`Convert notes cleanly into an organized text outline summary structural layout:\n${notes}`]
        });
        summaryOut = resp.text;
    } else {
        const model = aiEngineInstance.getGenerativeModel({ model: "gemini-1.5-flash" });
        const resp = await model.generateContent(`Convert notes cleanly into an organized text outline summary structural layout:\n${notes}`);
        summaryOut = resp.response.text();
    }

    res.json({ summary: summaryOut || "Summary layout failed." });
  } catch (e) { res.status(500).json({ error: "Summarizer system exception." }); }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`\n🚀 Secure Full-Stack Hub running locally on: http://localhost:${PORT}`));
}

module.exports = app;