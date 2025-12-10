import { client } from './weaviate-setup.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-4o';

// Slack API configuration
const SLACK_API_KEY = process.env.SLACK_API_KEY;
const SLACK_API_BASE = 'https://slack.com/api';

// ============================================================================
// Constants
// ============================================================================

const CONVERSATION_TIMEOUT_MINUTES = 10;
const TEXT_PREVIEW_LENGTH = 150;
const MAX_TOPICS_LIMIT = 50;
const RRF_K = 60; // Reciprocal Rank Fusion constant

const TOPIC_FIELDS = `
  name
  description
  keywords
  users
  sampleMessages
  combinedSearchText
  messageCount
  _additional { id }
`;

const MESSAGE_WITH_TOPIC_FIELDS = `
  text
  user
  userName
  timestamp
  topic {
    ... on Topic {
      name
      users
      _additional { id }
    }
  }
`;

// ============================================================================
// Slack API Helpers
// ============================================================================

async function slackApiCall(endpoint, params = {}) {
  const url = new URL(`${SLACK_API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${SLACK_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
  }

  return data;
}

async function fetchMessagesBefore(channelId, beforeTs, count = 5) {
  try {
    const response = await slackApiCall('conversations.history', {
      channel: channelId,
      latest: beforeTs,
      limit: count,
      inclusive: false,
    });
    return response.messages.reverse();
  } catch (error) {
    console.error(`Error fetching Slack messages: ${error.message}`);
    return [];
  }
}

async function fetchThreadMessages(channelId, threadTs) {
  try {
    const response = await slackApiCall('conversations.replies', {
      channel: channelId,
      ts: threadTs,
      limit: 100,
    });
    return response.messages || [];
  } catch (error) {
    console.error(`Error fetching thread messages: ${error.message}`);
    return [];
  }
}

// ============================================================================
// In-memory Conversation Context
// ============================================================================

const conversationContext = {};

// ============================================================================
// OPTIMIZED: 3 Tool Definitions
// ============================================================================

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_context',
      description: 'Get all relevant context for the current message in a single call. Always call this FIRST.',
      parameters: {
        type: 'object',
        properties: {
          message_count: {
            type: 'integer',
            description: 'Number of recent messages to fetch (default: 5, max: 10)',
            default: 5,
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_topics',
      description: 'Search for matching topics using the message content. Uses hybrid search (semantic + keyword) with automatic ranking.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query - use the message text or extracted keywords',
          },
          include_all: {
            type: 'boolean',
            description: 'If true, also returns all topics (for overview). Default: false',
            default: false,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'categorize',
      description: 'Make the final categorization decision. Call this LAST after gathering context and finding topics.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['assign', 'create'],
            description: 'Whether to assign to existing topic or create new one',
          },
          topic_id: {
            type: 'string',
            description: 'Required if action="assign". The UUID of the existing topic',
          },
          topic_name: {
            type: 'string',
            description: 'Required if action="assign". The name of the topic (for logging)',
          },
          new_topic: {
            type: 'object',
            description: 'Required if action="create". The new topic details',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              keywords: { type: 'array', items: { type: 'string' } },
            },
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this categorization was chosen',
          },
        },
        required: ['action', 'reasoning'],
      },
    },
  },
];

// ============================================================================
// OPTIMIZED System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are an expert message categorization agent. Your job is to accurately assign Slack messages to specific, actionable topics.

## CORE PRINCIPLE

**Iterate until confident.** Do not rush to a decision. Gather context, search thoroughly, and only categorize when you have high confidence. It's better to make one extra tool call than to miscategorize.

## TOOLS AVAILABLE

1. **get_context** - Fetches conversation history, thread info, and channel state
2. **find_topics** - Searches existing topics using semantic + keyword matching
3. **categorize** - Makes final decision (assign to existing OR create new)

## DECISION FRAMEWORK

\`\`\`
START
  │
  ▼
┌─────────────────────────────────────┐
│ 1. ALWAYS call get_context first    │
└─────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────┐
│ Is this a THREAD REPLY?             │
│ (thread_parent exists with topic)   │
└─────────────────────────────────────┘
  │
  ├─YES──▶ ASSIGN to parent's topic (done)
  │
  ▼ NO
┌─────────────────────────────────────┐
│ Is message SHORT (< 15 chars)?      │
│ Examples: "ok", "حله", "done", "👍" │
└─────────────────────────────────────┘
  │
  ├─YES──▶ Look at recent_messages and channel.current_topic
  │        If recent activity on a topic → ASSIGN to that topic
  │        If no recent context → Call find_topics with context from recent messages
  │
  ▼ NO (substantive message)
┌─────────────────────────────────────┐
│ 2. Call find_topics                 │
│    Query: Use key terms from msg    │
└─────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────┐
│ Evaluate matches:                   │
│                                     │
│ confidence ≥ 0.80  → ASSIGN         │
│ confidence 0.50-0.79 → REVIEW       │
│ confidence < 0.50  → likely CREATE  │
└─────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────┐
│ If REVIEW needed:                   │
│ - Check if message truly fits       │
│ - Look at sample_messages           │
│ - Consider if topic is too broad    │
│ - If uncertain, CREATE new topic    │
└─────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────┐
│ 3. Call categorize with decision    │
└─────────────────────────────────────┘
\`\`\`

## WHEN TO ITERATE MORE

Call additional tools when:
- Short message but no clear context → get_context with more messages
- find_topics returns ambiguous results → try different query terms
- Multiple topics seem relevant → examine sample_messages to differentiate
- Message contains multiple subjects → focus on the PRIMARY subject

## SEARCH QUERY STRATEGY

**Good queries** extract the core subject:
- Message: "the OAuth token refresh is failing on staging"
  Query: "OAuth token refresh staging" ✅
  
- Message: "can someone look at the dashboard loading issue?"
  Query: "dashboard loading performance" ✅

- Message: "حله، مرسی"
  Query: DON'T search. Use context from recent messages instead.

**Bad queries:**
- Using the entire message verbatim (too noisy)
- Single generic words like "issue" or "bug"
- Including filler words

## TOPIC CREATION RULES

### Topics are SPECIFIC ISSUES, not categories

\`\`\`
WRONG (Categories):           RIGHT (Specific Topics):
─────────────────────────────────────────────────────────
"API Issues"                  "Payment API timeout errors"
"Bug Fixes"                   "User signup email not sending"
"Backend Work"                "Redis cache invalidation bug"
"Frontend Tasks"              "Dashboard charts not loading on Safari"
"Database"                    "PostgreSQL migration from MySQL"
"Deployment"                  "CI pipeline failing on Node 20 upgrade"
"Infrastructure"              "AWS Lambda cold start optimization"
\`\`\`

### Good topic names include:
- The specific component/feature affected
- The nature of the issue or task
- Relevant context (environment, date, user impact)

### Topic name patterns:
- "[Component] [Problem/Action]" → "Stripe webhook signature verification"
- "[Feature] [Specific Issue]" → "User onboarding email delay"
- "[Task] - [Context]" → "API rate limiting - v2 implementation"

### Before creating a topic, verify:
1. No existing topic covers this (check find_topics results carefully)
2. The name is specific enough that future messages can match it
3. It's not a category that would absorb unrelated messages

## HANDLING AMBIGUOUS MESSAGES

### Message seems to fit multiple topics:
→ Choose the MORE SPECIFIC topic, not a broader one
→ If truly ambiguous, prefer the topic with recent activity

### Message is a reply/continuation but not in a thread:
→ Check recent_messages for context
→ If discussing same subject as recent messages, use that topic

### Message introduces a new aspect of existing topic:
→ Still assign to existing topic (topics evolve)
→ Only create new topic if it's a genuinely SEPARATE issue

### Message is in a different language:
→ Persian, English, or mixed are all valid
→ Search queries should use the language of key terms
→ Topic names can be in any language (prefer the language used in messages)

## CONFIDENCE THRESHOLDS

| Confidence | Action |
|------------|--------|
| ≥ 0.80 | ASSIGN - High confidence match |
| 0.65-0.79 | ASSIGN if context supports, else investigate more |
| 0.50-0.64 | Likely CREATE unless context strongly suggests existing topic |
| < 0.50 | CREATE new topic |

## CRITICAL RULES

1. **Never create duplicate topics** - If find_topics returns a match ≥ 0.50, strongly consider using it
2. **Never create categories** - "Bug Fixes", "General Discussion", "Misc" are FORBIDDEN
3. **Always provide reasoning** - Explain why you chose to assign or create
4. **Short messages inherit context** - "ok", "done", "👍" should use the topic from recent conversation
5. **When in doubt, gather more context** - Call get_context or find_topics again with different parameters

## EXAMPLES

### Example 1: Clear match
Message: "the Stripe webhook is returning 401"
→ get_context (check recent discussion)
→ find_topics("Stripe webhook 401 authentication")
→ If match with confidence 0.85 → ASSIGN
→ If no match → CREATE "Stripe webhook authentication failure"

### Example 2: Short confirmation
Message: "حله"
→ get_context shows recent discussion about "PostgreSQL migration"
→ ASSIGN to "PostgreSQL migration" (don't search, use context)

### Example 3: Ambiguous
Message: "this is taking forever"
→ get_context (what are they referring to?)
→ If recent messages discuss "CI pipeline" → ASSIGN to that topic
→ If no context → Ask yourself: can I categorize this? If not, use fallback

### Example 4: New subject
Message: "we need to add rate limiting to the public API"
→ get_context (is this continuing a discussion?)
→ find_topics("API rate limiting")
→ No good matches → CREATE "Public API rate limiting implementation"

## OUTPUT

Always end with the \`categorize\` tool. Include:
- action: "assign" or "create"
- For assign: topic_id, topic_name
- For create: new_topic with specific name, description, and keywords
- reasoning: Brief explanation of your decision`;
// ============================================================================
// Helper Functions
// ============================================================================

const getMinutesBetween = (ts1, ts2) => 
  Math.round((parseFloat(ts1) - parseFloat(ts2)) / 60);

const truncate = (text, maxLength = TEXT_PREVIEW_LENGTH) => {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
};

const extractTopicInfo = (topic) => {
  if (!topic?.[0]) return null;
  return {
    id: topic[0]._additional?.id,
    name: topic[0].name,
  };
};

// ============================================================================
// Improved Embedding Strategy
// ============================================================================

/**
 * Build structured embedding text for topics
 * Optimized for better semantic retrieval
 */
function buildTopicEmbeddingText(topic) {
  const parts = [
    `TOPIC: ${topic.name}`,
    `DESCRIPTION: ${topic.description || topic.name}`,
    `KEYWORDS: ${(topic.keywords || []).join(', ')}`,
  ];
  
  // Add representative messages (critical for retrieval!)
  if (topic.sampleMessages?.length > 0) {
    parts.push(`EXAMPLE MESSAGES:`);
    topic.sampleMessages.slice(0, 5).forEach(msg => {
      parts.push(`- ${msg}`);
    });
  }
  
  // Add users for context
  if (topic.users?.length > 0) {
    parts.push(`USERS: ${topic.users.join(', ')}`);
  }
  
  return parts.join('\n');
}

/**
 * Build embedding text for messages with context window
 */
function buildMessageEmbeddingText(message, context) {
  const parts = [`MESSAGE: ${message.text}`];
  
  // Add conversation context for short messages
  if (message.text.length < 50 && context?.recent?.length > 0) {
    parts.push(`CONTEXT:`);
    context.recent.slice(0, 3).forEach(msg => {
      parts.push(`- ${msg.text}`);
    });
  }
  
  return parts.join('\n');
}

// ============================================================================
// Text Processing Utilities
// ============================================================================

const ABBREVIATIONS = {
  'db': 'database',
  'k8s': 'kubernetes',
  'auth': 'authentication',
  'api': 'application programming interface',
  'ui': 'user interface',
  'ux': 'user experience',
  'fe': 'frontend',
  'be': 'backend',
  'devops': 'development operations',
  'ci': 'continuous integration',
  'cd': 'continuous deployment',
  'pr': 'pull request',
  'mr': 'merge request',
  'env': 'environment',
  'config': 'configuration',
  'infra': 'infrastructure',
  'perf': 'performance',
  'prod': 'production',
  'dev': 'development',
  'qa': 'quality assurance',
};

function normalizeText(text) {
  if (!text) return '';
  let normalized = text.toLowerCase().trim();
  
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    normalized = normalized.replace(regex, full);
  }
  
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function fuzzySimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0;
  
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

function keywordOverlap(keywords1, keywords2) {
  if (!keywords1?.length || !keywords2?.length) return 0;
  
  const set1 = new Set(keywords1.map(k => normalizeText(k)));
  const set2 = new Set(keywords2.map(k => normalizeText(k)));
  
  let matches = 0;
  for (const k1 of set1) {
    for (const k2 of set2) {
      if (k1 === k2 || fuzzySimilarity(k1, k2) > 0.8) {
        matches++;
        break;
      }
    }
  }
  
  const unionSize = new Set([...set1, ...set2]).size;
  return matches / unionSize;
}

function extractKeywords(text) {
  if (!text) return [];
  
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
    'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and',
    'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at',
    'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
    'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
    'then', 'once', 'here', 'there', 'ok', 'okay', 'yes', 'no', 'حله', 'اوکی',
  ]);
  
  const words = normalizeText(text)
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
  
  const freq = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

// ============================================================================
// Database Queries
// ============================================================================

async function fetchMessageTopic(timestamp) {
  const result = await client.graphql
    .get()
    .withClassName('SlackMessage')
    .withFields(`topic { ... on Topic { name _additional { id } } }`)
    .withWhere({ path: ['timestamp'], operator: 'Equal', valueText: timestamp })
    .withLimit(1)
    .do();

  const found = result.data?.Get?.SlackMessage?.[0];
  return extractTopicInfo(found?.topic);
}

async function fetchMessageTopics(messages) {
  const topicsMap = {};
  
  await Promise.all(
    messages.map(async (msg) => {
      try {
        const topic = await fetchMessageTopic(msg.ts);
        if (topic) topicsMap[msg.ts] = topic;
      } catch {
        // Skip failed lookups silently
      }
    })
  );
  
  return topicsMap;
}

async function fetchThreadFromDB(threadTs) {
  const result = await client.graphql
    .get()
    .withClassName('SlackMessage')
    .withFields(MESSAGE_WITH_TOPIC_FIELDS)
    .withWhere({
      operator: 'Or',
      operands: [
        { path: ['timestamp'], operator: 'Equal', valueText: threadTs },
        { path: ['threadTs'], operator: 'Equal', valueText: threadTs },
      ],
    })
    .withLimit(20)
    .do();

  return result.data?.Get?.SlackMessage || [];
}

async function fetchAllTopics(limit = MAX_TOPICS_LIMIT) {
  const result = await client.graphql
    .get()
    .withClassName('Topic')
    .withFields(TOPIC_FIELDS)
    .withLimit(limit)
    .do();

  return result.data?.Get?.Topic || [];
}

async function getTopicById(topicId) {
  try {
    const result = await client.data
      .getterById()
      .withClassName('Topic')
      .withId(topicId)
      .do();
    
    if (!result || !result.properties) return null;
    
    return {
      id: result.id,
      name: result.properties.name,
      description: result.properties.description,
      keywords: result.properties.keywords || [],
      users: result.properties.users || [],
      sampleMessages: result.properties.sampleMessages || [],
      messageCount: result.properties.messageCount || 0,
    };
  } catch (error) {
    return null;
  }
}

// ============================================================================
// RRF (Reciprocal Rank Fusion) Search
// ============================================================================

/**
 * Perform hybrid search on topics with BM25 and Vector search
 */
async function hybridSearchTopics(query, limit = 10) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields(`
        name
        description
        keywords
        users
        sampleMessages
        messageCount
        _additional { id score }
      `)
      .withHybrid({
        query: query,
        alpha: 0.5, // Balance between BM25 and Vector
      })
      .withLimit(limit)
      .do();

    return (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      hybridRank: index + 1,
      hybridScore: topic._additional?.score || 0,
    }));
  } catch (error) {
    console.error('Hybrid search error:', error.message);
    return [];
  }
}

