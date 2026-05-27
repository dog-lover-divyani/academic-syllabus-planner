const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai'); 
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
require('dotenv').config();

// Import the database models we created in Step 4
const { User, StudyPlan } = require('./models');

const app = express();

// ==========================================================================
// LOCAL DATABASE CONNECTION
// ==========================================================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('🍃 Connected cleanly to local MongoDB via Compass address.'))
  .catch(err => console.error('❌ MongoDB local connection failure:', err));

// Middleware config
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Protected Session Cookies
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // Session lasts 24 hours
}));

// Initialize Passport Strategies
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await User.findOne({ username });
    if (!user) return done(null, false, { message: 'Incorrect username.' });
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return done(null, false, { message: 'Incorrect password.' });
    
    return done(null, user);
  } catch (err) { return done(err); }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { const user = await User.findById(id); done(null, user); } 
  catch (err) { done(err); }
});

// AUTH SHIELD MIDDLEWARE: Prevents logged-out users from touching secure data endpoints
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized access. Please register or log in first." });
};

// Configure Multer for File Upload Buffers
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Initialize Gemini API via your custom key name
const ai = new GoogleGenAI({ apiKey: process.env.EDUTRACK_API_KEY });

// ==========================================================================
// ENCRYPTED AUTHENTICATION API ENDPOINTS
// ==========================================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Provide both username and password." });
    
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: "Username already taken." });

    const newUser = new User({ username, password });
    await newUser.save();
    
    req.login(newUser, err => {
      if (err) return res.status(500).json({ error: "Auto-login engine failed." });
      res.json({ success: true, user: { username: newUser.username } });
    });
  } catch (err) { res.status(500).json({ error: "Registration sequence errored." }); }
});

app.post('/api/auth/login', passport.authenticate('local'), (req, res) => {
  res.json({ success: true, user: { username: req.user.username } });
});

app.post('/api/auth/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.json({ success: true });
  });
});

app.get('/api/auth/session', (req, res) => {
  if (req.isAuthenticated()) res.json({ loggedIn: true, username: req.user.username });
  else res.json({ loggedIn: false });
});

// ==========================================================================
// CORE SECURED PLATFORM INSTANCE ROUTES (Tied to req.user._id)
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
    } catch (e) { /* visual fallback trigger checking */ }

    if (!rawText || rawText.trim().length === 0) {
      contentsPayload = [{ inlineData: { mimeType: "application/pdf", data: req.file.buffer.toString("base64") } }, "Extract curriculum information directly out of this raw document file asset and map the structured layout."];
    } else {
      contentsPayload = [`Syllabus text dataset to parse:\n${rawText}`];
    }

    const systemInstructions = `You are an elite academic advisor. Break down this syllabus into a strict week-by-week study timeline. Factor in date: ${examDate} and hours: ${weeklyHours}. Respond ONLY with a valid JSON object matching the standard layout structure schema.`;
    const jsonSchema = { type: "OBJECT", properties: { courseName: { type: "STRING" }, totalEstimatedWeeks: { type: "NUMBER" }, schedule: { type: "ARRAY", items: { type: "OBJECT", properties: { week: { type: "NUMBER" }, topicTitle: { type: "STRING" }, estimatedHours: { type: "NUMBER" }, subtopics: { type: "ARRAY", items: { type: "STRING" } } }, required: ["week", "topicTitle", "estimatedHours", "subtopics"] } } }, required: ["courseName", "totalEstimatedWeeks", "schedule"] };

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contentsPayload,
      config: { systemInstruction: systemInstructions, responseMimeType: "application/json", responseSchema: jsonSchema }
    });

    const structuredSchedule = JSON.parse(aiResponse.text);

    // SECURE LOCAL REPOSITORY COMMIT: Automatically save the plan under the logged-in User's ID
    const newPlan = new StudyPlan({
        userId: req.user._id,
        examDate,
        weeklyHours,
        data: structuredSchedule
    });
    await newPlan.save();

    res.json(structuredSchedule);
  } catch (error) { 
    console.error("Parsing Failure:", error);
    res.status(500).json({ error: "Generation processing exception." }); 
  }
});

app.get('/api/history', ensureAuthenticated, async (req, res) => {
  try {
    // SECURITY WALL: Pull only the documents matching the active account ID
    const records = await StudyPlan.find({ userId: req.user._id }).sort({ _id: -1 });
    res.json(records);
  } catch (error) { res.status(500).json({ error: "Failed to read database records." }); }
});

app.post('/api/generate-flashcards', ensureAuthenticated, async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes || notes.trim().length < 15) return res.status(400).json({ error: "Notes content is too short." });

    const systemInstructions = `You are a strict active-recall assistant. Respond ONLY with a valid JSON array matching the requested schema.`;
    const jsonSchema = { type: "ARRAY", items: { type: "OBJECT", properties: { q: { type: "STRING" }, a: { type: "STRING" } }, required: ["q", "a"] } };

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate custom flashcards based on these notes:\n${notes}`,
      config: { systemInstruction: systemInstructions, responseMimeType: "application/json", responseSchema: jsonSchema }
    });
    res.json(JSON.parse(aiResponse.text));
  } catch (e) { res.status(500).json({ error: "Flashcard processing error." }); }
});

app.post('/api/summarize-notes', ensureAuthenticated, async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes || notes.trim().length < 10) return res.status(400).json({ error: "Provide notes to summarize." });

    const systemInstructions = `You are an expert academic editor. Convert the notes into a clear plain-text layout. Do not use markdown characters like hashes or asterisks.`;
    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Summarize these notes:\n${notes}`,
      config: { systemInstruction: systemInstructions }
    });
    res.json({ summary: aiResponse.text || "Summary failed." });
  } catch (e) { res.status(500).json({ error: "Summarization processing error." }); }
});

// ==========================================================================
// LOCAL PORT LISTEN ENGAGEMENT
// ==========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Secure Full-Stack Hub running on: http://localhost:${PORT}`);
  console.log(`Open your browser to test your local implementation.\n`);
});