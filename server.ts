import express, { Request } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { MongoClient, ObjectId } from "mongodb";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import multer from "multer";
import * as pdf from "pdf-parse";

// Define a type for the multer request
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// Environment variables check
const MONGODB_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Setup Multer for PDF uploads
const upload = multer({ storage: multer.memoryStorage() });

// Lazy-initialized clients
let mongoClient: MongoClient | null = null;
let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

async function getServices() {
  if (!mongoClient && MONGODB_URI) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
  }
  if (!openai && OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  if (!anthropic && ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return { 
    db: mongoClient?.db("synthesis"), 
    openai, 
    anthropic 
  };
}

// Ingest text source
async function processAndIngest(text: string, sourceName: string, db: any, openai: any) {
  // Simple chunking logic (1000 chars roughly)
  const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
  const processedChunks = [];
  let currentChunk = "";
  
  for (const sentence of chunks) {
    if ((currentChunk + sentence).length > 800) {
      processedChunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk) processedChunks.push(currentChunk.trim());

  // Use a unique batch ID for this source ingestion to group chunks if needed
  const sourceId = new ObjectId();

  // Generate embeddings and store
  for (const content of processedChunks) {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: content,
    });

    await db.collection("chunks").insertOne({
      source: sourceName,
      sourceId: sourceId,
      content,
      embedding: response.data[0].embedding,
      createdAt: new Date(),
    });
  }
  return processedChunks.length;
}

app.post("/api/ingest", async (req, res) => {
  try {
    const { text, sourceName } = req.body;
    if (!text || !sourceName) return res.status(400).json({ error: "Missing text or sourceName" });

    const { db, openai } = await getServices();
    if (!db || !openai) throw new Error("Services not configured");

    const count = await processAndIngest(text, sourceName, db, openai);
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PDF Ingest
app.post("/api/ingest-pdf", upload.single("file"), async (req: MulterRequest, res) => {
  try {
    const { sourceName } = req.body;
    if (!req.file || !sourceName) return res.status(400).json({ error: "Missing file or sourceName" });

    const { db, openai } = await getServices();
    if (!db || !openai) throw new Error("Services not configured");

    // pdf-parse can sometimes be exported differently in ESM
    const pdfData = await (pdf as any)(req.file.buffer);
    const count = await processAndIngest(pdfData.text, sourceName, db, openai);
    
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List Sources (Knowledge Base)
app.get("/api/sources", async (req, res) => {
  try {
    const { db } = await getServices();
    if (!db) throw new Error("Database not connected");

    // Group by sourceName/sourceId to list distinct documents
    const sources = await db.collection("chunks").aggregate([
      {
        $group: {
          _id: "$sourceId",
          name: { $first: "$source" },
          sample: { $first: "$content" },
          chunkCount: { $sum: 1 },
          createdAt: { $max: "$createdAt" }
        }
      },
      { $sort: { createdAt: -1 } }
    ]).toArray();

    res.json(sources);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Source
app.delete("/api/sources/:id", async (req, res) => {
  try {
    const { db } = await getServices();
    if (!db) throw new Error("Database not connected");
    
    const result = await db.collection("chunks").deleteMany({ sourceId: new ObjectId(req.params.id) });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update Source
app.patch("/api/sources/:id", async (req, res) => {
  try {
    const { text, sourceName } = req.body;
    const { db, openai } = await getServices();
    if (!db || !openai) throw new Error("Services not configured");

    // Re-ingesting is cleaner than manually patching chunks if text changed significantly
    // Delete old
    await db.collection("chunks").deleteMany({ sourceId: new ObjectId(req.params.id) });
    // Ingest new (giving it a new ID but user sees it as "editing" the same conceptual doc)
    const count = await processAndIngest(text, sourceName, db, openai);

    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Research and Synthesis (Stream)
app.get("/api/research", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).write("data: " + JSON.stringify({ error: "Missing query" }) + "\n\n");

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendStatus = (status: string) => {
    res.write(`data: ${JSON.stringify({ status })}\n\n`);
  };

  try {
    const { db, openai, anthropic } = await getServices();
    if (!db || !openai || !anthropic) throw new Error("Services not configured");

    let currentQuery = query;
    let iterations = 0;
    let finalResults: any[] = [];
    let sufficient = false;

    while (!sufficient && iterations < 3) {
      iterations++;
      sendStatus("Searching corpus...");
      
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: currentQuery,
      });
      const embedding = embeddingResponse.data[0].embedding;

      // MongoDB Vector Search
      const results = await db.collection("chunks").aggregate([
        {
          "$vectorSearch": {
            "index": "embedding",
            "path": "embedding",
            "queryVector": embedding,
            "numCandidates": 100,
            "limit": 5
          }
        }
      ]).toArray();

      finalResults = results;
      
      sendStatus("Evaluating results...");
      const evaluation = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        system: "Evaluate if the provided text chunks are sufficient to answer the user query. Reply in JSON: { sufficient: boolean, reformulatedQuery: string | null }",
        messages: [{ 
          role: "user", 
          content: `Query: ${query}\n\nChunks:\n${results.map(r => r.content).join("\n---\n")}` 
        }],
      });

      const evalData = JSON.parse((evaluation.content[0] as any).text);
      sufficient = evalData.sufficient;
      if (!sufficient && evalData.reformulatedQuery) {
        sendStatus("Reformulating query...");
        currentQuery = evalData.reformulatedQuery;
      }
    }

    sendStatus("Identifying contradictions...");
    const conflictsResponse = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      system: "Identify any direct contradictions between the provided text segments. If none, return empty list. Reply in JSON: { conflicts: string[] }",
      messages: [{ 
        role: "user", 
        content: `Chunks:\n${finalResults.map(r => r.content).join("\n---\n")}` 
      }],
    });
    const conflicts = JSON.parse((conflictsResponse.content[0] as any).text).conflicts;

    sendStatus("Drafting...");
    const draftResponse = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      system: "Synthesis a grounded, professional draft based only on the provided chunks. Use markdown.",
      messages: [{ 
        role: "user", 
        content: `User Request: ${query}\n\nEvidence:\n${finalResults.map(r => r.content).join("\n---\n")}` 
      }],
    });

    const draft = (draftResponse.content[0] as any).text;

    res.write(`data: ${JSON.stringify({ 
      done: true, 
      draft, 
      conflicts,
      sources: [...new Set(finalResults.map(r => r.source))] 
    })}\n\n`);
    res.end();

  } catch (error: any) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