/**
 * Perform semantic (vector) search on topics
 */
async function semanticSearchTopics(query, limit = 10) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields(`
        name
        description
        keywords
        users
        sampleMessages
        messageCount
        _additional { id distance certainty }
      `)
      .withNearText({ concepts: [query] })
      .withLimit(limit)
      .do();

    return (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      vectorRank: index + 1,
      vectorScore: topic._additional?.certainty || (1 - (topic._additional?.distance || 1)),
    }));
  } catch (error) {
    console.error('Semantic search error:', error.message);
    return [];
  }
}

/**
 * Perform keyword (BM25) search on topics
 */
async function keywordSearchTopics(query, limit = 10) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields(`
        name
        description
        keywords
        users
        sampleMessages
        messageCount
        _additional { id score }
      `)
      .withBm25({
        query: query,
        properties: ['combinedSearchText'],  // Single field - contains name, description, keywords, samples
      })
      .withLimit(limit)
      .do();

    return (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      bm25Rank: index + 1,
      bm25Score: topic._additional?.score || 0,
    }));
  } catch (error) {
    console.error('Keyword search error:', error.message);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion (RRF) to merge multiple search results
 * RRF_score = Σ 1/(k + rank_i)
 */
function reciprocalRankFusion(searchResults, k = RRF_K) {
  const topicScores = new Map();
  const topicData = new Map();
  
  // Process each search result set
  for (const results of searchResults) {
    for (const topic of results) {
      const id = topic._additional?.id;
      if (!id) continue;
      
      // Calculate RRF contribution
      const rank = topic.hybridRank || topic.vectorRank || topic.bm25Rank || 999;
      const rrfScore = 1 / (k + rank);
      
      // Accumulate scores
      const currentScore = topicScores.get(id) || 0;
      topicScores.set(id, currentScore + rrfScore);
      
      // Store topic data (first occurrence wins)
      if (!topicData.has(id)) {
        topicData.set(id, {
          id,
          name: topic.name,
          description: topic.description,
          keywords: topic.keywords || [],
          users: topic.users || [],
          sampleMessages: topic.sampleMessages || [],
          messageCount: topic.messageCount || 0,
          ranks: {},
        });
      }
      
      // Track individual ranks for debugging
      const data = topicData.get(id);
      if (topic.hybridRank) data.ranks.hybrid = topic.hybridRank;
      if (topic.vectorRank) data.ranks.vector = topic.vectorRank;
      if (topic.bm25Rank) data.ranks.bm25 = topic.bm25Rank;
    }
  }
  
  // Sort by RRF score
  const sortedTopics = Array.from(topicScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, rrfScore]) => ({
      ...topicData.get(id),
      rrfScore,
    }));
  
  return sortedTopics;
}

