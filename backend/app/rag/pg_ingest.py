import os
from pathlib import Path

import psycopg2
from psycopg2.extras import Json
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# --- Load .env from project root explicitly ---
BASE_DIR = Path(__file__).resolve().parents[2]  # C:\RAG-Mentor
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

print(f"[pg_ingest] Using .env at: {ENV_PATH}")

DOCS_DIR = BASE_DIR / "docs" / "knowledge_base"
print(f"[pg_ingest] Docs directory: {DOCS_DIR}")

# Use same model everywhere
MODEL_NAME = "all-MiniLM-L6-v2"
print(f"[pg_ingest] Loading embedding model: {MODEL_NAME}")
model = SentenceTransformer(MODEL_NAME)


def get_conn():
    """Create a new PostgreSQL connection using env vars."""
    host = os.getenv("PGHOST", "localhost")
    port = os.getenv("PGPORT", "5432")
    db = os.getenv("PGDATABASE", "rag_db")
    user = os.getenv("PGUSER", "rag_user")
    pwd = os.getenv("PGPASSWORD", "rag_pass")

    print(f"[pg_ingest] Connecting to Postgres {host}:{port} db={db} user={user}")
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=db,
        user=user,
        password=pwd,
    )


def load_docs():
    """Load all .md files from docs/knowledge_base."""
    docs = []
    if not DOCS_DIR.exists():
        print(f"[pg_ingest] WARNING: {DOCS_DIR} does not exist.")
        return docs

    for path in DOCS_DIR.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        docs.append({"path": str(path), "text": text})
    print(f"[pg_ingest] Loaded {len(docs)} documents.")
    return docs


def chunk_text(text: str, chunk_size=500, overlap=50):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return chunks


def create_table():
    """Create the documents table if it doesn't exist."""
    conn = get_conn()
    cur = conn.cursor()
    print("[pg_ingest] Creating extension and table (if not exist)...")
    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            doc_id TEXT NOT NULL,
            chunk_index INT NOT NULL,
            content TEXT NOT NULL,
            metadata JSONB,
            embedding vector(384)
        );
        """
    )
    conn.commit()
    cur.close()
    conn.close()
    print("[pg_ingest] Table 'documents' is ready.")


def ingest():
    docs = load_docs()
    if not docs:
        print("[pg_ingest] No docs found to ingest. Exiting.")
        return

    create_table()

    conn = get_conn()
    cur = conn.cursor()

    total_chunks = 0

    for doc in docs:
        chunks = chunk_text(doc["text"])
        embeddings = model.encode(chunks).tolist()
        print(f"[pg_ingest] Inserting {len(chunks)} chunks from {doc['path']}")

        for idx, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            cur.execute(
                """
                INSERT INTO documents (doc_id, chunk_index, content, metadata, embedding)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    doc["path"],
                    idx,
                    chunk,
                    Json({"source": doc["path"]}),
                    emb,
                ),
            )
        total_chunks += len(chunks)

    conn.commit()
    cur.close()
    conn.close()
    print(f"[pg_ingest] Ingestion done. Inserted {total_chunks} chunks.")


if __name__ == "__main__":
    try:
        ingest()
    except Exception as e:
        print("[pg_ingest] ERROR:", repr(e))
        raise
