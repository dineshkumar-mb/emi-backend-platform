# AI-Powered EMI Calculator - Backend

A Node.js backend providing an intelligent loan management and EMI calculation engine with a RAG-enabled AI advisor.

## 🚀 What Was Built

A Node.js/Express REST API that powers the EMI calculation platform. It manages user authentication, persists loan schedules in MongoDB, and orchestrates a Retrieval-Augmented Generation (RAG) pipeline to ground Google Gemini AI responses in user-uploaded documents (like PDF rate sheets or text files).

## 💡 Why It's Technically Interesting

The backend implements a highly scalable RAG infrastructure. It parses uploaded financial documents, chunks the text, and stores dense embeddings inside a dedicated **ChromaDB** vector database. Document indexing is offloaded to a background queue system powered by **Redis** and **BullMQ** to prevent blocking the main event loop during large file uploads.

## 🛠️ Architecture

- **Backend:** Node.js (v22), Express.
- **Databases:** 
  - **MongoDB** (using Mongoose) for persisting `LoanPayment` EMI schedules and `User` profiles.
  - **ChromaDB** for storing and querying text embeddings via cosine similarity.
  - **Redis** for managing asynchronous background tasks.
- **AI Integration:** Google Gemini (`@google/generative-ai`). `gemini-2.5-flash` is used for intelligence, and `text-embedding-004` generates embeddings.
- **Background Jobs:** BullMQ for asynchronous document parsing, PDF chunking, and AI processing.

## The AI Prompt & Data Structure

The system uses specific system prompts to constrain the AI Advisor. It is fed a combined context of the user's current loans, assets, goals, subscriptions, and income/expenses. The RAG pipeline injects the most relevant document chunks from ChromaDB directly into this context.

**EMI Calculation Engine:**
The core EMI math (`principal * rate / 12 / 100`) lives completely separate from the AI in `emiCalculationEngine.js`. This guarantees 100% deterministic mathematical accuracy for the loan schedules, ensuring the AI only acts as an advisor, not a calculator.

## Response Validation & Fallback Logic

- **RAG Fallback:** If a user queries the AI and no document chunk meets the similarity threshold, the system intercepts the query and sets the context to answer using general financial knowledge while explicitly stating that uploaded documents did not contain relevant information.
- **Action Execution:** The AI is instructed to return structured action parameters (like `FILTER_LOANS` or `CREATE_REPAYMENT_PLAN`). The backend parses this JSON and executes actual database queries on behalf of the user.

## CI/CD and Docker

This repository is fully integrated with **GitHub Actions** and **Docker**.
- **CI Pipeline**: Automatically installs dependencies and runs basic sanity checks on PRs.
- **CD Pipeline**: Automatically builds the Docker image and publishes it to the GitHub Container Registry (`ghcr.io`) upon merging to `main`.
- **Docker Compose**: A centralized `docker-compose.yml` ties the Node.js backend, Redis, and ChromaDB together into a unified, reproducible local environment.

## Getting Started

### Prerequisites
- Node.js v22 OR Docker Desktop
- MongoDB connection string
- Google Gemini API Key

### Running with Docker Compose (Recommended)

To run the full stack (Backend, ChromaDB, and Redis) locally without installing Redis or Python dependencies:

```bash
# From the backend-platform directory (or project root depending on compose location)
docker compose up -d --build
```
This automatically builds the backend container and binds ports for Redis (6379) and ChromaDB (8000).

### Manual Installation (Local Dev)

```bash
git clone https://github.com/dineshkumar-mb/emi-backend-platform backend-platform
cd backend-platform
npm install
npm run dev
```

## Environment Variables

Create a `.env` file with the following required keys:
- `PORT` (Defaults to 5000)
- `MONGO_URI`
- `GEMINI_API_KEY`
- `JWT_SECRET`
- `REDIS_URI` (Defaults to redis://localhost:6379)
- `CHROMA_URL` (Defaults to http://localhost:8000)

## License
MIT License
