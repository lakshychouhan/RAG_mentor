"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Menu, Send, Plus, MessageSquare, Code, AlertCircle, ChevronDown, Sparkles, Bot, User, Trash2,  Pencil } from "lucide-react"
import { cn } from "@/lib/utils"

// Types
type SkillLevel = "beginner" | "intermediate" | "pro"

type AskResponse = {
  tldr: string
  explanation: string
  steps?: { title: string; detail: string }[]
  fixed_code?: string
  diff?: string
  context_used?: string
  conversation_id?: string
}

type ChatTurn = {
  id: string
  question: string
  code?: string
  errorMsg?: string
  skill: SkillLevel
  response: AskResponse
}

type SavedConversation = {
  id: string              // unique local id for React keys + storage
  conversationId: string | null  // backend conversation_id
  title: string
  createdAt: number
  turns: ChatTurn[]
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
// Mock API function - replace with your actual API
async function askMentor(params: {
  question: string
  code_snippet: string | null
  error_message: string | null
  skill_level: SkillLevel
  conversation_id: string | null
}): Promise<AskResponse> {
  const res = await fetch(`${BACKEND_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed with status ${res.status}`)
  }

  return res.json()
}


export default function MentorApp() {
  const [question, setQuestion] = useState("")
  const [code, setCode] = useState("")
  const [errorMsg, setErrorMsg] = useState("")
  const [skill, setSkill] = useState<SkillLevel>("beginner")
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [showErrorInput, setShowErrorInput] = useState(false)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");


  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("conversationId")
    }
    return null
  })

  const [chat, setChat] = useState<ChatTurn[]>([])

  const [conversations, setConversations] = useState<SavedConversation[]>(() => {
    if (typeof window === "undefined") return []
  
    const raw = localStorage.getItem("mentor_conversations")
    if (!raw) return []
  
    try {
      const parsed = JSON.parse(raw) as any[]
      if (!Array.isArray(parsed)) return []
  
      const seenIds = new Set<string>()
  
      return parsed.map((c) => {
        // Try to reuse existing id, otherwise generate a new one
        let id: string =
          typeof c.id === "string" && c.id.length > 0 ? c.id : ""
  
        if (!id || seenIds.has(id)) {
          const fallback =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`
          id = fallback
        }
        seenIds.add(id)
  
        const conversationId: string | null =
          typeof c.conversationId === "string"
            ? c.conversationId
            : typeof c.conversation_id === "string"
            ? c.conversation_id
            : null
  
        const title: string =
          typeof c.title === "string" && c.title.trim().length > 0
            ? c.title
            : "Conversation"
  
        const createdAt: number =
          typeof c.createdAt === "number" ? c.createdAt : Date.now()
  
        const turns: ChatTurn[] = Array.isArray(c.turns) ? c.turns : []
  
        return {
          id,
          conversationId,
          title,
          createdAt,
          turns,
        } satisfies SavedConversation
      })
    } catch {
      return []
    }
  })
  

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("mentor_conversations", JSON.stringify(conversations))
    }
  }, [conversations])

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [chat, loading])
  const streamExplanation = (fullText: string, turnId: string) => {
    const CHUNK_SIZE = 2      // number of characters per tick
    const INTERVAL_MS = 25    // typing speed: lower = faster
  
    let index = 0
  
    const interval = setInterval(() => {
      index += CHUNK_SIZE
  
      setChat((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                response: {
                  ...t.response,
                  explanation: fullText.slice(0, index),
                },
              }
            : t,
        ),
      )
  
      if (index >= fullText.length) {
        clearInterval(interval)
      }
    }, INTERVAL_MS)
  }
  

  const handleAsk = async () => {
    if (!question.trim()) return
    setLoading(true)
    setErrorText(null)
  
    try {
      const data = await askMentor({
        question,
        code_snippet: code || null,
        error_message: errorMsg || null,
        skill_level: skill,
        conversation_id: conversationId,
      })
  
      if (!conversationId && data.conversation_id) {
        setConversationId(data.conversation_id)
        localStorage.setItem("conversationId", data.conversation_id)
      }
  
      const fullExplanation = data.explanation
  
      // Create a base response with empty explanation for streaming
      const baseResponse: AskResponse = {
        ...data,
        explanation: "", // we’ll fill this gradually
      }
  
      // Generate a stable id for this turn
      const turnId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`
  
      // Add the new turn with empty explanation
      setChat((prev) => [
        ...prev,
        {
          id: turnId,
          question,
          code: code || undefined,
          errorMsg: errorMsg || undefined,
          skill,
          response: baseResponse,
        },
      ])
  
      // Clear inputs for next question
      setQuestion("")
      setCode("")
      setErrorMsg("")
      setShowCodeInput(false)
      setShowErrorInput(false)
  
      // Start streaming the explanation into that turn
      streamExplanation(fullExplanation, turnId)
    } catch (err) {
      console.error(err)
      setErrorText("Something went wrong while calling the mentor API.")
    } finally {
      setLoading(false)
    }
  }
  

  const handleNewConversation = () => {
    if (chat.length > 0) {
      const firstTurn = chat[0]
  
      const baseTitle =
        firstTurn.question.trim().length > 0
          ? firstTurn.question.trim()
          : "New conversation"
  
      const title =
        baseTitle.length > 60 ? baseTitle.slice(0, 57) + "..." : baseTitle
  
      const storageId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`
  
      const newConv: SavedConversation = {
        id: storageId,
        conversationId: conversationId ?? null,
        title,
        createdAt: Date.now(),
        turns: chat,
      }
  
      setConversations((prev) => [newConv, ...prev])
    }
  
    setConversationId(null)
    if (typeof window !== "undefined") {
      localStorage.removeItem("conversationId")
    }
    setChat([])
    setQuestion("")
    setCode("")
    setErrorMsg("")
    setErrorText(null)
  }
  
  const handleLoadConversation = (conv: SavedConversation) => {
    setChat(conv.turns)
    setConversationId(conv.conversationId)
  
    if (typeof window !== "undefined") {
      if (conv.conversationId) {
        localStorage.setItem("conversationId", conv.conversationId)
      } else {
        localStorage.removeItem("conversationId")
      }
    }
  
    setSidebarOpen(false)
  }
  const startEditConversationTitle = (conv: SavedConversation) => {
    setEditingConversationId(conv.id)
    setEditTitleValue(conv.title)
  }
  
  const cancelEditConversationTitle = () => {
    setEditingConversationId(null)
    setEditTitleValue("")
  }
  
  const saveConversationTitle = (id: string) => {
    const trimmed = editTitleValue.trim()
    if (!trimmed) {
      // optional: fallback to “Untitled”
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title: "Untitled conversation" } : c,
        ),
      )
    } else {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title: trimmed } : c,
        ),
      )
    }
  
    cancelEditConversationTitle()
  }
  
  
  const handleDeleteConversation = (conv: SavedConversation) => {
    setConversations((prev) => prev.filter((c) => c.id !== conv.id))
  
    // If you delete the conversation you’re currently viewing, clear the UI
    if (conversationId && conv.conversationId === conversationId) {
      setConversationId(null)
      if (typeof window !== "undefined") {
        localStorage.removeItem("conversationId")
      }
      setChat([])
      setQuestion("")
      setCode("")
      setErrorMsg("")
      setErrorText(null)
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!loading && question.trim()) {
        handleAsk()
      }
    }
  }
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">RAG Engineering Mentor</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">AI-powered coding assistance</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleNewConversation} className="gap-2 bg-transparent">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Chat</span>
            </Button>

            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    Conversations
                  </SheetTitle>
                </SheetHeader>
                <ScrollArea className="h-[calc(100vh-8rem)] mt-4">
                  {conversations.length === 0 ? (
                    <div className="text-center py-8 px-4">
                      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No previous conversations yet. Start chatting and click &quot;New Chat&quot; to save.
                      </p>
                    </div>
                  ) : (
<div className="space-y-2 pr-4">
  {conversations.map((conv, index) => {
    const isEditing = editingConversationId === conv.id

    return (
      <div
        key={conv.id}
        className="group w-full p-3 rounded-lg border bg-card hover:bg-accent/60 transition-all duration-200 animate-in fade-in slide-in-from-right-2"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <div className="flex items-start gap-2">
          {isEditing ? (
            // 📝 Inline edit mode
            <input
              className="flex-1 text-sm px-2 py-1 rounded border bg-background outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              value={editTitleValue}
              autoFocus
              onChange={(e) => setEditTitleValue(e.target.value)}
              onBlur={() => saveConversationTitle(conv.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  saveConversationTitle(conv.id)
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  cancelEditConversationTitle()
                }
              }}
            />
          ) : (
            // 🔍 Normal view mode – click to load
            <button
              onClick={() => handleLoadConversation(conv)}
              className="flex-1 text-left"
            >
              <p className="font-medium text-sm line-clamp-2 mb-1">
                {conv.title || "Untitled conversation"}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(conv.createdAt).toLocaleDateString()}
              </p>
            </button>
          )}

          {/* Actions: rename + delete */}
          <div className="flex items-center gap-1">
            {!isEditing && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  startEditConversationTitle(conv)
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent transition"
                title="Rename chat"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteConversation(conv)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background hover:bg-destructive/10 text-xs text-destructive"
              title="Delete chat"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    )
  })}
</div>

                )}
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col min-h-0 max-w-4xl">
        <ScrollArea className="flex-1 pr-4">
          {chat.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center animate-in fade-in duration-500">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">How can I help you today?</h2>
              <p className="text-muted-foreground max-w-md">
                Ask coding questions, share code snippets, or describe errors you&apos;re facing. I&apos;ll provide
                step-by-step guidance tailored to your skill level.
              </p>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {chat.map((turn, index) => (
                <div
                  key={turn.id}
                  className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  {/* User Message */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] md:max-w-[75%]">
                      <div className="flex items-center gap-2 justify-end mb-1">
                        <Badge variant="secondary" className="text-xs">
                          {turn.skill}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" /> You
                        </span>
                      </div>
                      <Card className="bg-primary text-primary-foreground p-4 rounded-2xl rounded-tr-sm">
                        <p className="whitespace-pre-wrap">{turn.question}</p>
                        {turn.code && (
                          <pre className="mt-3 p-3 rounded-lg bg-primary-foreground/10 text-sm font-mono overflow-x-auto">
                            {turn.code}
                          </pre>
                        )}
                        {turn.errorMsg && (
                          <pre className="mt-3 p-3 rounded-lg bg-destructive/20 text-sm font-mono overflow-x-auto">
                            {turn.errorMsg}
                          </pre>
                        )}
                      </Card>
                    </div>
                  </div>

                  {/* Mentor Response */}
                  <div className="flex justify-start">
                    <div className="max-w-[85%] md:max-w-[75%]">
                      <span className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <Bot className="h-3 w-3" /> Mentor
                      </span>
                      <Card className="p-4 rounded-2xl rounded-tl-sm space-y-4">
                        {/* TL;DR */}
                        <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">TL;DR</p>
                          <p className="text-sm">{turn.response.tldr}</p>
                        </div>

                        {/* Explanation */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Explanation
                          </p>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{turn.response.explanation}</p>
                        </div>

                        {/* Steps */}
                        {turn.response.steps && turn.response.steps.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              Step-by-step
                            </p>
                            <ol className="space-y-3">
                              {turn.response.steps.map((step, idx) => (
                                <li key={idx} className="flex gap-3">
                                  <span className="shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                                    {idx + 1}
                                  </span>
                                  <div>
                                    <p className="font-medium text-sm">{step.title}</p>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{step.detail}</p>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {/* Fixed Code */}
                        {turn.response.fixed_code && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              Fixed Code
                            </p>
                            <pre className="p-3 rounded-lg bg-muted text-sm font-mono overflow-x-auto">
                              {turn.response.fixed_code}
                            </pre>
                          </div>
                        )}

                        {/* Diff */}
                        {turn.response.diff && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              Diff
                            </p>
                            <pre className="p-3 rounded-lg bg-muted text-sm font-mono overflow-x-auto">
                              {turn.response.diff}
                            </pre>
                          </div>
                        )}

                        {/* Context Used */}
                        {turn.response.context_used && (
                          <Collapsible>
                            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                              <ChevronDown className="h-3 w-3" />
                              Context used (debug)
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <pre className="mt-2 p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto">
                                {turn.response.context_used}
                              </pre>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </Card>
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start animate-in fade-in duration-300">
                  <div className="max-w-[85%] md:max-w-[75%]">
                    <span className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <Bot className="h-3 w-3" /> Mentor
                    </span>
                    <Card className="p-4 rounded-2xl rounded-tl-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span
                            className="h-2 w-2 rounded-full bg-primary animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="h-2 w-2 rounded-full bg-primary animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="h-2 w-2 rounded-full bg-primary animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                        <span className="text-sm text-muted-foreground">Thinking...</span>
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input Panel */}
        <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {errorText && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorText}
            </div>
          )}

          <Card className="p-4">
            <div className="space-y-3">
              {/* Optional inputs */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={showCodeInput ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowCodeInput(!showCodeInput)}
                  className="gap-2"
                >
                  <Code className="h-4 w-4" />
                  Add Code
                </Button>
                <Button
                  variant={showErrorInput ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowErrorInput(!showErrorInput)}
                  className="gap-2"
                >
                  <AlertCircle className="h-4 w-4" />
                  Add Error
                </Button>
                <div className="flex-1" />
                <Select value={skill} onValueChange={(value) => setSkill(value as SkillLevel)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Code Input */}
              {showCodeInput && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Code snippet</label>
                  <Textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Paste your code here..."
                    className="font-mono text-sm min-h-[100px]"
                  />
                </div>
              )}

              {/* Error Input */}
              {showErrorInput && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Error message</label>
                  <Textarea
                    value={errorMsg}
                    onChange={(e) => setErrorMsg(e.target.value)}
                    placeholder="Paste the error message..."
                    className="font-mono text-sm min-h-[80px]"
                  />
                </div>
              )}

              {/* Question Input */}
              <div className="flex gap-2">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask your coding question..."
                  className="min-h-[44px] max-h-[200px] resize-none"
                  rows={1}
                />
                <Button
                  onClick={handleAsk}
                  disabled={loading || !question.trim()}
                  size="icon"
                  className="h-11 w-11 shrink-0"
                >
                  <Send className={cn("h-4 w-4 transition-transform", loading && "animate-pulse")} />
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Press Enter to send • Shift + Enter for new line
              </p>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
