const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai'); 
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Upgraded to 10MB to support heavier structural PDFs smoothly
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

    // Attempt text extraction first
    let rawText = "";
    try {
      const pdfData = await pdfParse(req.file.buffer);
      rawText = pdfData.text;
    } catch (e) {
      console.log("⚠️ Standard text extraction failed, falling back to direct native processing...");
    }

    // FALLBACK ENGINE: If text is empty or corrupted, pass the raw file directly to Gemini's multi-modal engine
    if (!rawText || rawText.trim().length === 0) {
      console.log("📸 Multi-modal parsing active: Processing document via direct buffer stream.");
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
      console.log("📝 Text extraction successful: Processing text payload string directly.");
      contentsPayload = [`Syllabus text dataset to parse:\n${rawText}`];
    }

    // Execution request layout matching official SDK design rules
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
    res.json(structuredSchedule);

  } catch (error) {
    console.error("\n❌ Gemini Backend Processing Error:\n", error);
    res.status(500).json({ error: "An error occurred while generating your schedule." });
  }
});

// ==========================================================================
// NEW ROUTE: Generate Dynamic Flashcards From Client Notes
// ==========================================================================
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

    // Strict array schema layout
    const jsonSchema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          q: { type: "STRING" }, // The Question
          a: { type: "STRING" }  // The Answer
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

    const flashcardsArray = JSON.parse(aiResponse.text);
    res.json(flashcardsArray);

  } catch (error) {
    console.error("❌ Flashcard Generation Error:", error);
    res.status(500).json({ error: "Failed to generate dynamic flashcards." });
  }
});

// ==========================================================================
// NEW ROUTE: Intelligent AI Summary Generator (Handles Messy Shorthand)
// ==========================================================================
app.post('/api/summarize-notes', async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes || notes.trim().length < 10) {
      return res.status(400).json({ error: "Please write or paste some notes to summarize first." });
    }

    console.log("⚡ Formulating intelligent, structured summary from study workspace...");

    const systemInstructions = `You are an expert academic editor specializing in study optimization. 
    The user will provide messy study notes that may contain shortcuts, abbreviations, missing punctuation, or incomplete thoughts.
    
    Your mission:
    1. Understand the student's shorthand shortcuts and expand them cleanly into formal concepts.
    2. Format the response into a beautifully organized, highly readable summary using clean Markdown structure.
    3. Use bolding, bullet points, and short distinct sections (e.g., "Core Definition", "Key Takeaways", "Crucial Milestones").
    Keep it actionable, crisp, and completely optimized for fast studying. Do not return raw code or JSON wrap this response; return raw text with standard markdown layout markers.`;

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Deconstruct, expand shorthand, and summarize these messy student notes:\n${notes}`,
      config: {
        systemInstruction: systemInstructions
        // Not enforcing JSON schema here because standard Markdown strings offer better structural notes layouts!
      }
    });

    res.json({ summary: aiResponse.text });

  } catch (error) {
    console.error("❌ Summarizer Processing Error:", error);
    res.status(500).json({ error: "Failed to generate AI summary context." });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Local development hub active on: http://localhost:${PORT}`));
}