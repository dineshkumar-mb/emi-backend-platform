import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { chromaService } from '../chromaClient.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEmbedding } from '../ragService.js';
import FinancialNews from '../../models/FinancialNews.js';

export class NewsCollectorAgent {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  /**
   * Scrapes a URL, extracts content, cleans it, and indexes it into MongoDB & ChromaDB
   */
  async processUrl(url, sourceName, categoryDefault = 'General') {
    try {
      console.log(`[NewsCollectorAgent] Crawling ${url}...`);
      
      // 1. Scrape & Clean HTML
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      // Remove scripts, styles, nav, footer, etc.
      $('script, style, nav, footer, header, iframe, noscript').remove();
      
      const rawText = $('body').text().replace(/\s+/g, ' ').trim();
      const title = $('title').text() || $('h1').first().text() || 'Financial Market Update';
      
      if (!rawText || rawText.length < 150) {
        console.warn(`[NewsCollectorAgent] Skipping ${url} - insufficient content.`);
        return null;
      }

      // 2. Generate Metadata with Gemini
      const metadata = await this.generateMetadata(rawText, title);
      const isRepoRate = /repo\s*rate|policy\s*rate|monetary\s*policy|mpc|eblr|mclr|floating\s*rate/i.test(title + ' ' + rawText);
      const summary = rawText.length > 320 ? rawText.substring(0, 320) + '...' : rawText;

      // 3. Save to MongoDB (Persistent store)
      const savedDoc = await FinancialNews.findOneAndUpdate(
        { url },
        {
          title: title.trim(),
          source: sourceName,
          url,
          category: metadata.category || (isRepoRate ? 'Repo Rate' : categoryDefault),
          summary: summary,
          content: rawText.substring(0, 6000),
          borrowerImpact: metadata.borrowerImpact || (isRepoRate ? 'Benchmark rate change directly influences floating-rate home loans and new retail loans.' : 'General banking and macroeconomic impact.'),
          importanceScore: metadata.importanceScore || (isRepoRate ? 9 : 6),
          keywords: metadata.keywords || ['economy', 'banking'],
          repoRateMentioned: isRepoRate,
          currentRepoRate: '6.50%',
          publishedDate: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // 4. Create Embeddings & Store in ChromaDB (optional vector layer)
      try {
        await this.indexToChroma({
          id: uuidv4(),
          text: rawText,
          title: title,
          url: url,
          source: sourceName,
          category: savedDoc.category,
          keywords: savedDoc.keywords || [],
          importanceScore: savedDoc.importanceScore,
          borrowerImpact: savedDoc.borrowerImpact,
          publishedDate: new Date().toISOString()
        });
      } catch (chromaErr) {
        console.warn(`[NewsCollectorAgent] Chroma indexing skipped/failed for ${url}:`, chromaErr.message);
      }

      console.log(`[NewsCollectorAgent] Successfully stored news in DB: ${title}`);
      return savedDoc;
    } catch (error) {
      console.error(`[NewsCollectorAgent] Error processing ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Uses Gemini to extract structured metadata from the article
   */
  async generateMetadata(text, title) {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return this.getDefaultMetadata(text, title);
      }

      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `
        Analyze the following financial article and provide metadata in valid JSON format.
        Do not include markdown code block formatting in your response, just the JSON object.
        Article Title: ${title}
        Content Snippet: ${text.substring(0, 3000)}

        Required JSON structure:
        {
          "category": "String (e.g., Repo Rate, Home Loan, RBI Circular, Banking, Economy)",
          "keywords": ["keyword1", "keyword2"],
          "importanceScore": 8,
          "borrowerImpact": "Clear, concise sentence explaining the practical impact on borrower EMIs and loan interest rates"
        }
      `;
      
      const result = await model.generateContent(prompt);
      let responseText = result.response.text().trim();
      
      if (responseText.startsWith('```json')) {
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      } else if (responseText.startsWith('```')) {
        responseText = responseText.replace(/```/g, '').trim();
      }
      
      return JSON.parse(responseText);
    } catch (error) {
      console.warn('[NewsCollectorAgent] Gemini metadata fallback:', error.message);
      return this.getDefaultMetadata(text, title);
    }
  }

  getDefaultMetadata(text, title) {
    const isRepo = /repo\s*rate|policy\s*rate|monetary\s*policy|mpc/i.test(title + ' ' + text);
    return {
      category: isRepo ? 'Repo Rate' : 'Economy',
      keywords: isRepo ? ['repo rate', 'rbi', 'loans'] : ['economy', 'finance'],
      importanceScore: isRepo ? 9 : 6,
      borrowerImpact: isRepo 
        ? 'Directly impacts floating rate loan interest rates and monthly EMIs upon quarterly reset.' 
        : 'General macroeconomic intelligence for personal financial planning.'
    };
  }

  /**
   * Store in ChromaDB
   */
  async indexToChroma(doc) {
    const collection = await chromaService.getCollection('financial_news');
    const embedding = await getEmbedding(doc.text.substring(0, 8000)); 

    await collection.add({
      ids: [doc.id],
      embeddings: [embedding],
      metadatas: [{
        title: doc.title,
        source: doc.source,
        url: doc.url,
        publishedDate: doc.publishedDate,
        category: doc.category,
        keywords: Array.isArray(doc.keywords) ? doc.keywords.join(', ') : '',
        importanceScore: doc.importanceScore,
        borrowerImpact: doc.borrowerImpact
      }],
      documents: [doc.text]
    });
  }
}

export const newsCollectorAgent = new NewsCollectorAgent();
