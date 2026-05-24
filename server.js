const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware for parsing JSON JSON payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer to store files in memory (RAM buffer) instead of disk
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Limit files to 5MB max
});

// Initialize OpenAI Instance
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ROUTE 1: Handle Syllabus Upload & AI Processing
app.post('/api/parse-syllabus', upload.single('syllabus'), async (req, res) => {
  try {
    // 1. Validation checks
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a syllabus file." });
    }
    
    const { examDate, weeklyHours } = req.body;
    if (!examDate || !weeklyHours) {
      return res.status(400).json({ error: "Missing required timeline parameters." });
    }

    // 2. Extract raw text directly out of the memory buffer
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text;

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from this PDF file. Is it an scanned image?" });
    }

    // 3. Construct the prompt for OpenAI
    const systemPrompt = `You are an elite academic planner. Your goal is to break down a messy syllabus into a strict week-by-week study schedule.
    Calculate the time requirement based on the target exam date: ${examDate} and the student's study allocation: ${weeklyHours} hours per week.
    You must respond ONLY with a valid JSON object matching this schema exactly:
    {
      "courseName": "Extract Course Name or Title",
      "totalEstimatedWeeks": 4,
      "schedule": [
        {
          "week": 1,
          "topicTitle": "Topic title here",
          "estimatedHours": 6,
          "subtopics": ["Subtopic A", "Subtopic B"]
        }
      ]
    }`;

    // 4. Send payloads to LLM via Structured Output Mode
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost-effective, high speed, great structure parser
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Syllabus text content to categorize:\n${rawText}` }
      ],
      response_format: { type: "json_object" }
    });

    // 5. Parse output and return back to the student browser client
    const structuredSchedule = JSON.parse(aiResponse.choices[0].message.content);
    res.json(structuredSchedule);

  } catch (error) {
    console.error("Backend Core Error:", error);
    res.status(500).json({ error: "Internal processing error occurred while parsing syllabus." });
  }
});

// Export server for Vercel's serverless pipeline handler
module.exports = app;

// Local runner loop fallback mechanism (If not hosted on cloud environment)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Local development hub active on: http://localhost:${PORT}`));
}