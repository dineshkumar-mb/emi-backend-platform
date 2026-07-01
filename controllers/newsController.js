import { chromaService } from '../services/chromaClient.js';
import { getEmbedding } from '../services/ragService.js';
import { queueNewsCrawl } from '../services/newsScheduler.js';


export const searchNews = async (req, res) => {
  try {
    const { query, limit = 10, category, source } = req.query;
    
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query is required.' });
    }

    const collection = await chromaService.getCollection('financial_news');
    const queryEmbedding = await getEmbedding(query);

    const where = {};
    if (category) where.category = category;
    if (source) where.source = source;

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: parseInt(limit, 10),
      where: Object.keys(where).length > 0 ? where : undefined
    });

    const formatted = results.documents[0].map((doc, idx) => ({
      content: doc,
      metadata: results.metadatas[0][idx]
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[NewsController] Search Error:', error);
    res.status(500).json({ success: false, message: 'Failed to search news.' });
  }
};

export const getRbiNews = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const collection = await chromaService.getCollection('financial_news');
    
    const results = await collection.get({
      where: { source: 'RBI' },
      limit: parseInt(limit, 10)
    });
    
    // In Chroma get(), documents/metadatas are arrays, not nested arrays like query()
    const formatted = results.documents.map((doc, idx) => ({
      content: doc,
      metadata: results.metadatas[idx]
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[NewsController] RBI News Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RBI news.' });
  }
};

export const getLatestNews = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const collection = await chromaService.getCollection('financial_news');
    
    // ChromaDB does not support direct sorting by date in the get() query natively yet, 
    // so we fetch a larger chunk and sort in memory for this MVP.
    const results = await collection.get({
      limit: 100
    });
    
    const formatted = results.documents.map((doc, idx) => ({
      content: doc,
      metadata: results.metadatas[idx]
    }));

    formatted.sort((a, b) => new Date(b.metadata.publishedDate) - new Date(a.metadata.publishedDate));

    res.json({ success: true, data: formatted.slice(0, parseInt(limit, 10)) });
  } catch (error) {
    console.error('[NewsController] Latest News Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch latest news.' });
  }
};

export const getCategories = async (req, res) => {
  try {
    const collection = await chromaService.getCollection('financial_news');
    // Fetch all metadatas to extract unique categories
    const results = await collection.get({
      include: ['metadatas']
    });
    
    const categories = new Set();
    results.metadatas.forEach(meta => {
      if (meta.category) categories.add(meta.category);
    });

    res.json({ success: true, data: Array.from(categories) });
  } catch (error) {
    console.error('[NewsController] Categories Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
  }
};

export const triggerNewsCrawl = async (req, res) => {
  try {
    // We trigger the crawl logic which enqueues jobs for all configured sources
    await queueNewsCrawl();
    res.json({ success: true, message: 'News crawl job has been queued.' });
  } catch (error) {
    console.error('[NewsController] Crawl Trigger Error:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger news crawl.' });
  }
};

export const debugNews = async (req, res) => {
  try {
    const collection = await chromaService.getCollection('financial_news');
    const results = await collection.get({
      limit: 5
    });
    
    // Count total documents in the collection
    const count = await collection.count();
    
    const sample = results.documents.map((doc, idx) => ({
      content: doc,
      metadata: results.metadatas[idx]
    }));

    res.json({ 
      success: true, 
      count,
      sample
    });
  } catch (error) {
    console.error('[NewsController] Debug Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch debug info.', error: error.message });
  }
};
