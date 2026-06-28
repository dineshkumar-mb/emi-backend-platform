import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import Document from '../models/Document.js';
import DocumentChunk from '../models/DocumentChunk.js';
import { getQueue, registerWorker } from '../utils/queueManager.js';

const RAG_QUEUE_NAME = 'rag_indexing';

// Check if API key is invalid or reported as leaked
const isInvalidOrLeakedKey = (key) => {
  if (!key || key === 'PLACEHOLDER') return true;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return hash === 'd81f6b86a712c52ac4f1ae959aebea377e196fa4947255f1098ae835404c57ec';
};

/**
 * Helper to compute SHA256 hash of a string
 */
export const generateHash = (text) => {
  return crypto.createHash('sha256').update(text).digest('hex');
};

/**
 * Generate embedding using Gemini's text-embedding-004
 */
export const getEmbedding = async (text) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (isInvalidOrLeakedKey(apiKey)) {
    // Return mock 768-dimension vector when API key is leaked/missing
    return new Array(768).fill(0);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  if (!result || !result.embedding || !result.embedding.values) {
    throw new Error('Failed to generate embedding from Gemini API.');
  }
  return result.embedding.values;
};

/**
 * Simple recursive/character splitter with paragraph preservation and overlap.
 */
export const chunkText = (text, chunkSize = 800, chunkOverlap = 150) => {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + chunkSize;
    if (end < text.length) {
      // Find space or newline near the boundary to avoid breaking words
      const lastSpace = text.lastIndexOf(' ', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const splitAt = Math.max(lastSpace, lastNewline);
      if (splitAt > start + (chunkSize * 0.5)) {
        end = splitAt;
      }
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end - chunkOverlap;
    if (start >= text.length - chunkOverlap) break;
  }
  return chunks;
};

/**
 * Dot product utility for normalized vectors (cosine similarity)
 */
const dotProduct = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
};

/**
 * Extract content from PDFs, CSVs, or images using gemini-2.5-flash
 */
export const extractTextWithGemini = async (buffer, mimeType) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (isInvalidOrLeakedKey(apiKey)) {
    throw new Error('PDF, CSV, or Image document indexing requires a valid GEMINI_API_KEY. Please upload a plain text (.txt or .md) file for offline/fallback mode.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  
  const prompt = `Extract all readable text and structural content from this document. Output the content cleanly in Markdown format. Keep the original text intact without summaries or omissions. If it's a spreadsheet or table, render it as a markdown table.`;
  
  const filePart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType: mimeType
    }
  };

  const result = await model.generateContent([prompt, filePart]);
  return result.response.text().trim();
};

/**
 * Main ingestion controller - process file, chunk it, embed (with cache lookup), and store in DB.
 */
export const processAndIndexDocument = async (userId, documentId, filename, buffer, mimeType) => {
  try {
    let rawText = '';
    const textMimeTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];
    
    if (textMimeTypes.includes(mimeType) || mimeType.startsWith('text/')) {
      rawText = buffer.toString('utf8');
    } else {
      // Use Gemini to extract text from PDF, Image, etc.
      rawText = await extractTextWithGemini(buffer, mimeType);
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new Error('No text content could be extracted from the document.');
    }

    // Split text into chunks
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw new Error('Document resulted in 0 text chunks.');
    }

    // Embed chunks
    const chunkDocs = [];
    const batchSize = 5; // process in batches of 5 to avoid API rate limits
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      const embeddingPromises = batch.map(async (text) => {
        const contentHash = generateHash(text);
        
        // Caching Check: Find any indexed chunk (even from other documents) with matching hash
        const cachedChunk = await DocumentChunk.findOne({
          contentHash,
          embedding: { $exists: true, $not: { $size: 0 } }
        });
        
        if (cachedChunk && cachedChunk.embedding && cachedChunk.embedding.length > 0) {
          console.log(`[RAG Embedding Cache] Cache HIT for chunk hash ${contentHash.substring(0, 8)}...`);
          return cachedChunk.embedding;
        }
        
        // Cache miss: Generate embedding
        console.log(`[RAG Embedding Cache] Cache MISS for chunk. Fetching new embedding.`);
        return getEmbedding(text);
      });

      const embeddings = await Promise.all(embeddingPromises);
      
      batch.forEach((text, index) => {
        const contentHash = generateHash(text);
        chunkDocs.push({
          userId,
          documentId,
          documentName: filename,
          content: text,
          contentHash,
          embedding: embeddings[index],
          metadata: {
            chunkIndex: i + index,
            totalChunks: chunks.length,
          }
        });
      });
    }

    // Save chunks to DB
    await DocumentChunk.insertMany(chunkDocs);

    // Update document status
    await Document.findByIdAndUpdate(documentId, {
      status: 'indexed',
      chunkCount: chunks.length,
    });

    console.log(`[RAG Service] Successfully indexed document ${filename} for user ${userId}. Chunks: ${chunks.length}`);
  } catch (error) {
    console.error(`[RAG Service] Error indexing document ${filename}:`, error);
    await Document.findByIdAndUpdate(documentId, {
      status: 'failed',
      errorMessage: error.message,
    });
  }
};

