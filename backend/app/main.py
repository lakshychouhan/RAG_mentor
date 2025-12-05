import re
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import json
import uuid
from app.rag.pg_query import retrieve_context
from app.core.llm import ask_llm
from app.db.chat_history import save_message, get_recent_messages
app = FastAPI(title="RAG Mentor API")

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str
    code_snippet: Optional[str] = None
    error_message: Optional[str] = None
    skill_level: str = "beginner"  # beginner | intermediate | pro
    conversation_id: Optional[str] = None  # <-- NEW


class Step(BaseModel):
    title: str
    detail: str


class AskResponse(BaseModel):
    explanation: str
    fixed_code: Optional[str] = None
    diff: Optional[str] = None
    steps: List[Step] = []
    tldr: str
    context_used: Optional[str] = None
    raw: Optional[str] = None  # keep raw text for debugging if needed
    conversation_id: str  # <-- NEW: always send current conversation id


@app.get("/health")
def health():
    return {"status": "ok"}


LEVEL_GUIDE = {
    "beginner": """Explain as if to a first-year student.
- Avoid jargon.
- Use analogies (like explaining to a friend).
- Show full working code.
- Do NOT assume they know advanced topics.""",

    "intermediate": """Explain as if to someone with 1–2 years dev experience.
- They know syntax and basic concepts.
- Focus on edge cases, debugging, and best practices.
- Use some jargon but still clarify key ideas.""",

    "pro": """Explain as if to a senior engineer.
- Be concise.
- Focus on trade-offs, performance, architecture, and failure modes.
- Skip basics, assume they know language and frameworks.
- You can reference patterns (e.g., SOLID, CQRS, CAP).""",
}

def extract_json(raw: str) -> dict:
    """
    Try to extract a JSON object from the raw LLM output.
    - Strips ```json fences
    - If there is extra text around the JSON, takes the first {...} block.
    - Tries to fix simple issues like missing closing braces.
    """
    txt = raw.strip()

    # Remove markdown fences if present
    if txt.startswith("```"):
        lines = txt.splitlines()
        # drop first line (``` or ```json)
        if lines:
            lines = lines[1:]
        # drop last line if it's ``` 
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        txt = "\n".join(lines).strip()

    # If there's extra text, try to isolate the first { ... } block
    if not txt.startswith("{"):
        start = txt.find("{")
        end = txt.rfind("}")
        if start != -1 and end != -1 and end > start:
            txt = txt[start : end + 1]

    # If we still don't end with '}', try to balance braces
    if txt.startswith("{"):
        open_braces = txt.count("{")
        close_braces = txt.count("}")
        if close_braces < open_braces:
            txt = txt + ("}" * (open_braces - close_braces))

    # Final attempt to parse
    return json.loads(txt)
@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    # 0) Determine conversation ID (new or existing)
    conversation_id = req.conversation_id or str(uuid.uuid4())

    # 1) Load recent chat history for this conversation
    history = get_recent_messages(conversation_id, limit=6)

    # Format history into text for the prompt
    history_text_chunks: list[str] = []
    for msg in history:
        role = "User" if msg["role"] == "user" else "Mentor"
        history_text_chunks.append(f"{role}: {msg['content']}")
    history_text = "\n".join(history_text_chunks)

    # 2) RAG context from docs
    try:
        context = retrieve_context(req.question, k=5)
    except Exception as e:
        print("Error in retrieve_context:", repr(e))
        raise HTTPException(status_code=500, detail=f"retrieve_context failed: {e}")

    level_guide = LEVEL_GUIDE.get(req.skill_level, LEVEL_GUIDE["beginner"])

    # 3) Build prompt including history + context
    prompt = f"""
You are a senior software engineering mentor.

User skill level: {req.skill_level}
Guidelines: {level_guide}

Conversation so far (may be empty):
{history_text or "(no previous messages)"}

New user question:
{req.question}

User code snippet (may be empty):
{req.code_snippet or "NONE"}

Error message (if any):
{req.error_message or "NONE"}

Context from documentation (may be partial):
{context}

TASK:
Return a JSON object with exactly these keys:
- "explanation": string
- "fixed_code": string
- "diff": string
- "steps": array of objects: {{ "title": string, "detail": string }}
- "tldr": string

IMPORTANT:
- Respond with VALID JSON only.
- Do NOT wrap in ```json fences.
- Do NOT add extra keys.
"""

    # 4) Call LLM
    try:
        raw = await ask_llm(prompt)
    except Exception as e:
        print("Error in ask_llm:", repr(e))
        raise HTTPException(status_code=500, detail=f"ask_llm failed: {e}")

    # 5) Parse JSON
    try:
        data = extract_json(raw)
    except Exception as e:
        print("JSON parse failed:", repr(e))
        print("Raw LLM output was:\n", raw)
        data = {
            "explanation": raw,
            "fixed_code": "",
            "diff": "",
            "steps": [],
            "tldr": "Model did not return structured JSON; showing raw answer.",
        }

    explanation = data.get("explanation", "")
    fixed_code = data.get("fixed_code") or ""
    diff = data.get("diff") or ""
    tldr = data.get("tldr", "")
    raw_steps = data.get("steps", [])

    steps: list[Step] = []
    if isinstance(raw_steps, list):
        for s in raw_steps:
            if not isinstance(s, dict):
                continue
            title = s.get("title") or "Step"
            detail = s.get("detail") or ""
            steps.append(Step(title=title, detail=detail))

    # 6) Save user and assistant messages in DB
    user_msg = req.question
    if req.code_snippet:
        user_msg += f"\n\n[Code]\n{req.code_snippet}"
    if req.error_message:
        user_msg += f"\n\n[Error]\n{req.error_message}"

    try:
        save_message(
            conversation_id=conversation_id,
            role="user",
            content=user_msg,
            metadata={"skill_level": req.skill_level},
        )
        save_message(
            conversation_id=conversation_id,
            role="assistant",
            content=explanation,
            metadata={
                "tldr": tldr,
                "has_fixed_code": bool(fixed_code),
                "has_diff": bool(diff),
            },
        )
    except Exception as e:
        print("Error saving chat messages:", repr(e))

    # 7) Return response including conversation_id
    return AskResponse(
        explanation=explanation,
        fixed_code=fixed_code or None,
        diff=diff or None,
        steps=steps,
        tldr=tldr,
        context_used=context,
        raw=raw,
        conversation_id=conversation_id,
    )
