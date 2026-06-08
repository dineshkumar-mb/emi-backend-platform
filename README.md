# AI-Powered EMI Management & Loan Intelligence Platform - Backend

This is the backend platform for the AI-Powered EMI Management & Loan Intelligence Platform, built using **Node.js**, **Express**, and **MongoDB**. It handles user authentication, loan data parsing, Gemini AI analysis, push notifications, and background job processing.

## 🚀 Key Features

- **AI Loan Intelligence**: Integration with Google Gemini (`@google/generative-ai`) for smart insights on EMI optimization and credit health.
- **Job Queues**: Background queue processing powered by **BullMQ** and **Redis** (`ioredis`).
- **Telemetry & Monitoring**: Integrated observability using **OpenTelemetry**, **Prometheus** (`prom-client`), and **Sentry**.
- **Security & Validation**: Robust validation using **Zod**, secure password hashing via **Bcryptjs**, token-based authorization via **JWT**, and standard HTTP protections with **Helmet** and rate limiters.
- **Integrations**: Multi-channel alerts using **Twilio** (SMS/WhatsApp), **Firebase** (FCM Push Notifications), and automated email alerts via **Nodemailer**.
- **API Documentation**: Interactive API testing playground powered by **Swagger UI** (`swagger-ui-express`).
- **Data Export**: PDF generation (`pdfkit`) and Excel spreadsheets (`exceljs`) for downloading loan summaries and debt repayment schedules.

---

## 🛠️ Tech Stack & Dependencies

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express
- **Database**: MongoDB (Mongoose ODM)
- **State/Queue Store**: Redis
- **Security**: Helmet, Express Rate Limit, JWT, BcryptJS
- **Validation**: Zod
- **AI**: Google Generative AI (Gemini)

---

## 📁 Directory Structure

```
backend-platform/
├── config/              # Configuration files (DB, Grafana, Prometheus)
├── controllers/         # Request handling logic (Auth, Loan, Consent, Support, etc.)
├── middleware/          # Security, Logging, and Rate-limiting middleware
├── models/              # Mongoose DB Schemas (User, Loan, Transaction, AlertRule, etc.)
├── services/            # Main application services (AI engine, EMI calculations, SMS, WhatsApp, Email)
├── utils/               # Helper utilities (Encryption, Metrics, OpenTelemetry)
├── server.js            # Entry point
├── Dockerfile           # Docker container configuration
└── swagger.json         # Swagger API documentation schema
```

---

## 💻 Getting Started

### Prerequisites

Ensure you have the following installed on your system:
- **Node.js** (v18+ recommended)
- **MongoDB** (Local or Atlas)
- **Redis** (Required for BullMQ queue operations)

### 1. Installation

Clone the repository and install the dependencies:

```bash
cd backend-platform
npm install
```

### 2. Configuration

Create a `.env` file in the root directory (based on `.env.example` if available) and add your environment variables:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/emi-tracker
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your_jwt_secret_here
GEMINI_API_KEY=your_gemini_api_key_here
# Firebase, Twilio, and SMTP configs as required
```

### 3. Run the Server

**Development Mode (with auto-reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

---

## 🔒 Security & Best Practices

- All API request bodies are parsed and validated strictly using **Zod**.
- Environment configurations are loaded from a `.env` file (which is git-ignored).
- Rate limits are imposed on authentication and expensive endpoints.
- Headers are secured using Helmet.