/**
 * Register Background Queue Worker
 */
registerWorker(RAG_QUEUE_NAME, async (job) => {
  const { userId, documentId, filename, fileBase64, mimeType } = job.data;
  console.log(`[RAG Indexing Worker] Processing job for document: ${filename}`);
  const buffer = Buffer.from(fileBase64, 'base64');
  await processAndIndexDocument(userId, documentId, filename, buffer, mimeType);
});

/**
 * Queue a document for indexing in the background job queue
 */
export const queueDocumentIndexing = async (userId, documentId, filename, buffer, mimeType) => {
  const queue = getQueue(RAG_QUEUE_NAME);
  const fileBase64 = buffer.toString('base64');
  
  await queue.add('index_document', {
    userId,
    documentId,
    filename,
    fileBase64,
    mimeType
  });
  console.log(`[RAG Service] Queued indexing task for document ${filename}.`);
};

/**
 * Retrieve top k relevant chunks matching the query using cosine similarity or keyword fallback
 * Returns: { chunks: Array, retrievalStatus: "matched" | "no_match" }
 */
export const retrieveRelevantChunks = async (userId, query, k = 4) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const isLeaked = isInvalidOrLeakedKey(apiKey);
    
    // Find all chunks belonging to this user
    const chunks = await DocumentChunk.find({ userId });
    if (chunks.length === 0) {
      return { chunks: [], retrievalStatus: 'no_match' };
    }

    let scoredChunks = [];

    if (isLeaked) {
      // Use keyword matching (sparse retrieval fallback)
      console.warn('[RAG Service] GEMINI_API_KEY is leaked/placeholder. Falling back to keyword search.');
      const stopwords = new Set(['the', 'what', 'are', 'is', 'in', 'and', 'for', 'with', 'this', 'that', 'from', 'you', 'your', 'about', 'who', 'how', 'why', 'where', 'when', 'which', 'was', 'were', 'been', 'has', 'have', 'had', 'does', 'do', 'did', 'but', 'not', 'can', 'will', 'would', 'should', 'could', 'out', 'our', 'their', 'them', 'these', 'those', 'then', 'than']);
      const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stopwords.has(w));
      
      scoredChunks = chunks.map(chunk => {
        const contentLower = chunk.content.toLowerCase();
        let score = 0;
        queryWords.forEach(word => {
          if (contentLower.includes(word)) {
            score += 1;
          }
        });
        
        // Normalize score between 0 and 1 for fallback output consistency
        const wordMatchRatio = queryWords.length > 0 ? score / queryWords.length : 0;
        return { chunk, similarity: wordMatchRatio };
      });
    } else {
      // Use dense vector similarity search
      const queryEmbedding = await getEmbedding(query);
      scoredChunks = chunks.map(chunk => {
        const similarity = dotProduct(queryEmbedding, chunk.embedding);
        return { chunk, similarity };
      });
    }

    // Sort by similarity descending
    scoredChunks.sort((a, b) => b.similarity - a.similarity);

    // 1. Deduplicate by contentHash to prevent duplicate text blocks from wasting context tokens
    const uniqueScoredChunks = [];
    const seenHashes = new Set();
    for (const item of scoredChunks) {
      if (!seenHashes.has(item.chunk.contentHash)) {
        seenHashes.add(item.chunk.contentHash);
        uniqueScoredChunks.push(item);
      }
    }

    // 2. Filter by Configurable Similarity Threshold
    const VECTOR_MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY || 0.70);
    const KEYWORD_MIN_SIMILARITY = Number(process.env.RAG_KEYWORD_MIN_SIMILARITY || 0.25);
    const minThreshold = isLeaked ? KEYWORD_MIN_SIMILARITY : VECTOR_MIN_SIMILARITY;

    const filteredChunks = uniqueScoredChunks.filter(item => item.similarity >= minThreshold);

    const resultChunks = filteredChunks.slice(0, k).map(item => ({
      content: item.chunk.content,
      documentName: item.chunk.documentName,
      similarity: Number(item.similarity.toFixed(4)),
      contentHash: item.chunk.contentHash
    }));

    return {
      chunks: resultChunks,
      retrievalStatus: resultChunks.length > 0 ? 'matched' : 'no_match'
    };
  } catch (error) {
    console.error('[RAG Service] Error retrieving relevant chunks:', error.message);
    return { chunks: [], retrievalStatus: 'no_match' }; // Graceful fallback
  }
};
