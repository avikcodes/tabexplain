import asyncio
import base64
import hashlib
import json
import os
import uuid
import traceback
from io import BytesIO

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

try:
    import groq
except Exception:
    groq = None

try:
    from groq import Groq as GroqClient
except Exception:
    GroqClient = None

try:
    from upstash_redis import Redis
except Exception:
    Redis = None


load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


groq_api_key = os.getenv("GROQ_API_KEY")
groq_client = GroqClient(api_key=groq_api_key) if groq_api_key and GroqClient is not None else None

redis_url = os.getenv("UPSTASH_REDIS_REST_URL")
redis_token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
redis_client = Redis(url=redis_url, token=redis_token) if redis_url and redis_token and Redis is not None else None


def _to_native_types(value):
    if isinstance(value, dict):
        return {str(key): _to_native_types(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_to_native_types(item) for item in value]
    if isinstance(value, tuple):
        return [_to_native_types(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_to_native_types(item) for item in value.tolist()]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value) or np.isinf(value):
            return None
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, float):
        if np.isnan(value) or np.isinf(value):
            return None
        return value
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if isinstance(value, (pd.Timedelta,)):
        return str(value)
    return value


def _json_safe(value):
    return _to_native_types(value)


def analyse_dataframe(df):
    numeric_df = df.select_dtypes(include=[np.number])
    non_numeric_columns = [column for column in df.columns if column not in numeric_df.columns]

    missing_values = df.isna().sum().to_dict()
    missing_percentages = ((df.isna().sum() / len(df) * 100) if len(df) else df.isna().sum() * 0).round(2).to_dict()

    outliers = {}
    for column in numeric_df.columns:
        series = numeric_df[column].dropna()
        if series.empty:
            outliers[column] = 0
            continue
        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        outliers[column] = int(((series < lower_bound) | (series > upper_bound)).sum())

    if not numeric_df.empty:
        correlations_df = numeric_df.corr(numeric_only=True).round(2)
        correlations = correlations_df.to_dict()
    else:
        correlations = {}

    distributions = {}
    for column in numeric_df.columns:
        series = numeric_df[column].dropna()
        if series.empty:
            distributions[column] = {"min": None, "max": None, "mean": None, "median": None, "std": None}
            continue
        distributions[column] = {
            "min": round(float(series.min()), 2),
            "max": round(float(series.max()), 2),
            "mean": round(float(series.mean()), 2),
            "median": round(float(series.median()), 2),
            "std": round(float(series.std(ddof=1)), 2) if len(series) > 1 else 0.0,
        }

    top_values = {}
    for column in non_numeric_columns:
        value_counts = df[column].astype("object").value_counts(dropna=True).head(5)
        top_values[column] = {str(key): int(value) for key, value in value_counts.to_dict().items()}

    analysis = {
        "row_count": int(df.shape[0]),
        "column_count": int(df.shape[1]),
        "columns": [str(column) for column in df.columns.tolist()],
        "dtypes": {str(column): str(dtype) for column, dtype in df.dtypes.items()},
        "missing_values": {str(column): int(value) for column, value in missing_values.items()},
        "missing_percentages": {str(column): round(float(value), 2) for column, value in missing_percentages.items()},
        "outliers": {str(column): int(value) for column, value in outliers.items()},
        "correlations": _json_safe(correlations),
        "distributions": _json_safe(distributions),
        "top_values": _json_safe(top_values),
    }
    return analysis


def generate_summary(analysis_results, file_name):
    if groq_client is None:
        return "AI summary unavailable"

    try:
        print("Calling Groq...")
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a data analysis expert. Given CSV analysis results write a plain English summary "
                        "explaining what this dataset likely represents, key patterns found, data quality issues, "
                        "and which columns look most important for ML. Keep it under 150 words. Be specific and actionable."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"File: {file_name} Rows: {analysis_results['row_count']} Columns: {analysis_results['columns']} "
                        f"Missing: {analysis_results['missing_percentages']} Correlations: {analysis_results['correlations']}"
                    ),
                },
            ],
        )
        print("Groq response received")
        summary = response.choices[0].message.content.strip()
        return summary
    except Exception as e:
        print(f"Groq error: {str(e)}")
        return "AI summary unavailable"


