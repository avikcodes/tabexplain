# TabExplain 📊

> Upload any CSV. Understand your data instantly.

Stop wasting hours on exploratory data analysis.
TabExplain gives you a complete visual analysis dashboard with AI insights in seconds.
Built for ML researchers and data scientists who want to understand their data before touching a single line of model code.

![demo](demo.gif)

---

## The Problem
```
You get a dataset.
You open Jupyter.
You write pd.describe().
You stare at numbers.
You still don't know what your data means.
3 hours later you start training.
Your model performs terribly.
You realize your most important column had 40% missing values.
```

**TabExplain catches this before you even open your IDE.**

---

## What You Get

| Feature | What it shows |
|---------|--------------|
| 📋 Dataset Overview | Rows, columns, data types at a glance |
| 🔴 Missing Values | Bar chart of missing % per column |
| 📦 Outlier Detection | IQR-based outlier count per column |
| 🔥 Correlation Matrix | Color-coded heatmap of all relationships |
| 📈 Distributions | Min, max, mean, median, std per column |
| 🏷️ Top Values | Most frequent values for categorical columns |
| 🤖 AI Summary | Plain English explanation of your entire dataset |
| 🕐 History | Every past analysis saved and reloadable |

---

## How It Works
```
┌─────────────────────────────────────────────────┐
│                   USER                          │
│         Uploads CSV file                        │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│            Next.js Frontend                     │
│   Reads file → encodes base64 → opens WebSocket │
└────────────────────┬────────────────────────────┘
                     │ ws://localhost:8000/ws/analyse
                     ▼
┌─────────────────────────────────────────────────┐
│          Python FastAPI Backend                 │
│                                                 │
│  1. Check Upstash Redis cache                   │
│     ↓ cache miss                               │
│  2. Parse CSV with pandas                       │
│  3. Compute missing values                      │
│  4. Detect outliers (IQR method)               │
│  5. Compute correlation matrix                  │
│  6. Compute distributions                       │
│  7. Generate AI summary via Groq               │
│  8. Save to Supabase                           │
│  9. Cache result in Redis (24hr)               │
└────────────────────┬────────────────────────────┘
                     │ WebSocket progress messages
                     ▼
┌─────────────────────────────────────────────────┐
│         Real-time Progress Bar                  │
│  Checking cache → Parsing → Outliers →          │
│  Correlations → AI Summary → Complete           │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│         Full Visual Dashboard                   │
│  Charts + Heatmaps + AI Summary + History       │
└─────────────────────────────────────────────────┘
```

---

## Real-time Progress
```
Checking cache...      ████░░░░░░░░░░░░░░░░  10%
Parsing CSV...         ████████░░░░░░░░░░░░  20%
Detecting missing...   █████████████░░░░░░░  35%
Finding outliers...    ████████████████░░░░  50%
Computing corr...      ██████████████████░░  65%
Generating summary...  ███████████████████░  80%
Saving to history...   ████████████████████  90%
Complete!              ████████████████████ 100%
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14 + TypeScript | UI and user interaction |
| Styling | Tailwind CSS | Dark research-grade aesthetic |
| Charts | Recharts | Interactive data visualizations |
| Backend | Python FastAPI | Analysis engine |
| Server | Uvicorn | ASGI server |
| Data | Pandas + NumPy + SciPy | Statistical analysis |
| AI | Groq llama-3.1-8b-instant | Plain English insights |
| Database | Supabase (PostgreSQL) | Analysis history storage |
| Cache | Upstash Redis | 24hr result caching |
| Realtime | WebSockets | Live progress streaming |

---

## Architecture
```
tabexplain/
├── app/
│   ├── page.tsx              ← Full UI + WebSocket client
│   ├── layout.tsx
│   └── globals.css
├── tabexplain-api/
│   ├── main.py               ← FastAPI + WebSocket server
│   │   ├── analyse_dataframe()   ← Statistical analysis
│   │   ├── generate_summary()    ← Groq AI summary
│   │   ├── get_cache()           ← Redis read
│   │   ├── set_cache()           ← Redis write
│   │   ├── save_to_supabase()    ← History storage
│   │   ├── fire_webhook()        ← Event notifications
│   │   ├── /ws/analyse           ← WebSocket endpoint
│   │   ├── /history              ← GET past analyses
│   │   └── /health               ← Health check
│   ├── requirements.txt
│   └── .env
├── .env.local
└── README.md
```

---

## API Reference

### WebSocket `/ws/analyse`

**Send:**
```json
{
  "filename": "titanic.csv",
  "data": "base64_encoded_file_content"
}
```

**Receive (progress messages):**
```json
{"step": "Parsing CSV...", "progress": 20}
{"step": "Computing correlations...", "progress": 65}
```

**Receive (final message):**
```json
{
  "step": "Complete",
  "progress": 100,
  "session_id": "uuid",
  "ai_summary": "This dataset contains...",
  "results": {
    "row_count": 891,
    "column_count": 12,
    "missing_values": {"Age": 177, "Cabin": 687},
    "missing_percentages": {"Age": 19.87, "Cabin": 77.1},
    "outliers": {"Fare": 116, "SibSp": 46},
    "correlations": {"Survived": {"Pclass": -0.34, "Fare": 0.26}},
    "distributions": {"Age": {"min": 0.42, "max": 80.0, "mean": 29.7}}
  }
}
```

### GET `/history`

**Response:**
```json
[
  {
    "id": "uuid",
    "session_id": "uuid",
    "file_name": "titanic.csv",
    "row_count": 891,
    "column_count": 12,
    "ai_summary": "This dataset...",
    "created_at": "2026-03-31T12:00:00"
  }
]
```

### GET `/health`
```json
{"status": "ok"}
```

---

## Outlier Detection Method

TabExplain uses the **IQR (Interquartile Range)** method:
```
Q1 = 25th percentile
Q3 = 75th percentile
IQR = Q3 - Q1

