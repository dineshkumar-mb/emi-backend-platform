import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { z } from "zod";
import * as cheerio from "cheerio";
import { chromaService } from '../chromaClient.js';
import { getEmbedding } from '../ragService.js';

// In-memory store for session histories
const messageHistories = new Map();

export class FinancialAdvisorAgent {
  constructor() {
    this.llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY,
      maxOutputTokens: 2048,
    });

    const responseSchema = z.object({
      advice: z.string().describe("The customized financial advice based on the user's question, profile, and news."),
      recommendedActions: z.array(z.string()).describe("A list of concrete recommended actions for the user.")
    });

    const fallbackLlm = new ChatOpenAI({
      modelName: "qwen/qwen-2.5-7b-instruct",
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
      },
      maxTokens: 2048,
    });

    this.structuredLlm = this.llm.withStructuredOutput(responseSchema).withFallbacks({
      fallbacks: [fallbackLlm.withStructuredOutput(responseSchema)]
    });

    this.prompt = ChatPromptTemplate.fromMessages([
      ["system", `You are a STRICT AI Financial Advisor for an EMI Management platform. You must answer questions related to finance, loans, EMIs, credit scores, economics, or banking.

User Profile / Context:
{userContext}

Live Information (Context from ChromaDB & Web Search):
{newsContext}

Instructions:
1. STRICT GUARDRAIL: If the user's question is entirely unrelated to finance, loans, banking, EMIs, economics, or the provided documents (e.g., asking about celebrities, politicians, or casual chat), politely decline to answer. Respond with: "I am a financial advisor. I can only assist you with questions related to finance, loans, and EMI management."
2. If the user asks about "the PDF" or "the document", answer based on the Live Information section. Assume it is relevant.
3. If relevant financial news or live web search data is provided, incorporate it into your advice and cite the source.
4. Explain the impact on their EMI or borrowing capability where applicable.
5. Recommend concrete actions.`],
      new MessagesPlaceholder("history"),
      ["human", "{input}"]
    ]);

    this.chain = this.prompt.pipe(this.structuredLlm);

    this.agentWithHistory = new RunnableWithMessageHistory({
      runnable: this.chain,
      getMessageHistory: (sessionId) => {
        if (!messageHistories.has(sessionId)) {
          messageHistories.set(sessionId, new InMemoryChatMessageHistory());
        }
        return messageHistories.get(sessionId);
      },
      inputMessagesKey: "input",
      historyMessagesKey: "history",
    });
  }

  /**
   * Performs a Web Search using DuckDuckGo Lite version to bypass strict bot blocks
   */
  async searchWeb(query) {
    try {
      const augmentedQuery = query + ' current facts news';
      console.log(`[WebSearch] Searching live web for: "${augmentedQuery}"`);
      const res = await fetch(`https://lite.duckduckgo.com/lite/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: `q=${encodeURIComponent(augmentedQuery)}`
      });
      
      const html = await res.text();
      const $ = cheerio.load(html);
      const results = [];
      
      $('.result-snippet').each((i, el) => {
        if (i < 6) { // limit to top 6 results to catch factual answers
          results.push($(el).text().trim());
        }
      });
      
      if (results.length === 0) return null;
      
      return results.map((r, i) => `Web Search Result ${i+1}: ${r}`).join('\\n');
    } catch (e) {
      console.error('[WebSearch] Error fetching live web data:', e);
      return null;
    }
  }

  /**
   * Performs a similarity search on ChromaDB for news and user documents
   */
  async retrieveContext(query, filters = {}) {
    try {
      const newsCollection = await chromaService.getCollection('financial_news');
      const docsCollection = await chromaService.getCollection('user_documents');
      const queryEmbedding = await getEmbedding(query);

      // Chroma queries
      const newsResults = await newsCollection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: 3,
        where: Object.keys(filters).length > 0 ? filters : undefined
      });

      const docsResults = await docsCollection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: 3
      });

      let formattedContext = [];

      if (newsResults && newsResults.documents && newsResults.documents[0].length > 0) {
        formattedContext = formattedContext.concat(newsResults.documents[0].map((doc, idx) => {
          const meta = newsResults.metadatas[0][idx];
          return `
[NEWS ARTICLE]
Source: ${meta?.source || 'Unknown'}
Title: ${meta?.title || 'Unknown'}
Date: ${meta?.publishedDate || 'Unknown'}
Impact on Borrowers: ${meta?.borrowerImpact || 'Unknown'}
Content: ${doc.substring(0, 500)}...`;
        }));
      }

      if (docsResults && docsResults.documents && docsResults.documents[0].length > 0) {
        formattedContext = formattedContext.concat(docsResults.documents[0].map((doc, idx) => {
          const meta = docsResults.metadatas[0][idx];
          return `
[USER DOCUMENT (PDF)]
Filename: ${meta?.source || 'Unknown'}
Content: ${doc.substring(0, 1000)}...`;
        }));
      }

      return formattedContext;
    } catch (error) {
      console.error('[FinancialAdvisorAgent] Retrieval Error:', error);
      return [];
    }
  }

  /**
   * Generate structured response using LangChain RAG & Memory
   */
  async generateAdvice(userContext, userQuestion, sessionId = 'default-session') {
    console.log(`[FinancialAdvisorAgent] Retrieving advice for session ${sessionId}...`);
    
    // 1. Retrieve News & Web Search in Parallel!
    const [newsContextArray, webSearchResults] = await Promise.all([
      this.retrieveContext(userQuestion),
      this.searchWeb(userQuestion)
    ]);
    
    let combinedContext = [];
    if (webSearchResults) {
      combinedContext.push("--- LIVE WEB SEARCH DATA ---");
      combinedContext.push(webSearchResults);
    }
    
    if (newsContextArray.length > 0) {
      combinedContext.push("--- LOCAL DATABASE NEWS ---");
      combinedContext.push(newsContextArray.join('\n\n'));
    }

    const finalContextStr = combinedContext.length > 0 
      ? combinedContext.join('\n\n') 
      : 'No recent relevant news found.';

    // 2. Invoke Chain
    try {
      const response = await this.agentWithHistory.invoke(
        {
          input: userQuestion,
          userContext: JSON.stringify(userContext, null, 2),
          newsContext: finalContextStr
        },
        {
          configurable: {
            sessionId: sessionId
          }
        }
      );
      
      return response;
    } catch (error) {
      console.error('[FinancialAdvisorAgent] Generation Error:', error);
      // Fallback response structure
      return {
        advice: "I apologize, but I am currently unable to process your request. Please try again later.",
        recommendedActions: []
      };
    }
  }
}

export const financialAdvisorAgent = new FinancialAdvisorAgent();