def get_cache(file_hash):
    if redis_client is None:
        return None
    try:
        cached = redis_client.get(file_hash)
        if not cached:
            return None
        if isinstance(cached, bytes):
            cached = cached.decode("utf-8")
        return json.loads(cached)
    except Exception:
        return None


def set_cache(file_hash, data):
    if redis_client is None:
        return
    try:
        redis_client.set(file_hash, json.dumps(_to_native_types(data)), ex=86400)
    except Exception as exc:
        print(f"Redis cache save error: {exc}")


def save_to_supabase(session_id, file_name, row_count, column_count, results, ai_summary):
    try:
        safe_results = _to_native_types(results)
        print("Saving to Supabase...")
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            print("Supabase error: missing SUPABASE_URL or SUPABASE_KEY")
            return

        payload = {
            "session_id": session_id,
            "file_name": file_name,
            "row_count": row_count,
            "column_count": column_count,
            "results": json.dumps(safe_results),
            "ai_summary": ai_summary,
        }
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        response = requests.post(f"{supabase_url}/rest/v1/analyses", headers=headers, json=payload, timeout=30)
        print(f"Supabase status code: {response.status_code}")
        if response.status_code != 201:
            print(response.text)
        else:
            print("Supabase save complete")
    except Exception as e:
        print(f"Supabase error: {str(e)}")
        traceback.print_exc()


@app.websocket("/ws/analyse")
async def websocket_analyse(websocket: WebSocket):
    try:
        await websocket.accept()
        print("WebSocket connected")
        print("Receiving data...")
        raw_message = await websocket.receive_text()
        print(f"Data received, size: {len(raw_message.encode('utf-8'))} bytes")
        print("Parsing JSON...")
        payload = json.loads(raw_message)
        file_name = payload["filename"]
        file_data = base64.b64decode(payload["data"])
        file_hash = hashlib.md5(file_data).hexdigest()

        print("Checking cache...")
        await websocket.send_json({"step": "Checking cache...", "progress": 10})
        cached = get_cache(file_hash)
        if cached is not None:
            print("Cache hit!")
            await websocket.send_json({"step": "Cache hit!", "progress": 90})
            session_id = str(uuid.uuid4())
            await websocket.send_json(
                {
                    "step": "Complete",
                    "progress": 100,
                    "results": cached.get("results", {}),
                    "ai_summary": cached.get("ai_summary", "AI summary unavailable"),
                    "session_id": session_id,
                }
            )
            return

        print("Parsing CSV...")
        await websocket.send_json({"step": "Parsing CSV...", "progress": 20})
        try:
            df = pd.read_csv(BytesIO(file_data))
        except Exception:
            await websocket.send_json({"error": "Failed to parse CSV"})
            return

        print("Detecting missing values...")
        await websocket.send_json({"step": "Detecting missing values...", "progress": 35})
        print("Finding outliers...")
        await websocket.send_json({"step": "Finding outliers...", "progress": 50})
        print("Computing correlations...")
        await websocket.send_json({"step": "Computing correlations...", "progress": 65})

        results = analyse_dataframe(df)
        safe_results = _to_native_types(results)

        print("Generating AI summary...")
        await websocket.send_json({"step": "Generating AI summary...", "progress": 80})
        summary = await asyncio.to_thread(generate_summary, safe_results, file_name)

        print("Saving to history...")
        await websocket.send_json({"step": "Saving to history...", "progress": 90})
        cache_payload = {"results": safe_results, "ai_summary": summary}
        set_cache(file_hash, cache_payload)

        session_id = str(uuid.uuid4())
        await asyncio.to_thread(
            save_to_supabase,
            session_id,
            file_name,
            safe_results["row_count"],
            safe_results["column_count"],
            safe_results,
            summary,
        )

        print("Analysis complete, sending final message")
        print(f"Session ID: {session_id}")
        await websocket.send_json(
            {
                "step": "Complete",
                "progress": 100,
                "results": safe_results,
                "ai_summary": summary,
                "session_id": session_id,
            }
        )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        traceback.print_exc()
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/history")
def history():
    try:
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            return []

        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        response = (
            requests.get(
                f"{supabase_url}/rest/v1/analyses?select=*&order=created_at.desc&limit=10",
                headers=headers,
                timeout=30,
            )
        )
        if response.status_code != 200:
            return []
        return response.json() or []
    except Exception:
        return []