Lower bound = Q1 - 1.5 × IQR
Upper bound = Q3 + 1.5 × IQR

Any value outside these bounds = outlier
```

---

## Caching Strategy
```
First upload:
CSV → MD5 hash → Redis lookup → MISS → Full analysis → Store in Redis (24hr TTL)

Same file again:
CSV → MD5 hash → Redis lookup → HIT → Return instantly (< 100ms)
```

---

## Database Schema
```sql
create table analyses (
  id uuid default gen_random_uuid() primary key,
  session_id text not null,
  file_name text not null,
  row_count int,
  column_count int,
  results jsonb,
  ai_summary text,
  created_at timestamp default now()
);
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10–3.13
- Groq API key — free at console.groq.com
- Supabase project — free at supabase.com
- Upstash Redis — free at upstash.com

### Installation
```bash
git clone https://github.com/avikcodes/TabExplain
cd TabExplain
```

**Frontend:**
```bash
npm install
```

**Backend:**
```bash
cd tabexplain-api
pip install -r requirements.txt
```

### Environment Setup

**tabexplain-api/.env:**
```
GROQ_API_KEY=your_groq_key
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
WEBHOOK_URL=your_webhook_url (optional)
```

**tabexplain/.env.local:**
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Run

**Terminal 1:**
```bash
cd tabexplain-api
uvicorn main:app --reload
```

**Terminal 2:**
```bash
npm run dev
```

Open `http://localhost:3000`

---

## Example — Titanic Dataset

Upload the Titanic dataset and get:
```
📋 Overview
   891 rows • 12 columns • 8.1% missing values • 7 numeric columns

🔴 Missing Values
   Cabin: 77.1% missing  ████████████████████████████████░░░░░░░░
   Age:   19.9% missing  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

📦 Outliers Detected
   Fare: 116 outliers
   SibSp: 46 outliers

🔥 Key Correlations
   Pclass ↔ Fare:     -0.55 (strong negative)
   Survived ↔ Fare:    0.26 (moderate positive)
   Survived ↔ Pclass: -0.34 (moderate negative)

🤖 AI Summary
   This appears to be the famous Titanic passenger dataset.
   Key finding: passenger class strongly predicts both fare paid
   and survival rate. Cabin has critical missing data (77%) and
   should be dropped or imputed. Age missing 20% — consider
   median imputation. Fare and Pclass are your strongest
   predictive features.
```

---

## Roadmap

- [x] CSV upload and parsing
- [x] Missing values detection
- [x] Outlier detection (IQR)
- [x] Correlation matrix heatmap
- [x] Distribution statistics
- [x] Real-time WebSocket progress
- [x] Redis caching
- [x] Supabase history
- [x] AI plain English summary
- [ ] Export analysis as PDF report
- [ ] Support for Excel files
- [ ] Column-level drill down
- [ ] Automated feature engineering suggestions
- [ ] Integration with scikit-learn pipelines

---

## Part of 30 Projects

This is **Project 4 of 30** in my open-source build sprint.

Building 30 open-source AI and ML tools for developers and researchers — March to December 2026.

→ Follow on X: [@avikcodes](https://x.com/Avikzx)
→ All projects: [github.com/avikcodes](https://github.com/avikcodes)

---

## License

MIT — free to use, modify, and distribute.
