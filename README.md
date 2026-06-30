# AI-Powered EMI Calculator - Backend

A Node.js backend providing an intelligent loan management and EMI calculation engine with a RAG-enabled AI advisor.

## 🚀 What Was Built

A Node.js/Express REST API that powers the EMI calculation platform. It manages user authentication, persists loan schedules in MongoDB, and orchestrates a Retrieval-Augmented Generation (RAG) pipeline to ground Google Gemini AI responses in user-uploaded documents (like PDF rate sheets or text files).

## 💡 Why It's Technically Interesting

Instead of relying on a dedicated third-party vector database, the RAG pipeline is implemented entirely in-house using MongoDB and mathematical Dot Product (cosine similarity) in Node.js. It features a custom chunking algorithm with overlap and automatically switches to a sparse retrieval keyword-based fallback system (filtering stopwords) if the Gemini API key is missing or leaked.

## 🛠️ Architecture

- **Backend:** Node.js (v22), Express.
- **Database:** MongoDB (using Mongoose) for persisting `LoanPayment` EMI schedules, `User` profiles, and `DocumentChunk` vectors.
- **AI Integration:** Google Gemini (`@google/generative-ai`). `gemini-2.5-flash` is used to extract text from PDFs/images, and `text-embedding-004` generates the 768-dimensional embeddings.
- **Background Jobs:** BullMQ for asynchronous document parsing and indexing.

## The AI Prompt & Data Structure

The system uses specific system prompts to constrain the AI Advisor. It is fed a combined context of the user's current loans, assets, goals, subscriptions, and income/expenses. The RAG pipeline injects up to 6,000 characters of the most relevant document chunks into this context.

**EMI Calculation Engine:**
The core EMI math (`principal * rate / 12 / 100`) lives completely separate from the AI in `emiCalculationEngine.js`. This guarantees 100% deterministic mathematical accuracy for the loan schedules, ensuring the AI only acts as an advisor, not a calculator.

## Response Validation & Fallback Logic

- **RAG Fallback:** If a user queries the AI and no document chunk meets the similarity threshold (`0.70` for vectors, `0.25` for keywords), the system intercepts the query and explicitly sets the context to: *"No relevant document context was found. Answer using general financial knowledge and clearly state that uploaded documents did not contain relevant information."*
- **Action Execution:** The AI is instructed to return structured action parameters (like `FILTER_LOANS` or `CREATE_REPAYMENT_PLAN`). The backend parses this JSON and executes actual database queries on behalf of the user.

## Getting Started

### Prerequisites
- Node.js v22
- MongoDB connection string
- Google Gemini API Key

### Installation

```bash
git clone https://github.com/dineshkumar-mb/emi-backend-platform
cd emi-backend-platform
npm install
```

### Running the Server

```bash
npm start
# or for development:
npm run dev
```

## Environment Variables

Create a `.env` file with the following required keys:
- `PORT`
- `MONGO_URI`
- `GEMINI_API_KEY`
- `JWT_SECRET`
- `RAG_MIN_SIMILARITY` (Optional, defaults to 0.70)
- `RAG_KEYWORD_MIN_SIMILARITY` (Optional, defaults to 0.25)

## License
MIT License