/**
 * Calculate final confidence score using weighted factors
 */
function calculateConfidence(topic, query, messageKeywords) {
  const topicKeywords = topic.keywords || [];
  
  // Factor 1: RRF score (normalized to 0-1)
  const rrfNormalized = Math.min(topic.rrfScore * 20, 1); // Normalize assuming max ~0.05
  
  // Factor 2: Keyword overlap
  const kwOverlap = keywordOverlap(messageKeywords, topicKeywords);
  
  // Factor 3: Name similarity
  const nameSimilarity = fuzzySimilarity(query, topic.name);
  
  // Factor 4: Recency boost (more messages = more active)
  const recencyBoost = Math.min((topic.messageCount || 0) / 50, 1);
  
  // Weighted average
  const confidence = 
    (rrfNormalized * 0.4) +
    (kwOverlap * 0.3) +
    (nameSimilarity * 0.2) +
    (recencyBoost * 0.1);
  
  return {
    confidence,
    factors: {
      rrfScore: rrfNormalized,
      keywordOverlap: kwOverlap,
      nameSimilarity,
      recencyBoost,
    },
  };
}

// ============================================================================
// Current Message Context (set by categorizeMessage)
// ============================================================================

let currentMessage = null;
let currentChannelInfo = null;

// ============================================================================
// Tool Handlers for 3 Optimized Tools
// ============================================================================

