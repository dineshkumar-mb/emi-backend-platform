import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { getEmbedding, chunkText, retrieveRelevantChunks, generateHash } from './services/ragService.js';
import Document from './models/Document.js';
import DocumentChunk from './models/DocumentChunk.js';
import User from './models/User.js';
import { askAdvisorWithGemini } from './services/geminiService.js';
import { getQueue } from './utils/queueManager.js';

dotenv.config();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const runTest = async () => {
  console.log('--- STARTING COMPREHENSIVE RAG ENHANCEMENTS TEST ---');
  console.log(`Connecting to MongoDB...`);
  
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected successfully!');

    // Find or create test user
    let user = await User.findOne({ email: 'test-rag-refinements@emitracker.com' });
    if (!user) {
      user = await User.create({
        name: 'RAG Refined User',
        email: 'test-rag-refinements@emitracker.com',
        password: 'password123',
        income: 120000,
        expenses: 30000,
      });
    }
    console.log('Test User ID:', user._id);

    // Cleanup previous documents
    const oldDocs = await Document.find({ userId: user._id });
    for (const doc of oldDocs) {
      await DocumentChunk.deleteMany({ documentId: doc._id });
      await Document.deleteOne({ _id: doc._id });
    }
    console.log('Cleaned up previous test documents.');

    // ==========================================
    // PREPARATION: Ingest Documents (Original & Duplicate)
    // ==========================================
    const docContent = `
Axis Bank Foreclosure Policy:
1. Lock-in: Foreclosure is restricted for the first 6 months.
2. Charges: Axis Bank allows zero foreclosure charges after 12 months.
3. Partial Prepayment: Foreclosure fee is 3% if closed between 6 to 12 months.
    `;

    const docRecord = await Document.create({
      userId: user._id,
      name: 'axis_bank_rules.txt',
      fileSize: Buffer.byteLength(docContent),
      mimeType: 'text/plain',
      status: 'processing',
    });

    const duplicateDocRecord = await Document.create({
      userId: user._id,
      name: 'axis_bank_rules_dup.txt',
      fileSize: Buffer.byteLength(docContent),
      mimeType: 'text/plain',
      status: 'processing',
    });

    console.log('\nIndexing both original and duplicate documents in background...');
    const queue = getQueue('rag_indexing');
    
    // Add both to queue
    await queue.add('index_document', {
      userId: user._id.toString(),
      documentId: docRecord._id.toString(),
      filename: 'axis_bank_rules.txt',
      fileBase64: Buffer.from(docContent).toString('base64'),
      mimeType: 'text/plain'
    });

    await queue.add('index_document', {
      userId: user._id.toString(),
      documentId: duplicateDocRecord._id.toString(),
      filename: 'axis_bank_rules_dup.txt',
      fileBase64: Buffer.from(docContent).toString('base64'),
      mimeType: 'text/plain'
    });

    // Poll until indexed
    for (let attempt = 0; attempt < 15; attempt++) {
      await sleep(1000);
      const doc1 = await Document.findById(docRecord._id);
      const doc2 = await Document.findById(duplicateDocRecord._id);
      console.log(`Polling status: Doc1=${doc1.status}, Doc2=${doc2.status}`);
      if (doc1.status === 'indexed' && doc2.status === 'indexed') {
        break;
      }
    }

    // ==========================================
    // TEST 1: Deduplication by contentHash
    // ==========================================
    console.log('\n--- TEST 1: Deduplication Check ---');
    const query1 = 'What are the foreclosure charges for Axis Bank?';
    console.log(`Query: "${query1}"`);
    
    const { chunks: chunks1, retrievalStatus: status1 } = await retrieveRelevantChunks(user._id, query1, 4);
    console.log(`Status: ${status1}, Retrieved Chunks Count: ${chunks1.length}`);
    chunks1.forEach((c, i) => console.log(` - Chunk ${i+1} from [${c.documentName}]: "${c.content.substring(0, 50)}..."`));

    if (chunks1.length === 1) {
      console.log('✅ Deduplication succeeded! Only 1 unique chunk returned despite duplicate document ingestion.');
    } else {
      console.error(`❌ Deduplication failed. Expected 1 unique chunk, got ${chunks1.length}`);
    }

    // ==========================================
    // TEST 2: Thresholding on Unrelated Noise
    // ==========================================
    console.log('\n--- TEST 2: Thresholding on Unrelated Noise ---');
    const queryNoise = 'What is the weather in Delhi?';
    console.log(`Query: "${queryNoise}"`);
    
    const { chunks: chunksNoise, retrievalStatus: statusNoise } = await retrieveRelevantChunks(user._id, queryNoise, 4);
    console.log(`Status: ${statusNoise}, Retrieved Chunks Count: ${chunksNoise.length}`);

    if (statusNoise === 'no_match' && chunksNoise.length === 0) {
      console.log('✅ Noise filtering threshold verification succeeded! Unrelated query rejected.');
    } else {
      console.error(`❌ Noise filtering failed. Status: ${statusNoise}, chunks: ${chunksNoise.length}`);
    }

    // ==========================================
    // TEST 3: Borderline Similarity Test
    // ==========================================
    console.log('\n--- TEST 3: Borderline Similarity Test ---');
    const queryBorderline = 'Axis foreclosure fee';
    console.log(`Query: "${queryBorderline}"`);
    
    const { chunks: chunksBorder, retrievalStatus: statusBorder } = await retrieveRelevantChunks(user._id, queryBorderline, 4);
    console.log(`Status: ${statusBorder}, Retrieved Chunks Count: ${chunksBorder.length}`);
    
    if (statusBorder === 'matched' && chunksBorder.length > 0) {
      console.log(`✅ Borderline similarity match succeeded! (Similarity score: ${chunksBorder[0].similarity})`);
    } else {
      console.error(`❌ Borderline similarity match failed. Status: ${statusBorder}`);
    }

    // ==========================================
    // TEST 4: Grounded Advisor with No Match Prompt Directive
    // ==========================================
    console.log('\n--- TEST 4: Grounded Advisor (No Match Prompt Directive) ---');
    
    // Assemble context for noise query (should trigger 'no_match' branch)
    let context = 'No relevant document context was found. Answer using general financial knowledge and clearly state that uploaded documents did not contain relevant information.';
    
    const response = await askAdvisorWithGemini(
      queryNoise,
      [], // loans
      [], // assets
      [], // goals
      [], // subscriptions
      user.income,
      user.expenses,
      context
    );

    console.log('Advisor Response Content:');
    console.log(response.response);

    const hasGroundedNotice = response.response.includes('Grounded Document Context');
    const hasNoMatchMessage = response.response.includes('No relevant document context was found') || response.response.includes('uploaded documents did not contain relevant information');

    if (hasGroundedNotice && hasNoMatchMessage) {
      console.log('✅ Grounded advisor no_match directive successfully verified!');
    } else {
      console.error('❌ Grounded advisor no_match verification failed.');
    }

    // Clean up
    console.log('\nCleaning up database test entries...');
    await DocumentChunk.deleteMany({ documentId: docRecord._id });
    await DocumentChunk.deleteMany({ documentId: duplicateDocRecord._id });
    await Document.deleteOne({ _id: docRecord._id });
    await Document.deleteOne({ _id: duplicateDocRecord._id });
    await User.deleteOne({ _id: user._id });
    console.log('Cleanup completed.');

  } catch (error) {
    console.error('Integration test encountered error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB Connection closed.');
    console.log('--- COMPREHENSIVE TEST COMPLETED ---');
  }
};

runTest();
