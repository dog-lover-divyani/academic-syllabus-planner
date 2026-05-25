const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai'); 
const path = require('path');
const fs = require('fs'); // Built-in filesystem to act as our database driver
require('dotenv').config();

const app = express();

// Middleware config
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Path to our local JSON database file
const HISTORY_FILE = path.join(__dirname, 'history.json');

// Configure multer for temporary memory buffers
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB Limit Max
});

// Initialize the free Gemini API instance using your renamed key token
const ai = new GoogleGenAI({ apiKey: process.env.EDUTRACK_API_KEY });

// ROUTE 1: Handle syllabus text parsing & map structured schedules
app.post('/api/parse-syllabus', upload.single('syllabus'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a syllabus file." });
    }
    
    const { examDate, weeklyHours } = req.body;
    if (!examDate || !weeklyHours) {
      return res.status(400).json({ error: "Missing required timeline parameters." });
    }

    let contentsPayload = [];
    const systemInstructions = `You are an elite academic advisor. Break down this syllabus into a strict week-by-week study timeline.
    Factor in the student's exam date: ${examDate} and capacity parameters: ${weeklyHours} hours per week.
    You must respond ONLY with a valid JSON object matching the requested schema.`;

    const jsonSchema = {
      type: "OBJECT",
      properties: {
        courseName: { type: "STRING" },
        totalEstimatedWeeks: { type: "NUMBER" },
        schedule: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              week: { type: "NUMBER" },
              topicTitle: { type: "STRING" },
              estimatedHours: { type: "NUMBER" },
              subtopics: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["week", "topicTitle", "estimatedHours", "subtopics"]
          }
        }
      },
      required: ["courseName", "totalEstimatedWeeks", "schedule"]
    };

    let rawText = "";
    try {
      const pdfData = await pdfParse(req.file.buffer);
      rawText = pdfData.text;
    } catch (e) {
      console.log("⚠️ Standard text extraction failed, using fallback...");
    }

    if (!rawText || rawText.trim().length === 0) {
      console.log("📸 Processing document visually via direct base64 stream.");
      contentsPayload = [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: req.file.buffer.toString("base64")
          }
        },
        "Extract curriculum information directly out of this raw document file asset and map the structured layout."
      ];
    } else {
      console.log("📝 Processing text payload string directly.");
      contentsPayload = [`Syllabus text dataset to parse:\n${rawText}`];
    }

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contentsPayload,
      config: {
        systemInstruction: systemInstructions,
        responseMimeType: "application/json",
        responseSchema: jsonSchema
      }
    });

    const structuredSchedule = JSON.parse(aiResponse.text);

    // PERSISTENCE AGENT: Automatically commit this schedule into our history file array
    try {
      let currentHistory = [];
      if (fs.existsSync(HISTORY_FILE)) {
        const fileData = fs.readFileSync(HISTORY_FILE, 'utf-8');
        currentHistory = JSON.parse(fileData || '[]');
      }
      
      // Inject meta tags for frontend referencing
      const historicalEntry = {
        id: Date.now().toString(), 
        timestamp: new Date().toLocaleDateString(),
        examDate: examDate,
        weeklyHours: weeklyHours,
        data: structuredSchedule
      };
      
      currentHistory.unshift(historicalEntry); 
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(currentHistory, null, 2), 'utf-8');
      console.log(`💾 Persisted "${structuredSchedule.courseName}" plan to history database entry point.`);
    } catch (fsErr) {
      console.error("⚠️ History persistence wrapper failed:", fsErr);
    }

    res.json(structuredSchedule);

  } catch (error) {
    console.error("❌ Gemini Syllabus parsing error:", error);
    res.status(500).json({ error: "An error occurred while generating your schedule." });
  }
});

// ROUTE 2: Fetch full historical schedule array records
app.get('/api/history', (req, res) => {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      return res.json([]);
    }
    const fileData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(fileData || '[]');
    res.json(history);
  } catch (error) {
    console.error("❌ History retrieval error:", error);
    res.status(500).json({ error: "Failed to read history logs." });
  }
});

// ROUTE 3: Generate dynamic flashcards based on user notes
app.post('/api/generate-flashcards', async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes || notes.trim().length < 15) {
      return res.status(400).json({ error: "Notes content is too short to extract flashcards." });
    }

    const systemInstructions = `You are a strict active-recall assistant. 
    Analyze the user's study notes and generate a set of high-yield flashcards.
    Extract the core definitions, formulas, and concepts. Keep questions concise and answers definitive.
    You must respond ONLY with a valid JSON array matching the requested schema.`;

    const jsonSchema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          q: { type: "STRING" },
          a: { type: "STRING" }
        },
        required: ["q", "a"]
      }
    };

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate custom flashcards based on these study notes:\n${notes}`,
      config: {
        systemInstruction: systemInstructions,
        responseMimeType: "application/json",
        responseSchema: jsonSchema
      }
    });

    res.json(JSON.parse(aiResponse.text));
  } catch (error) {
    console.error("❌ Flashcard Generation Endpoint Error:", error);
    res.status(500).json({ error: "Failed to generate dynamic flashcards." });
  }
});

// ROUTE 4: Intelligent AI Summary Generator (Handles Messy Shorthand)
app.post('/api/summarize-notes', async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes || notes.trim().length < 10) {
      return res.status(400).json({ error: "Please write some notes to summarize first." });
    }

    console.log("⚡ Formulating summary from study workspace...");

    const systemInstructions = `You are an expert academic editor. Convert the user's messy study notes entirely into a highly readable, clear plain-text layout. 
    Do not output markdown characters like asterisks (**), hashtags (#), or backticks. Use clean spacing and standard bullet points (-) for clarity.`;

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Deconstruct, expand shorthand, and summarize these notes:\n${notes}`,
      config: { systemInstruction: systemInstructions }
    });

    const plainTextSummary = aiResponse.text || "Could not generate summary text.";
    res.json({ summary: plainTextSummary });

  } catch (error) {
    console.error("❌ Summarizer Processing Error:", error);
    res.status(500).json({ error: "Failed to generate AI summary context." });
  }
});

module.exports = app;

// ==========================================================================
// GUARANTEED LOCAL LISTENER BOOT ENGINE
// ==========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 EduTrack Engine Successfully Armed!`);
  console.log(`Local development hub active on: http://localhost:${PORT}\n`);
});