const toolHandlers = {
  /**
   * TOOL 1: get_context
   * Returns ALL context in a single call
   */
  async get_context({ message_count = 5 }) {
    const channelId = currentChannelInfo?.id;
    const messageTs = currentMessage?.ts;
    const threadTs = currentMessage?.thread_ts;
    const isThreadReply = threadTs && threadTs !== messageTs;

    if (!channelId || !messageTs) {
      return { error: 'No channel or message context available.' };
    }

    // Parallel fetch all context
    const [recentMessages, threadMessages, channelContext] = await Promise.all([
      // Fetch recent channel messages
      fetchMessagesBefore(channelId, messageTs, Math.min(message_count, 10)),
      // Fetch thread if applicable
      isThreadReply ? fetchThreadMessages(channelId, threadTs) : Promise.resolve([]),
      // Get in-memory channel context
      Promise.resolve(conversationContext[channelId] || null),
    ]);

    // Enrich recent messages with their topics
    const topicsMap = await fetchMessageTopics(recentMessages);

    // Build current message info
    const currentMessageInfo = {
      text: currentMessage.text,
      user: currentMessage.user,
      user_name: currentMessage.user_name,
      is_thread_reply: isThreadReply,
      length: currentMessage.text.length,
      is_short: currentMessage.text.length < 15,
    };

    // Build thread parent info (if thread reply)
    let threadParent = null;
    if (isThreadReply && threadMessages.length > 0) {
      const parent = threadMessages.find(m => m.ts === threadTs) || threadMessages[0];
      
      // Check if parent has a topic assigned
      const parentTopic = await fetchMessageTopic(parent.ts);
      
      threadParent = {
        text: truncate(parent.text, 200),
        user: parent.user,
        user_name: parent.user_name,
        topic: parentTopic || null,
        thread_message_count: threadMessages.length,
      };
    }

    // Build recent messages with topics
    const enrichedRecentMessages = recentMessages.map((m) => ({
      text: truncate(m.text, 150),
      user: m.user,
      user_name: m.user_name,
      minutes_ago: getMinutesBetween(messageTs, m.ts),
      topic_id: topicsMap[m.ts]?.id || null,
      topic_name: topicsMap[m.ts]?.name || null,
    }));

    // Build channel info
    const channel = {
      name: currentChannelInfo.name,
      id: currentChannelInfo.id,
      current_topic: channelContext?.currentTopicId ? {
        id: channelContext.currentTopicId,
        name: channelContext.currentTopicName,
      } : null,
      last_activity_minutes_ago: enrichedRecentMessages.length > 0 
        ? enrichedRecentMessages[enrichedRecentMessages.length - 1].minutes_ago 
        : null,
    };

    return {
      current_message: currentMessageInfo,
      thread_parent: threadParent,
      recent_messages: enrichedRecentMessages,
      channel,
      // Provide recommendation based on context
      hint: isThreadReply && threadParent?.topic
        ? `Thread reply - use parent's topic: "${threadParent.topic.name}"`
        : currentMessageInfo.is_short && channel.current_topic
        ? `Short message - likely continues current topic: "${channel.current_topic.name}"`
        : 'Analyze message content to find or create appropriate topic',
    };
  },

  /**
   * TOOL 2: find_topics
   * Unified search with RRF fusion and confidence scores
   */
  async find_topics({ query, include_all = false }) {
    console.log('find_topics', query, include_all);
    const messageKeywords = extractKeywords(query);
    
    // Run parallel searches
    const [hybridResults, vectorResults, bm25Results, allTopics] = await Promise.all([
      hybridSearchTopics(query, 15),
      semanticSearchTopics(query, 15),
      keywordSearchTopics(query, 15),
      include_all ? fetchAllTopics() : Promise.resolve([]),
    ]);

    // Apply RRF fusion
    const fusedResults = reciprocalRankFusion([hybridResults, vectorResults, bm25Results]);

    // Calculate confidence scores for top results
    const scoredMatches = fusedResults.slice(0, 10).map(topic => {
      const { confidence, factors } = calculateConfidence(topic, query, messageKeywords);
      
      return {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        keywords: topic.keywords,
        confidence: parseFloat(confidence.toFixed(3)),
        match_reasons: buildMatchReasons(factors, topic, messageKeywords),
        message_count: topic.messageCount,
        sample_messages: (topic.sampleMessages || []).slice(0, 3),
      };
    });

    // Generate recommendation
    const recommendation = generateRecommendation(scoredMatches);

    const result = {
      matches: scoredMatches,
      recommendation,
      query_keywords: messageKeywords,
    };

    // Include all topics if requested
    if (include_all && allTopics.length > 0) {
      result.all_topics = allTopics.map(t => ({
        id: t._additional?.id,
        name: t.name,
        description: t.description,
        message_count: t.messageCount,
      }));
      result.total_topic_count = allTopics.length;
    }

    return result;
  },

  /**
   * TOOL 3: categorize
   * Final decision - assign or create
   */
  async categorize({ action, topic_id, topic_name, new_topic, reasoning }) {
    if (action === 'assign') {
      if (!topic_id) {
        return { error: 'topic_id is required when action is "assign"' };
      }
      return {
        action: 'assign',
        topic_id,
        topic_name: topic_name || 'Unknown',
        reasoning,
      };
    } else if (action === 'create') {
      if (!new_topic || !new_topic.name) {
        return { error: 'new_topic with name is required when action is "create"' };
      }
      return {
        action: 'create',
        name: new_topic.name,
        description: new_topic.description || `Messages about ${new_topic.name}`,
        keywords: new_topic.keywords || [],
        reasoning,
      };
    } else {
      return { error: `Invalid action: ${action}. Must be "assign" or "create"` };
    }
  },
};

