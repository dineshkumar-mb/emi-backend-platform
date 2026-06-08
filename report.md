# 🏛️ EMI Tracker AI & Portfolio Management System
## Comprehensive Implementation Report (Backend focus)

This report provides a detailed breakdown of the architectures, features, and functionalities implemented across the backend of the **EMI Tracker AI** system.

---

## 🗺️ High-Level System Architecture

The project is built on the **MERN (MongoDB, Express, React, Node.js)** stack. The backend acts as the core REST API and intelligence orchestrator, interacting with MongoDB and integrating with the Google Gemini API and Telegram Bot API.

```
                  ┌──────────────────────────────────────────────┐
                  │                 Vite React App               │
                  │  (Dashboard, EMI Calc, Excel Export, Parser)  │
                  └──────┬──────────────────────────────▲────────┘
                         │ REST API                     │ JSON Response
                         ▼                              │
                  ┌──────────────────────────────────────────────┐
                  │           Express / Node.js Server           │
                  │   (Auth, Loan CRUD, Scheduler, Controllers)  │
                  └──────┬──────────────┬───────────────┬────────┘
                         │              │               │
                         ▼              ▼               ▼
                  ┌────────────┐ ┌──────────────┐ ┌──────────────┐
                  │  MongoDB   │ │  Telegram    │ │  Gemini AI   │
                  │  Database  │ │  Bot API     │ │  (Google)    │
                  └────────────┘ └──────────────┘ └──────────────┘
```

---

## ⚙️ Backend Implementation Details

The backend is built using Node.js and Express, exposing RESTful API endpoints secured by JSON Web Token (JWT) cookie-based authentication, and connecting to MongoDB.

### 🔐 Authentication & Session Management (`authController.js`, `authMiddleware.js`, `User.js`)
*   **Secure Cookies**: JWTs are transmitted to the client inside `httpOnly`, `sameSite: strict` cookies, shielding the credentials from XSS attacks.
*   **Schema Security**: User schemas enforce unique lowercase emails and apply pre-save hooks to hash passwords securely using `bcryptjs`.
*   **Telegram Sync**: Stores users' preferred Telegram Chat IDs, defaulting to `-5128959794` (persisted securely across user logins/reloads).

### 🏛️ Loan Portfolio Controller (`loanController.js`, `Loan.js`, `emiEngine.js`)
*   **Full CRUD Suite**: Creating, reading, updating, and deleting loans linked to a specific user.
*   **Automated EMI Calculation**: If an EMI amount is not specified during loan creation, the backend utilizes its internal financial engine to calculate the payment using the mathematical formula:
    $$EMI = P \times R \times \frac{(1+R)^N}{(1+R)^N - 1}$$
*   **Payment History Tracker**: Added a `paymentHistory` sub-document array on the `Loan` schema. When a payment is recorded:
    1.  The payment is appended to `paymentHistory` (amount, date, reference ID, and payment source: `SMS`, `GPay`, or `Manual`).
    2.  The loan's `outstandingBalance` is reduced by the payment amount (floored at zero).
    3.  The `nextDueDate` is rolled forward by exactly one month.
    4.  If the outstanding balance hits zero, the status is automatically transitioned to `completed`.
*   **Prepayment Forecasting**: An endpoint (`/api/loans/:id/prepay`) calculates the savings in total interest and reduction in tenure if a user makes a prepayment at a given point in the loan lifetime.

### 💬 Telegram Reminders & Scheduler (`telegramService.js`, `scheduler.js`)
*   **Daily Cron Job**: A background worker powered by `node-cron` sweeps the database daily at 9:00 AM.
*   **Proactive Alerts**: Automatically checks active loans and alerts users via Telegram if an EMI is due **today** or in **exactly 3 days**.
*   **Manual Trigger Sweep**: An endpoint (`POST /api/loans/trigger-scheduler`) triggers a sweep for testing, sending alerts for any loans due in the next 7 days.
*   **Link Verification**: A dedicated endpoint (`POST /api/loans/test-telegram`) sends a confirmation message to verify the validity of the Telegram Chat ID connection.

### 🧠 Gemini AI Integration (`geminiService.js`)
The application features a 3-Stage security-first processing pipeline:

```
Raw SMS Text  ──►  [Stage 1: Parser Route]  ──►  Sanitized JSON (Redacted)
                                                     │
                                                     ▼
                  [Stage 2: Validation Route] ◄──────┴──────► Matched Loan Info
                         │
                         ▼
                  Gemini Risk Analysis & Confidence Scores
                         │
                         ▼
                  [Stage 3: Mark Paid Action] ──► Database Update
```

1.  **Stage 1: Multimodal Statement Extractor (`extractLoanFromFile`)**
    *   Uses `gemini-2.5-flash` to process uploaded documents (PDF statements, CSV sheets, txt files, or image screenshots of alerts).
    *   Extracts financial structures (bank name, interest rate, principal, remaining months) and translates them into a JSON model.
