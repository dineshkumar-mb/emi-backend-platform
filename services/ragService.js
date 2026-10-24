import { GoogleGenerativeAI } from '@google/generative-ai';
import { chromaService } from './chromaClient.js';
import Document from '../models/Document.js';
import { getGeminiApiKey, isInvalidOrLeakedKey } from './geminiService.js';

/**
 * Generate embedding using Gemini's text-embedding-004
 */
export const getEmbedding = async (text) => {
  const apiKey = getGeminiApiKey();
  if (isInvalidOrLeakedKey(apiKey)) {
    // Return mock 768-dimension vector when API key is leaked/missing
    return new Array(768).fill(0);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    if (!result || !result.embedding || !result.embedding.values) {
      return new Array(768).fill(0);
    }
    return result.embedding.values;
  } catch (err) {
    console.warn('[RAG] getEmbedding failed, returning fallback vector:', err.message);
    return new Array(768).fill(0);
  }
};

/**
 * Extract content from PDFs, CSVs, or images using gemini-2.5-flash
 * with fallback to local PDF and text parsing
 */
export const extractTextWithGemini = async (buffer, mimeType) => {
  const apiKey = getGeminiApiKey();
  if (isInvalidOrLeakedKey(apiKey)) {
    if (mimeType === 'application/pdf' || (buffer.length > 4 && buffer.slice(0, 4).toString('utf8') === '%PDF')) {
      try {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        return await parser.getText();
      } catch (err) {
        return buffer.toString('utf8');
      }
    }
    return buffer.toString('utf8');
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `Extract all readable text and structural content from this document cleanly.`;
    
    const filePart = {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: mimeType
      }
    };

    const result = await model.generateContent([prompt, filePart]);
    return result.response.text().trim();
  } catch (error) {
    console.warn('[RAG] extractTextWithGemini error, using fallback extractor:', error.message);
    if (mimeType === 'application/pdf' || (buffer.length > 4 && buffer.slice(0, 4).toString('utf8') === '%PDF')) {
      try {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        return await parser.getText();
      } catch (_) {}
    }
    return buffer.toString('utf8');
  }
};

/**
 * Background document indexing process
 */
export const queueDocumentIndexing = async (userId, docId, originalname, buffer, mimetype) => {
  try {
    console.log(`[DocumentIndexer] Starting indexing for document ${docId}`);
    
    // 1. Extract Text
    let text = '';
    if (mimetype === 'text/plain' || mimetype === 'text/markdown' || mimetype === 'text/csv') {
      text = buffer.toString('utf-8');
    } else {
      text = await extractTextWithGemini(buffer, mimetype);
    }
    
    // 2. Chunk text
    const chunks = [];
    const chunkSize = 1500;
    const overlap = 100;
    for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    
    // 3. Get embeddings and format for Chroma
    const collection = await chromaService.getCollection('user_documents');
    
    const ids = [];
    const embeddings = [];
    const metadatas = [];
    const documents = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.trim().length === 0) continue;
      
      const emb = await getEmbedding(chunk);
      
      ids.push(`doc_${docId}_chunk_${i}`);
      embeddings.push(emb);
      metadatas.push({ userId: userId.toString(), docId: docId.toString(), source: originalname, chunkIndex: i });
      documents.push(chunk);
    }
    
    if (ids.length > 0) {
      await collection.add({
        ids,
        embeddings,
        metadatas,
        documents
      });
    }
    
    // 4. Update Document status
    await Document.findByIdAndUpdate(docId, { status: 'indexed', chunkCount: chunks.length });
    console.log(`[DocumentIndexer] Successfully indexed document ${docId} with ${chunks.length} chunks.`);
    
  } catch (error) {
    console.error(`[DocumentIndexer] Error indexing document ${docId}:`, error);
    await Document.findByIdAndUpdate(docId, { status: 'failed' });
  }
};