/**
 * Build human-readable match reasons
 */
function buildMatchReasons(factors, topic, messageKeywords) {
  const reasons = [];
  
  if (factors.rrfScore > 0.5) reasons.push('semantic_match');
  if (factors.keywordOverlap > 0.3) {
    const overlapping = (topic.keywords || [])
      .filter(k => messageKeywords.some(mk => 
        normalizeText(k) === normalizeText(mk) || fuzzySimilarity(k, mk) > 0.8
      ));
    if (overlapping.length > 0) {
      reasons.push(`keyword_overlap:${overlapping.slice(0, 3).join(',')}`);
    }
  }
  if (factors.nameSimilarity > 0.4) reasons.push('name_similarity');
  if (factors.recencyBoost > 0.5) reasons.push('high_activity');
  
  return reasons.length > 0 ? reasons : ['partial_match'];
}

/**
 * Generate action recommendation based on matches
 */
function generateRecommendation(matches) {
  if (matches.length === 0) {
    return {
      action: 'create',
      confidence: 0,
      reason: 'No existing topics found - create a new specific topic',
    };
  }

  const bestMatch = matches[0];
  
  if (bestMatch.confidence >= 0.80) {
    return {
      action: 'assign',
      confidence: bestMatch.confidence,
      suggested_topic_id: bestMatch.id,
      suggested_topic_name: bestMatch.name,
      reason: `High confidence match with "${bestMatch.name}"`,
    };
  } else if (bestMatch.confidence >= 0.50) {
    return {
      action: 'review',
      confidence: bestMatch.confidence,
      suggested_topic_id: bestMatch.id,
      suggested_topic_name: bestMatch.name,
      reason: `Possible match with "${bestMatch.name}" - review context to decide`,
    };
  } else {
    return {
      action: 'create',
      confidence: bestMatch.confidence,
      reason: `Low confidence matches - consider creating a new specific topic`,
    };
  }
}

