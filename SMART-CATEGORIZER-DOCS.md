# 🤖 Smart Categorizer Agent - Complete Documentation

> An intelligent Slack message categorization system that uses LLM-powered agents to automatically organize messages into topics.

---

## 🚀 NEW: Optimized 3-Tool Architecture

The categorizer has been optimized from **13 tools down to 3 focused tools**, resulting in:

| Metric | Before | After |
|--------|--------|-------|
| **Tools** | 13 | 3 |
| **Avg Iterations** | 2-3 | 1-2 (with optional deep dive up to 5) |
| **Tokens/message** | ~4,000 | ~1,500 |
| **Latency** | 850ms-1.7s | 400-800ms |
| **Cost/message** | ~$0.02 | ~$0.007 |

### The 3 Optimized Tools

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OPTIMIZED TOOL ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. GET_CONTEXT                                                            │
│   ────────────────                                                          │
│   Returns ALL context in 1 call:                                            │
│   • Current message info                                                    │
│   • Thread parent (if exists) with its topic                                │
│   • Recent messages with their topics                                       │
│   • Channel state and current topic                                         │
│                                                                             │
│   2. FIND_TOPICS                                                            │
│   ────────────────                                                          │
│   Smart unified search with:                                                │
│   • Hybrid search (BM25 + Vector)                                           │
│   • RRF (Reciprocal Rank Fusion) ranking                                    │
│   • Confidence scores                                                       │
│   • Automatic recommendations                                               │
│                                                                             │
│   3. CATEGORIZE                                                             │
│   ────────────────                                                          │
│   Final decision:                                                           │
│   • action: "assign" | "create"                                             │
│   • topic_id (if assign)                                                    │
│   • new_topic { name, description, keywords } (if create)                   │
│   • reasoning                                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### RRF (Reciprocal Rank Fusion) Search Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RETRIEVAL PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  INPUT: "let's migrate to postgres"                                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 1: PARALLEL RETRIEVAL                                         │   │
│  │                                                                      │   │
│  │  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐ │   │
│  │  │ Hybrid Search    │   │ Vector (Semantic)│   │ BM25 (Keyword)   │ │   │
│  │  └────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘ │   │
│  │           └───────────────────────┴──────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 2: RECIPROCAL RANK FUSION (RRF)                               │   │
│  │                                                                      │   │
│  │  Merge results with: RRF_score = Σ 1/(k + rank_i)                   │   │
│  │                                                                      │   │
│  │  Topic "Database Migration":                                        │   │
│  │    Hybrid rank: 1  → 1/(60+1) = 0.0164                              │   │
│  │    Vector rank: 2  → 1/(60+2) = 0.0161                              │   │
│  │    BM25 rank: 1    → 1/(60+1) = 0.0164                              │   │
│  │    RRF Score: 0.0489 ✓ (highest)                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 3: CONFIDENCE SCORING (Updated Weights)                       │   │
│  │                                                                      │   │
│  │  confidence = weighted_average(                                     │   │
│  │    rrf_score      × 0.50, (Strong semantic focus)                   │   │
│  │    keyword_overlap × 0.25,                                           │   │
│  │    name_similarity × 0.15,                                           │   │
│  │    recency_boost   × 0.10                                            │   │
│  │  )                                                                  │   │
│  │                                                                      │   │
│  │  confidence >= 0.80 → "assign" (high confidence)                    │   │
│  │  confidence 0.50-0.79 → "review" (iterate search)                   │   │
│  │  confidence < 0.50 → "create" (likely new topic)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Improved Embedding Strategy

Topics now use structured embedding text for better retrieval:

