import os
import httpx
from dotenv import load_dotenv

load_dotenv()

LLM_MODEL = os.getenv("LLM_MODEL", "llama3.2:3b")

async def ask_llm(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=None) as client:
        resp = await client.post(
            "http://localhost:11434/api/generate",
            json={
                "model": LLM_MODEL,
                "prompt": prompt,
                "stream": False,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["response"]