// ============================================================================
// Tool Executor
// ============================================================================

async function executeToolCall(toolName, args) {
  const handler = toolHandlers[toolName];
  
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return handler.call(toolHandlers, args);
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Create topic in database with improved embedding
 */
async function createTopicInDB(name, description, keywords, options = {}) {
  const { users = [], sampleMessages = [] } = options;
  
  // Build structured embedding text
  const combinedSearchText = buildTopicEmbeddingText({ 
    name, 
    description, 
    keywords, 
    users,
    sampleMessages,
  });
  
  const result = await client.data
    .creator()
    .withClassName('Topic')
    .withProperties({
      name,
      description,
      keywords,
      users: users || [],
      sampleMessages: sampleMessages || [],
      combinedSearchText,
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .do();
    
  return result.id;
}

/**
 * Store message and link to topic
 */
async function storeMessageWithTopic(message, channelInfo, topicId, topicName) {
  const userName = message.user_name || message.user_real_name || message.user;
  
  // Create message
  const msgResult = await client.data
    .creator()
    .withClassName('SlackMessage')
    .withProperties({
      text: message.text,
      user: message.user,
      userName: userName,
      timestamp: message.ts,
      channelId: channelInfo.id,
      channelName: channelInfo.name,
      threadTs: message.thread_ts || null,
      processedAt: new Date().toISOString(),
    })
    .do();

  // Link to topic
  await client.data
    .referenceCreator()
    .withClassName('SlackMessage')
    .withId(msgResult.id)
    .withReferenceProperty('topic')
    .withReference(
      client.data
        .referencePayloadBuilder()
        .withClassName('Topic')
        .withId(topicId)
        .payload()
    )
    .do();

  // Update topic with new message info
  const currentTopic = await client.data
    .getterById()
    .withClassName('Topic')
    .withId(topicId)
    .do();

  // Add user to topic's users list if not already present
  const existingUsers = currentTopic.properties.users || [];
  const updatedUsers = existingUsers.includes(userName) 
    ? existingUsers 
    : [...existingUsers, userName];
  
  // Add message to sample messages (keep last 10)
  const existingSamples = currentTopic.properties.sampleMessages || [];
  const updatedSamples = [...existingSamples, truncate(message.text, 100)].slice(-10);
  
  // Regenerate embedding text with updated data
  const updatedCombinedSearchText = buildTopicEmbeddingText({
    name: currentTopic.properties.name,
    description: currentTopic.properties.description,
    keywords: currentTopic.properties.keywords,
    users: updatedUsers,
    sampleMessages: updatedSamples,
  });

  await client.data
    .updater()
    .withClassName('Topic')
    .withId(topicId)
    .withProperties({
      name: currentTopic.properties.name,
      description: currentTopic.properties.description,
      keywords: currentTopic.properties.keywords,
      createdAt: currentTopic.properties.createdAt,
      users: updatedUsers,
      sampleMessages: updatedSamples,
      combinedSearchText: updatedCombinedSearchText,
      messageCount: (currentTopic.properties.messageCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    })
    .do();

  // Update conversation context
  const channelId = channelInfo.id;
  if (!conversationContext[channelId]) {
    conversationContext[channelId] = {
      recentMessages: [],
      currentTopicId: null,
      currentTopicName: null,
    };
  }

  conversationContext[channelId].recentMessages.push({
    text: message.text,
    user: message.user,
    timestamp: message.ts,
    topicId,
    topicName,
  });

  if (conversationContext[channelId].recentMessages.length > 20) {
    conversationContext[channelId].recentMessages.shift();
  }

  conversationContext[channelId].currentTopicId = topicId;
  conversationContext[channelId].currentTopicName = topicName;

  return msgResult.id;
}

// ============================================================================
// Logging Helpers
// ============================================================================

/**
 * Log tool results in a readable format
 */
function logToolResult(toolName, result) {
  switch (toolName) {
    case 'get_context':
      // Show what context was found
      if (result.thread_parent) {
        console.log(`         🧵 Thread parent: "${truncate(result.thread_parent.text, 50)}"`);
        if (result.thread_parent.topic) {
          console.log(`            └─ Topic: ${result.thread_parent.topic.name}`);
        }
      }
      if (result.recent_messages?.length > 0) {
        console.log(`         📨 Recent messages (${result.recent_messages.length}):`);
        result.recent_messages.slice(0, 3).forEach((m, i) => {
          const topicInfo = m.topic_name ? ` → [${m.topic_name}]` : '';
          console.log(`            ${i + 1}. "${truncate(m.text, 40)}"${topicInfo}`);
        });
      } else {
        console.log(`         📨 No recent messages found`);
      }
      if (result.channel?.current_topic) {
        console.log(`         📺 Channel topic: ${result.channel.current_topic.name}`);
      }
      if (result.hint) {
        console.log(`         💡 ${result.hint}`);
      }
      break;

    case 'find_topics':
      // Show search results
      if (result.matches?.length > 0) {
        console.log(`         🔍 Found ${result.matches.length} matching topics:`);
        result.matches.slice(0, 3).forEach((m, i) => {
          const conf = (m.confidence * 100).toFixed(0);
          const reasons = m.match_reasons?.slice(0, 2).join(', ') || '';
          console.log(`            ${i + 1}. ${m.name} (${conf}%) ${reasons ? `[${reasons}]` : ''}`);
        });
      } else {
        console.log(`         🔍 No matching topics found`);
      }
      if (result.recommendation) {
        const conf = (result.recommendation.confidence * 100).toFixed(0);
        console.log(`         📊 Recommendation: ${result.recommendation.action.toUpperCase()} (${conf}%)`);
        if (result.recommendation.reason) {
          console.log(`            └─ ${result.recommendation.reason}`);
        }
      }
      break;

    default:
      // Generic fallback for other tools
      if (result.error) {
        console.log(`         ❌ Error: ${result.error}`);
      }
  }
}

// ============================================================================
// Main Categorization Function
// ============================================================================

async function categorizeMessage(message, channelInfo, options = {}) {
  const { verbose = true, maxIterations = 5 } = options;
  const startTime = Date.now();

  if (!message.text || message.text.trim().length === 0) {
    if (verbose) console.log('  ⏭️  Skipping empty message');
    return null;
  }

  // Set current context for tool calls
  currentMessage = message;
  currentChannelInfo = channelInfo;

  const isShortMessage = message.text.length < 15;
  const isThreadReply = message.thread_ts && message.thread_ts !== message.ts;

  if (verbose) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🤖 SMART CATEGORIZER (Optimized 3-Tool Architecture)`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   📝 Text: "${message.text.substring(0, 80)}${message.text.length > 80 ? '...' : ''}"`);
    console.log(`   📏 Length: ${message.text.length} chars (${isShortMessage ? 'SHORT' : 'SUBSTANTIVE'})`);
    console.log(`   👤 User: ${message.user}`);
    console.log(`   📺 Channel: ${channelInfo.name}`);
    console.log(`   🧵 Thread Reply: ${isThreadReply ? 'YES' : 'NO'}`);
    console.log(`${'─'.repeat(70)}`);
  }
  
  const userMessage = `## NEW MESSAGE TO CATEGORIZE

**Message:** "${message.text}"
**Length:** ${message.text.length} characters
**User:** ${message.user}
**Channel:** ${channelInfo.name}
**Thread Reply:** ${isThreadReply ? 'YES' : 'NO'}
**Message Type:** ${isShortMessage ? 'SHORT (likely confirmation/reaction)' : 'SUBSTANTIVE'}

Follow the workflow:
1. Call get_context first
2. Call find_topics with relevant query
3. Call categorize to make final decision`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  let decision = null;
  let iterations = 0;

  while (!decision && iterations < maxIterations) {
    iterations++;

    if (verbose) {
      console.log(`\n   📍 Iteration ${iterations}/${maxIterations}`);
    }

    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 800,
      });

      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      if (verbose && assistantMessage.content) {
        console.log(`      💭 ${assistantMessage.content.substring(0, 100)}...`);
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments || '{}');

          if (verbose) {
            console.log(`      🔧 ${toolName}${args.query ? `: "${args.query.substring(0, 50)}..."` : ''}`);
          }

          const result = await executeToolCall(toolName, args);

          if (result.action === 'assign' || result.action === 'create') {
            decision = result;
            if (verbose) {
              console.log(`      ✅ Decision: ${result.action === 'assign' ? 'ASSIGN' : 'CREATE'} → ${result.action === 'assign' ? result.topic_name : result.name}`);
            }
          } else {
            // Log useful details from each tool
            if (verbose) {
              logToolResult(toolName, result);
            }
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result, null, 2),
            });
          }
        }
      } else if (response.choices[0].finish_reason === 'stop' && !decision) {
        messages.push({
          role: 'user',
          content: 'You must make a final decision. Call the categorize tool now with action="assign" or action="create".',
        });
      }
    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
      if (iterations >= maxIterations) throw error;
    }
  }

  // Fallback if no decision made
  if (!decision) {
    if (verbose) console.log(`   ⚠️  Fallback mode activated`);
    
    const channelContext = conversationContext[channelInfo.id];
    
    if (message.text.length < 15 && channelContext?.currentTopicId) {
      decision = {
        action: 'assign',
        topic_id: channelContext.currentTopicId,
        topic_name: channelContext.currentTopicName,
        reasoning: 'Fallback: Short message assigned to recent topic',
      };
    } else {
      decision = {
        action: 'create',
        name: 'General Discussion',
        description: 'General messages and conversations',
        keywords: ['general', 'chat', 'discussion'],
        reasoning: 'Fallback: Could not determine specific topic',
      };
    }
  }

  // Execute decision
  let topicId, topicName;

  if (decision.action === 'assign') {
    topicId = decision.topic_id;
    topicName = decision.topic_name;
  } else {
    const userName = message.user_name || message.user_real_name || message.user;
    topicId = await createTopicInDB(decision.name, decision.description, decision.keywords, {
      users: userName ? [userName] : [],
      sampleMessages: [truncate(message.text, 100)],
    });
    topicName = decision.name;
    if (verbose) console.log(`      🆕 Created topic: ${topicId}`);
  }

  const messageId = await storeMessageWithTopic(message, channelInfo, topicId, topicName);

  const totalTime = Date.now() - startTime;
  if (verbose) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`   ✨ COMPLETE: ${topicName}`);
    console.log(`   📊 ${iterations} iterations | ${totalTime}ms | ${decision.action.toUpperCase()}`);
    console.log(`   💬 ${decision.reasoning}`);
    console.log(`${'═'.repeat(70)}\n`);
  }

  return {
    messageId,
    topicId,
    topicName,
    decision: decision.action,
    reasoning: decision.reasoning,
    processingTime: totalTime,
    iterations,
  };
}

// ============================================================================
// Exports
// ============================================================================

async function getAllTopics() {
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields('name description keywords users sampleMessages combinedSearchText messageCount createdAt updatedAt _additional { id }')
      .withLimit(100)
      .do();
    return result.data.Get.Topic || [];
  } catch (error) {
    console.error('Error getting topics:', error);
    return [];
  }
}

function resetContext() {
  Object.keys(conversationContext).forEach(key => delete conversationContext[key]);
}

// Alias for backwards compatibility
const categorizeMessageSmart = categorizeMessage;

export { 
  categorizeMessage, 
  categorizeMessageSmart,
  getAllTopics, 
  resetContext,
  createTopicInDB,
  buildTopicEmbeddingText,
};