2.  **Stage 1: SMS / UPI / GPay parser (`parseSmsWithGemini`)**
    *   Processes raw incoming text through Gemini AI.
    *   **Phishing & Security Filter**: Redacts sensitive info. If standard OTP patterns, CVV numbers, PIN requests, or phishing keywords are detected, the payload is labeled high-risk, all amounts are zeroed out, and `isRelevant` is marked false.
3.  **Stage 2: Advanced Payment Validator (`validatePaymentWithGemini`)**
    *   Operates **only on sanitized, redacted fields** (the raw SMS text is never sent to this endpoint).
    *   Accepts the extracted payment data, compares it against the targeted database loan, and runs validation logic:
        *   *Replay Attack Prevention*: Compares the request timestamp. If the request payload is older than 10 minutes (600 seconds), it rejects the execution.
        *   *Fuzzy Provider Name Similarity*: Evaluates if the bank names match (60% weight).
        *   *EMI Amount Tolerances*: Compares payment amounts to the expected EMI (40% weight).
        *   *Unified Security Flag Audit*: Evaluates risk categories (`low`, `medium`, `high`) and determines the next action recommendation (`confirm_payment`, `flag_for_review`, `reject_payment`, `request_verification`, `mark_as_paid`).

---

## 🔒 Implemented Security & Privacy Safeguards

As a financial app, security is baked into every transaction processing layer:

| Vector | Mitigating Safeguard |
|---|---|
| **Credential Phishing** | Prompt scans for suspicious strings; blocks confirmation action entirely (`reject_payment`) on match. |
| **Data Leakage** | Raw text is destroyed in the API boundary. Only structured, redacted parameters are stored or sent to validation endpoints. |
| **Replay Attacks** | Timestamp nonces auto-expire payloads older than 10 minutes. |
| **OTP / PIN Hijacking** | Frontend & backend regex patterns instantly scan and redact OTP codes or PIN inputs. |
| **Fuzzy Matching Errors** | Combines provider text alignment (60%) with amount proximity (40%) to prevent payments from being credited to incorrect accounts. |

---

## 🗄️ Data Models (Schemas)

### 👤 User Schema (`User.js`)
*   `name`: String (Required)
*   `email`: String (Required, Unique, Lowercase, Trimmed)
*   `password`: String (Required, Hashed via Bcrypt)
*   `income`: Number (Default: 0)
*   `expenses`: Number (Default: 0)
*   `telegramChatId`: String (Default: `'-5128959794'`)

### 🏛️ Loan Schema (`Loan.js`)
*   `userId`: ObjectId (Ref: User, Required)
*   `provider`: String (Required)
*   `loanType`: Enum (`Personal Loan`, `Home Loan`, `Vehicle Loan`, `Education Loan`, `Credit Card EMI`, `BNPL`, `Gold Loan`, `Business Loan`, `Other`)
*   `principal`: Number (Required)
*   `interestRate`: Number (Required)
*   `tenure`: Number (Required, In Months)
*   `emiAmount`: Number (Required)
*   `outstandingBalance`: Number (Required)
*   `nextDueDate`: Date (Required)
*   `status`: Enum (`active`, `completed`, `defaulted`)
*   `paymentHistory`: Array of:
    *   `amount`: Number (Required)
    *   `date`: Date (Default: Now)
    *   `refId`: String
    *   `source`: Enum (`SMS`, `GPay`, `Manual`)

---

## 🔌 API Endpoints Catalog

### Authentication Endpoints (`/api/auth`)
*   `POST /signup` — Register a new user and return user details. Sets auth cookie.
*   `POST /login` — Authenticate credentials, set cookie, and return profile.
*   `POST /logout` — Expire cookie and end user session.
*   `GET /profile` — Fetch the current authenticated user details.
*   `PATCH /telegram` — Update the user's saved Telegram Chat ID.

### Loan & Intelligence Endpoints (`/api/loans`)
*   `POST /` — Add a new loan manually.
*   `GET /` — Fetch all loans associated with the logged-in user.
*   `GET /:id` — Get a specific loan's details.
*   `PATCH /:id` — Update loan details.
*   `DELETE /:id` — Remove a loan.
*   `POST /:id/prepay` — Forecast prepayment savings.
*   `PATCH /:id/mark-paid` — Manually record a payment, reduce balance, and advance the next due date.
*   `POST /parse-sms` — Send raw SMS text to Gemini AI to extract structured payment fields.
*   `POST /validate-payment` — Stage-2 backend validation comparing payment fields to a target loan.
*   `POST /upload-statement` — Upload a document/image statement to parse and extract loan parameters.
*   `POST /test-telegram` — Dispatch a verification message to the user's Telegram Chat ID.
*   `POST /trigger-scheduler` — Manually execute the reminder cron check.
