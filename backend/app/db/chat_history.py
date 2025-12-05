import os
from datetime import datetime
from typing import List, Literal

import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv
from pathlib import Path

# Load .env from project root
BASE_DIR = Path(__file__).resolve().parents[2]
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)


def get_conn():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "localhost"),
        port=os.getenv("PGPORT", "5432"),
        dbname=os.getenv("PGDATABASE", "rag_db"),
        user=os.getenv("PGUSER", "rag_user"),
        password=os.getenv("PGPASSWORD", "rag_pass"),
    )


def ensure_table():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL, -- 'user' or 'assistant'
            content TEXT NOT NULL,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    conn.commit()
    cur.close()
    conn.close()


def save_message(
    conversation_id: str,
    role: Literal["user", "assistant"],
    content: str,
    metadata: dict | None = None,
):
    ensure_table()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO chat_messages (conversation_id, role, content, metadata)
        VALUES (%s, %s, %s, %s);
        """,
        (conversation_id, role, content, Json(metadata or {})),
    )
    conn.commit()
    cur.close()
    conn.close()


def get_recent_messages(conversation_id: str, limit: int = 6) -> List[dict]:
    """Return last N messages in this conversation, oldest first."""
    ensure_table()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT role, content, created_at
        FROM chat_messages
        WHERE conversation_id = %s
        ORDER BY created_at DESC
        LIMIT %s;
        """,
        (conversation_id, limit),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    # reverse to oldest -> newest
    rows = rows[::-1]
    return [
        {"role": role, "content": content, "created_at": created_at}
        for (role, content, created_at) in rows
    ]
