import { ChromaClient } from 'chromadb';

class ChromaService {
  constructor() {
    // Uses the default ChromaDB local endpoint: http://localhost:8000
    this.client = new ChromaClient({ path: process.env.CHROMA_URL || 'http://localhost:8000' });
  }

  async getClient() {
    return this.client;
  }

  /**
   * Retrieves or creates a collection by name
   * @param {string} name - Collection name
   * @returns {Promise<Collection>}
   */
  async getCollection(name = 'financial_news') {
    try {
      return await this.client.getOrCreateCollection({
        name: name,
        embeddingFunction: { generate: async (texts) => Array(texts.length).fill([]) },
        metadata: { "hnsw:space": "cosine" } // Use cosine similarity
      });
    } catch (error) {
      console.error(`[ChromaDB] Error getting/creating collection ${name}:`, error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async heartbeat() {
    try {
      return await this.client.heartbeat();
    } catch (error) {
      console.error('[ChromaDB] Heartbeat failed:', error.message);
      return false;
    }
  }
}

export const chromaService = new ChromaService();
