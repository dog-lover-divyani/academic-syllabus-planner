const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai'); // Official Google GenAI SDK
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware config
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer to hold files entirely inside temporary RAM buffers
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit Max
});

// Initialize the free Gemini API instance
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// CORE ROUTE: Handle syllabus text parsing & map structured schedules
app.post('/api/parse-syllabus', upload.single('syllabus'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a syllabus file." });
    }
    
    const { examDate, weeklyHours } = req.body;
    if (!examDate || !weeklyHours) {
      return res.status(400).json({ error: "Missing required timeline parameters." });
    }

    // Extract text layout straight out of memory buffer
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text;

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from this PDF file." });
    }

    const systemInstructions = `You are an elite academic advisor. Break down this messy syllabus text into a strict week-by-week study timeline.
    Factor in the student's exam date: ${examDate} and capacity parameters: ${weeklyHours} hours per week.
    You must respond ONLY with a valid JSON object matching the requested schema.`;

    // Enforce strict JSON object output configuration structure
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

    // Trigger Generation call using the incredibly fast, free gemini-2.5-flash engine
    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Syllabus text dataset to parse:\n${rawText}`,
      config: {
        systemInstruction: systemInstructions,
        responseMimeType: "application/json",
        responseSchema: jsonSchema
      }
    });

    // Parse output string cleanly and respond back to the browser client interface
    const structuredSchedule = JSON.parse(aiResponse.text);
    res.json(structuredSchedule);

  } catch (error) {
    console.error("Gemini Backend Processing Error:", error);
    res.status(500).json({ error: "An error occurred while generating your schedule." });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Local development hub active on: http://localhost:${PORT}`));
}