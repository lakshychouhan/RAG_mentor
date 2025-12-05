import os
import psycopg2
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# Load .env from project root
load_dotenv()

# Use the same embedding model you used in pg_ingest.py
model = SentenceTransformer("all-MiniLM-L6-v2")


def get_conn():
    """Create a new PostgreSQL connection using env vars."""
    return psycopg2.connect(
        host=os.getenv("PGHOST", "localhost"),
        port=os.getenv("PGPORT", "5432"),
        dbname=os.getenv("PGDATABASE", "rag_db"),
        user=os.getenv("PGUSER", "rag_user"),
        password=os.getenv("PGPASSWORD", "rag_pass"),
    )


def retrieve_context(question: str, k: int = 5) -> str:
    """
    Given a user question, embed it and retrieve the top-k most similar
    document chunks from the 'documents' table, then join them into one string.
    """
    # 1) Embed the user question
    q_emb = model.encode([question])[0].tolist()

    # 2) Query pgvector using <-> similarity operator
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT content
        FROM documents
        ORDER BY embedding <-> %s::vector
        LIMIT %s
        """,
        (q_emb, k),
    )

    rows = cur.fetchall()
    cur.close()
    conn.close()

    # 3) Combine contents into one context string
    chunks = [row[0] for row in rows]
    return "\n\n".join(chunks)
