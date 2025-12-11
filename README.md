# Slack Message Topic Categorizer

AI-powered Slack message categorization system using Weaviate vector database and OpenAI. Automatically organizes messages into specific, actionable topics using semantic search and intelligent categorization.

## 🏗️ Architecture

```
src/
├── index.js                    # Main entry point & exports
├── categorizer.js              # Main categorization orchestration
├── config/
│   └── constants.js            # Configuration & constants
├── context/
│   └── conversation.js         # Conversation context management
├── prompts/
│   └── system-prompt.js        # AI agent system prompt
├── search/
│   ├── index.js                # Search module exports
│   ├── hybrid.js               # Hybrid search (BM25 + Vector)
│   ├── semantic.js             # Semantic/Vector search
│   ├── keyword.js              # BM25 keyword search
│   └── rrf.js                  # Reciprocal Rank Fusion
├── services/
│   ├── openai.js               # OpenAI client
│   ├── slack.js                # Slack API helpers
│   └── database.js             # Weaviate operations
├── tools/
│   ├── index.js                # Tool exports
│   ├── definitions.js          # OpenAI function definitions
│   └── handlers.js             # Tool implementations
└── utils/
    ├── index.js                # Utility exports
    ├── text.js                 # Text processing
    ├── similarity.js           # String similarity algorithms
    ├── embedding.js            # Embedding text builders
    └── logger.js               # Logging utilities
```

## 📋 Prerequisites

- Node.js 18+ (ES modules)
- Docker (for Weaviate)
- OpenAI API key
- Slack API key (optional, for fetching messages)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
# Weaviate
WEAVIATE_URL=http://localhost:8080

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Slack (optional)
SLACK_API_KEY=your_slack_api_key
```

### 3. Start Weaviate

```bash
npm run weaviate:start
```

### 4. Setup Database Schema

```bash
npm run setup
```

### 5. Process Messages

```bash
npm run process
```

## 📊 Dashboard

Open the interactive dashboard to view topics and messages:

```bash
npm run dashboard
```

Features:
- **Topics View**: Browse discovered topics with stats, keywords, and contributors
- **Messages Browser**: Search and filter all embedded messages with multiple views:
  - Cards view
  - Timeline view
  - Compact table view
- **Charts and analytics**
- **Dark mode support**
- **Export functionality**

## 🎯 How It Works

1. **Context Gathering**: Fetches conversation history, thread info, and channel state
2. **Iterative Search**: 
   - Uses hybrid search (semantic + keyword) with RRF fusion
   - **Iterates** with different queries if initial search yields low confidence
3. **Confidence Scoring**: Calculates match confidence using multiple factors (Semantic, Keyword, Name Similarity)
4. **Decision Making**: AI agent decides to assign to existing topic or create new one
   - **Anti-Duplication**: Prioritizes existing topics over creating duplicates
   - **Specific Topics**: Enforces specific, actionable topics (no generic categories)
5. **Storage**: Message stored and linked to topic with updated embeddings

### Search Strategy

The system uses **Reciprocal Rank Fusion (RRF)** to combine:
- Hybrid search (BM25 + Vector)
- Pure semantic/vector search (Weighted highly for meaning capture)
- BM25 keyword search

This ensures both exact keyword matches and semantic similarity are considered, with a bias towards semantic understanding to catch topics with different wording.

## 📝 Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Initialize database schema |
| `npm run reset` | Delete all data |
| `npm run reset-all` | Delete and recreate schema |
| `npm run process` | Process messages from JSON |
| `npm run test` | Process first 10 messages |
| `npm run weaviate:start` | Start Weaviate container |
| `npm run weaviate:stop` | Stop Weaviate container |
| `npm run dashboard` | Open web dashboard |
| `npm run fetch-messages` | Fetch messages from Slack |

## 🔧 Configuration

### Constants (src/config/constants.js)

- `MODEL`: OpenAI model (default: 'gpt-4o')
- `MAX_TOPICS_LIMIT`: Max topics to fetch (default: 50)
- `RRF_K`: RRF fusion constant (default: 60)
- `CONVERSATION_TIMEOUT_MINUTES`: Context timeout (default: 10)

## 📁 Files

```
├── src/                    # Modular source code
├── smart-categorizer.js    # Re-export for backwards compatibility
├── weaviate-setup.js       # Database schema setup
├── webhook-simulator.js    # Message processor
├── slack-tester.js         # Slack message fetcher
├── dashboard.html          # Web dashboard
├── docker-compose.yml      # Weaviate container config
├── package.json            # Dependencies & scripts
└── .env                    # Environment variables
```

## 📈 Usage Example

```javascript
import { categorizeMessage, getAllTopics, resetContext } from './src/index.js';

// Categorize a message
const result = await categorizeMessage(
  { text: 'The OAuth token refresh is failing on staging', user: 'U123', ts: '123.456' },
  { id: 'C123', name: 'engineering' }
);

console.log(result);
// { topicId: '...', topicName: 'OAuth token refresh failure', decision: 'create', ... }

// Get all topics
const topics = await getAllTopics();

// Reset conversation context
resetContext();
```

## 🔍 Search API

```javascript
import { hybridSearchTopics, semanticSearchTopics, keywordSearchTopics } from './src/search/index.js';

// Hybrid search
const results = await hybridSearchTopics('OAuth authentication', 10);

// Semantic search
const similar = await semanticSearchTopics('login issues', 10);

// Keyword search
const exact = await keywordSearchTopics('OAuth token', 10);
```

## 🐛 Troubleshooting

### Weaviate Connection Error

```bash
# Check if Weaviate is running
docker ps | grep weaviate

# Start Weaviate
npm run weaviate:start

# View logs
npm run weaviate:logs
```

### No Data in Dashboard

1. Ensure schema is setup: `npm run setup`
2. Process messages: `npm run process`
3. Refresh dashboard

## 📄 License

MIT