```javascript
// Structured embedding for topics
TOPIC: Database Migration
DESCRIPTION: Discussions about migrating databases, schema changes, and data transfer
KEYWORDS: postgres, migration, sql, schema, database, transfer
EXAMPLE MESSAGES:
- let's migrate to postgres
- schema changes are ready for review
- we need to backup before migration
USERS: Hossein, Ali
```

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Agent Flow Diagrams](#agent-flow-diagrams)
5. [Tool Reference](#tool-reference)
6. [Topic Matching Algorithm](#topic-matching-algorithm)
7. [Data Flow](#data-flow)
8. [Configuration](#configuration)

---

## 🎯 Overview

The Smart Categorizer is an AI-powered system that automatically categorizes Slack messages into topics. It uses:

- **OpenAI GPT-4o** for intelligent decision making
- **Weaviate Vector Database** for semantic search and storage
- **Agentic Architecture** with tool-calling capabilities
- **Multi-iteration Tool Loop** for dynamic exploration and decision making

### Key Features

| Feature | Description |
|---------|-------------|
| 🧵 **Thread Awareness** | Handles thread replies by inheriting parent topic |
| 🌍 **Bilingual Support** | Understands Persian (Farsi) and English messages |
| 🔍 **Iterative Search** | Tries multiple search queries if first attempt is low confidence |
| 🛡️ **Duplicate Prevention** | Strong semantic matching & fuzzy logic prevents duplicates |
| 🚫 **Category Ban** | Enforces specific "Topics" over generic "Categories" |
| 🔧 **Optimized 3-Tool Architecture** | Focused tools with RRF ranking for fast, accurate decisions |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SMART CATEGORIZER SYSTEM                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Slack API  │───▶│  Message     │───▶│    Agent     │                  │
│  │   Messages   │    │  Receiver    │    │   Processor  │                  │
│  └──────────────┘    └──────────────┘    └──────┬───────┘                  │
│                                                  │                          │
│                                                  ▼                          │
│                                     ┌─────────────────────┐                 │
│                                     │    AGENT MODE       │                 │
│                                     │   (Multi-Turn)      │                 │
│                                     │                     │                 │
│                                     │ • Iterative Search  │                 │
│                                     │ • 2-3 attempts      │                 │
│                                     │   if needed         │                 │
│                                     │ • Context-aware     │                 │
│                                     │   decisions         │                 │
│                                     └──────────┬──────────┘                 │
│                                                │                            │
│                                                ▼                            │
│                                     ┌─────────────────┐                     │
│                                     │    Decision     │                     │
│                                     │    Executor     │                     │
│                                     └────────┬────────┘                     │
│                                              │                              │
│                         ┌────────────────────┴────────────────┐             │
│                         │                                     │             │
│                         ▼                                     ▼             │
│                ┌─────────────────┐               ┌─────────────────┐        │
│                │  ASSIGN TOPIC   │               │  CREATE TOPIC   │        │
│                │                 │               │                 │        │
│                │ Link message    │               │ • Validate      │        │
│                │ to existing     │               │   uniqueness    │        │
│                │ topic           │               │ • Create in DB  │        │
│                └────────┬────────┘               │ • Link message  │        │
│                         │                        └────────┬────────┘        │
│                         │                                 │                 │
│                         └────────────────┬────────────────┘                 │
│                                          │                                  │
│                                          ▼                                  │
│                                 ┌─────────────────┐                         │
│                                 │    Weaviate     │                         │
│                                 │    Database     │                         │
│                                 │                 │                         │
│                                 │ • SlackMessage  │                         │
│                                 │ • Topic         │                         │
│                                 └─────────────────┘                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Core Components

### 1. Entry Point

```javascript
// Main entry point
categorizeMessage(message, channelInfo, options)
```

### 2. Component Breakdown

| Component | Lines | Purpose |
|-----------|-------|---------|
| **Slack API Layer** | 26-87 | Fetch messages from Slack channels |
| **Tool Definitions** | 100-358 | 3 tools for agent to use |
| **System Prompts** | 363-677 | Instructions for LLM |
| **Helper Functions** | 720-937 | Text processing, fuzzy matching |
| **Topic Matching** | 942-1029 | Duplicate detection algorithms |
| **Database Queries** | 1034-1119 | Weaviate GraphQL operations |
| **Tool Handlers** | 1125-1581 | Tool implementation logic |
| **Agentic Loop** | 1759-2014 | Multi-iteration agent |

---

## 📊 Agent Flow Diagrams

### Main Categorization Flow

```
                              ┌────────────────────────┐
                              │    NEW SLACK MESSAGE   │
                              │                        │
                              │  text: "حله"           │
                              │  user: "U123"          │
                              │  ts: "1234567890.001"  │
                              └───────────┬────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   VALIDATE MESSAGE     │
                              │                        │
                              │  Empty? Skip ──────────┼──▶ null
                              └───────────┬────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   INITIALIZE AGENT     │
                              │                        │
                              │  • Set current message │
                              │  • Set channel info    │
                              │  • Prepare tools       │
                              └───────────┬────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   AGENT LOOP           │
                              │                        │
                              │  Max 5 iterations      │
                              │  ─────────────────     │
                              │  1. Call LLM           │
                              │  2. Execute tools      │
                              │  3. Check for decision │
                              │  4. Retry Search if Low Conf │
                              └───────────┬────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   DECISION             │
                              │                        │
                              │  ┌─────────────────┐   │
                              │  │ action: assign  │   │
                              │  │ topic_id: ...   │   │
                              │  │ reasoning: ...  │   │
                              │  └─────────────────┘   │
                              │         OR             │
                              │  ┌─────────────────┐   │
                              │  │ action: create  │   │
                              │  │ name: ...       │   │
                              │  │ keywords: ...   │   │
                              │  └─────────────────┘   │
                              └───────────┬────────────┘
                                          │
                                          ▼
                        ┌─────────────────┴─────────────────┐
                        │                                   │
                        ▼                                   ▼
              ┌─────────────────┐                 ┌─────────────────┐
              │  ASSIGN TOPIC   │                 │  CREATE TOPIC   │
              │                 │                 │                 │
              │  Use existing   │                 │  1. Validate    │
              │  topic UUID     │                 │     uniqueness  │
              └────────┬────────┘                 │  2. Create in   │
                       │                          │     Weaviate    │
                       │                          └────────┬────────┘
                       │                                   │
                       └─────────────────┬─────────────────┘
                                         │
                                         ▼
                              ┌────────────────────────┐
                              │  STORE MESSAGE         │
                              │                        │
                              │  1. Create SlackMsg    │
                              │  2. Link to Topic      │
                              │  3. Update topic count │
                              │  4. Update context     │
                              └───────────┬────────────┘
```

### Agent Tool-Calling Loop (Optimized Iterative Flow)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OPTIMIZED AGENT EXECUTION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     ITERATION 1                                      │   │
│   │   User: "Categorize this message: 'The cache is broken'"            │   │
│   │   Tool: get_context()                                               │   │
│   │   Tool: find_topics("cache broken")                                 │   │
│   │   Result: Low confidence matches (< 0.5)                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     ITERATION 2 (RETRY STRATEGY)                     │   │
│   │   Agent: "Search for 'cache' yielded poor results.                  │   │
│   │           Trying broader terms."                                    │   │
│   │   Tool: find_topics("redis memory failure error")                   │   │
│   │   Result: Match Found! "Redis Production Issues" (0.85 conf)        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     ITERATION 3 (DECISION)                           │   │
│   │   Tool: categorize(action: "assign", topic: "Redis Prod Issues")    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Tool Reference (Optimized 3-Tool Architecture)

### Tool 1: `get_context` - Always Call First

```javascript
{
  name: "get_context",
  description: "Get all relevant context for the current message in a single call.",
  parameters: {
    message_count: { type: "integer", default: 5, max: 10 }
  }
}
```

**Returns:**
- `current_message` - Text, user, length, is_short, is_thread_reply
- `thread_parent` - Parent text, user, topic (if thread reply)
- `recent_messages` - Last N messages with their topics
- `channel` - Name, current_topic, last_activity_minutes_ago
- `hint` - Recommendation based on context

### Tool 2: `find_topics` - Search with RRF Ranking

```javascript
{
  name: "find_topics",
  description: "Search for matching topics using hybrid search with automatic ranking.",
  parameters: {
    query: { type: "string", required: true },
    include_all: { type: "boolean", default: false }
  }
}
```

**Returns:**
- `matches` - Array of topics with confidence scores and match_reasons
- `recommendation` - { action, confidence, suggested_topic_id, reason }
- `query_keywords` - Extracted keywords from query
- `all_topics` - (if include_all=true) List of all topics

**Confidence Thresholds:**
| Confidence | Recommendation |
|------------|----------------|
| ≥ 0.80 | `assign` - High confidence match |
| 0.50-0.79 | `review` - Agent iterates with new search terms |
| < 0.50 | `create` - Likely new topic (only after retries) |

### Tool 3: `categorize` - Final Decision

```javascript
{
  name: "categorize",
  description: "Make the final categorization decision. Call this LAST.",
  parameters: {
    action: { enum: ["assign", "create"], required: true },
    topic_id: { type: "string", required_if: "action=assign" },
    topic_name: { type: "string", required_if: "action=assign" },
    new_topic: {
      name: { type: "string" },
      description: { type: "string" },
      keywords: { type: "array" }
    },
    reasoning: { type: "string", required: true }
  }
}
```

### Workflow

```
1. get_context()           → Understand conversation
2. find_topics(query)      → RRF search (Iterate if needed)
3. categorize(action, ...) → Make final decision
```

---

## 📦 Data Flow

### Database Schema (Weaviate)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WEAVIATE SCHEMA                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌────────────────────────────────────────────────────────────────────┐    │
│   │                          Topic                                      │    │
│   ├────────────────────────────────────────────────────────────────────┤    │
│   │  _additional.id    : UUID (auto-generated)                         │    │
│   │  name              : string   "Database Migration"                  │    │
│   │  description       : string   "Messages about database migration"  │    │
│   │  keywords          : string[] ["postgres", "migration", "sql"]      │    │
│   │  users             : string[] ["Hossein", "Ali"]                    │    │
│   │  combinedSearchText: string   (for embedding)                       │    │
│   │  messageCount      : int      42                                    │    │
│   │  createdAt         : datetime                                       │    │
│   │  updatedAt         : datetime                                       │    │
│   └────────────────────────────────────────────────────────────────────┘    │
│                                      │                                      │
│                                      │ 1:N Reference                        │
│                                      ▼                                      │
│   ┌────────────────────────────────────────────────────────────────────┐    │
│   │                       SlackMessage                                  │    │
│   ├────────────────────────────────────────────────────────────────────┤    │
│   │  _additional.id : UUID (auto-generated)                            │    │
│   │  text           : string   "let's migrate to postgres"             │    │
│   │  user           : string   "U123ABC"                                │    │
│   │  userName       : string   "Hossein Molavi"                         │    │
│   │  timestamp      : string   "1234567890.001234"                      │    │
│   │  channelId      : string   "C123ABC"                                │    │
│   │  channelName    : string   "dev-team"                               │    │
│   │  threadTs       : string   (null if not thread reply)              │    │
│   │  processedAt    : datetime                                          │    │
│   │  topic          : Reference → Topic                                 │    │
│   └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚙️ Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...        # OpenAI API key for GPT-4o-mini
SLACK_API_KEY=xoxb-...       # Slack Bot OAuth token

# Weaviate (configured in weaviate-setup.js)
WEAVIATE_URL=http://localhost:8080
```

### Tunable Constants

```javascript
// Model Configuration
const MODEL = 'gpt-4o';                   // LLM model

// Processing Limits
const CONVERSATION_TIMEOUT_MINUTES = 10;  // Max gap for "same conversation"
const TEXT_PREVIEW_LENGTH = 150;          // Truncation length for previews
const MAX_TOPICS_LIMIT = 50;              // Max topics to fetch at once
const RRF_K = 60;                         // RRF constant (higher = more weight to top ranks)

// Agent Loop
const maxIterations = 5;                  // Max tool calls per message

// Confidence Thresholds (for find_topics recommendations)
// >= 0.80: High confidence → assign
// 0.50-0.79: Review → agent iterates
// < 0.50: Low confidence → likely create new (after retries)
```

---

## 🧪 Usage Examples

### Basic Usage

```javascript
import { categorizeMessage } from './smart-categorizer.js';

const message = {
  text: 'we should migrate the database to postgres',
  user: 'U123ABC',
  ts: '1234567890.001234',
  thread_ts: null
};

const channelInfo = {
  id: 'C123ABC',
  name: 'dev-team'
};

const result = await categorizeMessage(message, channelInfo);
// {
//   messageId: 'uuid-...',
//   topicId: 'uuid-...',
//   topicName: 'Database Migration',
//   decision: 'assign' | 'create',
//   reasoning: 'Message about database migration fits existing topic',
//   processingTime: 1523,
//   iterations: 3
// }
```

---

## 📝 Summary

The Smart Categorizer is a sophisticated agentic system that:

1. **Uses optimized 3-tool architecture** for fast, focused decision making
2. **Employs RRF (Reciprocal Rank Fusion)** to combine multiple search strategies
3. **Understands context** through conversation history and thread relationships
4. **Prevents duplicates** with fuzzy matching and abbreviation expansion
5. **Iteratively Searches** to find the best match before creating new topics
6. **Stores relationships** in Weaviate for future semantic search

### Optimized Workflow

```
1. get_context()       → Fetch ALL context in one call
2. find_topics(query)  → RRF-ranked search with confidence scores
3. categorize(action)  → Make final decision
```

Each message is processed through a maximum of 5 iterations, ensuring thoroughness without infinite loops.
