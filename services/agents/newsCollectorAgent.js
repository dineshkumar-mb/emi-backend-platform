import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { chromaService } from '../chromaClient.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEmbedding } from '../ragService.js'; // Will refactor this to LangChain later or keep as helper

export class NewsCollectorAgent {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  /**
   * Scrapes a URL, extracts content, cleans it, and indexes it into ChromaDB
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
      const title = $('title').text() || $('h1').first().text() || 'Unknown Title';
      
      if (!rawText || rawText.length < 200) {
        console.warn(`[NewsCollectorAgent] Skipping ${url} - insufficient content.`);
        return;
      }

      // 2. Generate Metadata with Gemini
      const metadata = await this.generateMetadata(rawText, title);
      
      // 3. Create Embeddings & Store
      await this.indexToChroma({
        id: uuidv4(),
        text: rawText,
        title: title,
        url: url,
        source: sourceName,
        category: metadata.category || categoryDefault,
        keywords: metadata.keywords || [],
        importanceScore: metadata.importanceScore || 1,
        borrowerImpact: metadata.borrowerImpact || 'None',
        publishedDate: new Date().toISOString()
      });

      console.log(`[NewsCollectorAgent] Successfully indexed: ${title}`);
    } catch (error) {
      console.error(`[NewsCollectorAgent] Error processing ${url}:`, error.message);
    }
  }

  /**
   * Uses Gemini to extract structured metadata from the article
   */
  async generateMetadata(text, title) {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `
        Analyze the following financial article and provide metadata in valid JSON format.
        Do not include markdown code block formatting in your response. just the JSON object.
        Article Title: ${title}
        Content Snippet: ${text.substring(0, 3000)}

        Required JSON structure:
        {
          "category": "String (e.g., Repo Rate, Home Loan, RBI Circular, etc.)",
          "keywords": ["keyword1", "keyword2"],
          "importanceScore": "Number 1-10",
          "borrowerImpact": "Short sentence explaining impact on borrowers/EMI"
        }
      `;
      
      const result = await model.generateContent(prompt);
      let responseText = result.response.text().trim();
      
      if (responseText.startsWith('\`\`\`json')) {
        responseText = responseText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      }
      
      return JSON.parse(responseText);
    } catch (error) {
      console.error('[NewsCollectorAgent] Error generating metadata:', error);
      return { category: 'Uncategorized', keywords: [], importanceScore: 1, borrowerImpact: 'Unknown' };
    }
  }

  /**
   * Store in ChromaDB
   */
  async indexToChroma(doc) {
    const collection = await chromaService.getCollection('financial_news');
    
    // Using custom embedding function from ragService for consistency, or we could let Chroma do it if configured with Google GenAI
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
        keywords: doc.keywords.join(', '), // Chroma metadata vals must be strings/numbers
        importanceScore: doc.importanceScore,
        borrowerImpact: doc.borrowerImpact
      }],
      documents: [doc.text]
    });
  }
}

export const newsCollectorAgent = new NewsCollectorAgent();
