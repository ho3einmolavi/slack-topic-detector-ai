import { client } from './weaviate-setup.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import {
  hybridSearchMessages,
  semanticSearchMessages,
  keywordSearchMessages,
  getMessagesByTopic,
} from './search-tools.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-4o';

// Slack API configuration
const SLACK_API_KEY = process.env.SLACK_API_KEY;
const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Make a call to Slack API
 */
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

/**
 * Fetch messages from Slack channel history before a specific timestamp
 */
async function fetchMessagesBefore(channelId, beforeTs, count = 5) {
  try {
    const response = await slackApiCall('conversations.history', {
      channel: channelId,
      latest: beforeTs,  // Get messages before this timestamp
      limit: count,
      inclusive: false,  // Don't include the message at 'latest'
    });
    
    // Messages come newest first, reverse to get chronological order
    return response.messages.reverse();
  } catch (error) {
    console.error(`Error fetching Slack messages: ${error.message}`);
    return [];
  }
}

/**
 * Fetch all messages in a thread (including the parent message)
 */
async function fetchThreadMessages(channelId, threadTs) {
  try {
    const response = await slackApiCall('conversations.replies', {
      channel: channelId,
      ts: threadTs,
      limit: 100,  // Get up to 100 messages in the thread
    });
    
    // Returns messages in chronological order (parent first, then replies)
    return response.messages || [];
  } catch (error) {
    console.error(`Error fetching thread messages: ${error.message}`);
    return [];
  }
}

/**
 * In-memory conversation context tracker
 * Tracks recent messages per channel for context
 */
const conversationContext = {
  // channelId -> { recentMessages: [], currentTopicId: string, currentTopicName: string }
};

/**
 * Tool definitions for the smart categorizer agent
 */
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_conversation_context',
      description: 'Fetch the N most recent messages from Slack API that came BEFORE the current message. Use this to understand what the conversation is about and whether this message is a reply/confirmation to a previous message.',
      parameters: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'How many recent messages to retrieve (default 5)',
            default: 5,
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_thread_parent',
      description: 'If this message is a thread reply, get the parent message and other replies in the thread. This helps understand the context of a reply.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_channel_topic',
      description: 'Get the topic that was assigned to the most recent message in this channel. Useful to see if the current message continues the same conversation.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_existing_topics',
      description: 'Search for existing topics that might match this message content. Returns topics with their descriptions and message counts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query based on message content or subject',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 5)',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_all_topics',
      description: 'Get a list of ALL existing topics. Use this to see what topics already exist before creating a new one.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hybrid_search',
      description: 'Search ALL stored messages using hybrid search (keyword + semantic). Find similar messages to understand how they were categorized.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 10)',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Search messages by meaning/concept. Find messages with similar meaning even if they use different words.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Describe the concept you are looking for',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 10)',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'keyword_search',
      description: 'Search messages by exact keywords (BM25). Best for specific terms, names, or technical words.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords to search for',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 10)',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_topic_messages',
      description: 'Get sample messages from a specific topic to understand what kind of messages belong there.',
      parameters: {
        type: 'object',
        properties: {
          topic_id: {
            type: 'string',
            description: 'Topic UUID',
          },
          limit: {
            type: 'number',
            description: 'Max messages to retrieve (default 5)',
            default: 5,
          },
        },
        required: ['topic_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_to_topic',
      description: 'FINAL DECISION: Assign this message to an existing topic. Use this when you have determined which topic the message belongs to.',
      parameters: {
        type: 'object',
        properties: {
          topic_id: {
            type: 'string',
            description: 'The UUID of the topic to assign to',
          },
          topic_name: {
            type: 'string',
            description: 'The name of the topic (for logging)',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this topic was chosen',
          },
        },
        required: ['topic_id', 'topic_name', 'reasoning'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_new_topic',
      description: 'FINAL DECISION: Create a new topic for this message. ONLY use this when no existing topic fits AND this message starts a new subject/conversation. IMPORTANT: Always call validate_new_topic first to check for duplicates!',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Short topic name (2-5 words)',
          },
          description: {
            type: 'string',
            description: 'One sentence describing what this topic covers',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '3-5 relevant keywords',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why a new topic is needed',
          },
        },
        required: ['name', 'description', 'keywords', 'reasoning'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_best_topic_match',
      description: 'RECOMMENDED: Find the best matching topic using advanced multi-strategy matching (semantic similarity + fuzzy name matching + keyword overlap). Returns confidence scores and recommendations. Use this BEFORE deciding to create a new topic.',
      parameters: {
        type: 'object',
        properties: {
          message_text: {
            type: 'string',
            description: 'The message text to find a matching topic for (defaults to current message if not provided)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_new_topic',
      description: 'REQUIRED before creating a new topic: Check if the proposed topic name/description would be a duplicate of existing topics. Detects similar names like "DB Performance" vs "Database Performance", abbreviation matches, and keyword overlaps.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Proposed topic name',
          },
          description: {
            type: 'string',
            description: 'Proposed topic description',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Proposed keywords for the topic',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_topic_specificity',
      description: `Check if an existing topic is specific enough or if it's actually a broad category. 
                    Use this before assigning to a topic that seems generic.
                    Returns whether the topic is specific (good) or categorical (too broad).`,
      parameters: {
        type: 'object',
        properties: {
          topic_id: {
            type: 'string',
            description: 'Topic UUID to evaluate',
          },
          proposed_message: {
            type: 'string',
            description: 'The message you want to assign to this topic',
          },
        },
        required: ['topic_id', 'proposed_message'],
      },
    },
  },
];


const SYSTEM_PROMPT = `You are an expert at understanding workplace conversations and organizing them into specific, actionable topics.

# CRITICAL: WHAT IS A TOPIC?

A topic is NOT a category or tag. A topic is a **specific discussion, issue, or thread of work**.

## ❌ BAD TOPICS (Too Broad)
These are categories, not topics:
- "API Integration and Database Issues" ← This is a folder, not a topic
- "Backend Development" ← Too vague
- "Bug Fixes" ← Could contain 100 unrelated bugs
- "Team Discussions" ← Meaningless

## ✅ GOOD TOPICS (Specific)
These are actual topics:
- "Integration API returning empty - Dec 9 bug"
- "Slack OAuth refactor to remove Composio"
- "Staging environment outage Dec 9"
- "Gmail processor stops on 404 error"
- "Local dev OAuth redirect_uri mismatch"
- "Claude API usage cost investigation"
- "Redis GUI access setup"

## The Test: Is This a Topic or a Category?

Ask yourself:
1. **Could this contain multiple unrelated issues?** → It's a category, not a topic
2. **Would someone create a Jira ticket for this exact thing?** → Good topic
3. **Is this something that can be "resolved" or "completed"?** → Good topic
4. **Would two messages about this naturally be part of the same conversation?** → Good topic

---

# TOPIC GRANULARITY RULES

## Rule 1: One Issue = One Topic

If message A is about "API returning empty" and message B is about "OAuth redirect error", these are TWO different topics, even if both involve APIs.

## Rule 2: Topics Should Be Resolvable

A good topic is something that:
- Has a beginning (when it was raised)
- Has an end (when it's resolved or concluded)
- Can be summarized as a specific thing

## Rule 3: Time-Bound When Appropriate

If an issue recurs, it might be a new topic:
- "Staging outage - Dec 5" vs "Staging outage - Dec 9" could be separate
- Unless they're clearly the same ongoing issue

## Rule 4: Conversations Are Topics

A back-and-forth discussion about ONE thing is ONE topic:
\`\`\`
Ali: "The integration API is returning empty"
Sara: "Is the database populated?"
Ali: "Let me check"
Ali: "Database is fine, must be elsewhere"
Sara: "Check the OAuth config"
\`\`\`
→ All of this is ONE topic: "Integration API returning empty"

But if Sara then says:
\`\`\`
Sara: "By the way, staging is down"
\`\`\`
→ This starts a NEW topic: "Staging environment down"

---

# EXAMPLES OF CORRECT TOPIC ASSIGNMENT

## Example 1: Specific Bug
**Message:** "The /api/v1/integration endpoint returns empty"
**Wrong:** Assign to "API Integration and Database Issues"
**Right:** Create "Integration API returning empty response"

## Example 2: Specific Investigation  
**Message:** "Claude API usage doesn't match our request volume"
**Wrong:** Assign to "API Issues"
**Right:** Create "Claude API usage/billing discrepancy"

## Example 3: Specific Question
**Message:** "How do I connect to staging Redis with a GUI?"
**Wrong:** Assign to "Infrastructure Questions"
**Right:** Create "Redis GUI access for staging" OR find existing topic if someone asked this before

## Example 4: Specific Outage
**Message:** "stage is down"
**Wrong:** Assign to "Infrastructure Issues"
**Right:** Create "Staging environment outage [date]" OR find existing active outage topic

## Example 5: Specific Feature Work
**Message:** "Slack OAuth refactor is complete - here's the summary..."
**Wrong:** Assign to "Slack Integration Development"
**Right:** Create "Slack OAuth refactor - Composio removal" OR find existing topic for this work

---

# WHEN TO USE AN EXISTING TOPIC

Use an existing topic when:
1. **Same specific issue:** Message is clearly about the same bug/task/discussion
2. **Direct continuation:** This message directly responds to or continues that topic
3. **Same scope:** The existing topic is specific enough that this message belongs

Do NOT use an existing topic when:
1. **Same category, different issue:** Both are "API bugs" but they're different bugs
2. **Topic is too broad:** The existing topic is a category, not a specific issue
3. **Different scope:** Message is about a new aspect that deserves its own topic

---

# WHEN TO CREATE A NEW TOPIC

Create a new topic when:
1. **New issue:** This is a distinct bug/task/question not covered by existing topics
2. **New discussion:** This starts a new thread of conversation
3. **Specificity needed:** Existing topics are too broad to accurately represent this

When creating, be specific:
- Include the actual problem/task in the name
- Make it clear what this topic is about
- Someone reading just the topic name should understand the issue

---

# REASONING PROCESS FOR SPECIFICITY

For each message, ask:

1. **What is the specific thing being discussed?**
   - Not "API stuff" but "integration endpoint returning empty"
   - Not "deployment" but "staging environment outage"

2. **Is there an existing topic for this EXACT issue?**
   - Not "a related topic" — the EXACT issue
   - If existing topic is too broad, this needs a new specific topic

3. **Would combining this with other messages make sense?**
   - "ok, let me check" following a bug report → same topic
   - "by the way, different thing is broken" → new topic

4. **What would I name a Jira ticket for this?**
   - Use that as your topic name
   - If you'd create separate tickets, they're separate topics

---

# TOPIC NAMING CONVENTION

Format: **[Specific issue/task] - [Context if needed]**

Good names:
- "Integration API empty response bug"
- "Slack OAuth refactor - remove Composio dependency"
- "Gmail processor 404 error handling"
- "Local OAuth redirect_uri configuration"
- "Claude API usage tracking discrepancy"
- "Staging Redis GUI access"

Bad names:
- "API Issues" ← too broad
- "Bug" ← meaningless
- "Slack stuff" ← vague
- "Questions" ← category not topic

---

Remember: You're organizing a workspace, not filing into folders. Each topic should represent ONE specific thing that the team is discussing, investigating, or working on. When in doubt, be MORE specific rather than less.`;
/**
 * Current message being processed (set by categorizeMessage)
 */
let currentMessage = null;
let currentChannelInfo = null;

/**
 * Tool implementations
 */
// ============================================================================
// Constants
// ============================================================================

const CONVERSATION_TIMEOUT_MINUTES = 10;
const TEXT_PREVIEW_LENGTH = 150;
const MAX_TOPICS_LIMIT = 50;

const TOPIC_FIELDS = `
  name
  description
  keywords
  users
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
// Helper Functions
// ============================================================================

/**
 * Calculate minutes between two Slack timestamps
 */
const getMinutesBetween = (ts1, ts2) => 
  Math.round((parseFloat(ts1) - parseFloat(ts2)) / 60);

/**
 * Truncate text with ellipsis
 */
const truncate = (text, maxLength = TEXT_PREVIEW_LENGTH) => {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
};

/**
 * Extract topic info from a Weaviate topic object
 */
const extractTopicInfo = (topic) => {
  if (!topic?.[0]) return null;
  return {
    id: topic[0]._additional?.id,
    name: topic[0].name,
  };
};

/**
 * Map raw Weaviate topic to clean topic object
 */
const mapTopic = (t, includeKeywords = false) => ({
  id: t._additional.id,
  name: t.name,
  description: t.description,
  messageCount: t.messageCount,
  ...(includeKeywords && { keywords: t.keywords }),
});

/**
 * Generate context hint based on time gap
 */
const generateContextHint = (minutesSinceLast, topicName) => {
  if (minutesSinceLast < 5) {
    const topicPart = topicName ? ` about "${topicName}"` : '';
    return `Last message was ${minutesSinceLast} min ago${topicPart}. If current message is a short response, it likely belongs to the same topic.`;
  }
  if (minutesSinceLast < 30) {
    return `Last message was ${minutesSinceLast} min ago. Check if current message continues that subject or starts a new one.`;
  }
  return `Last message was ${minutesSinceLast} min ago. This might be a new conversation - analyze the content carefully.`;
};

// ============================================================================
// Topic Matching Functions
// ============================================================================

/**
 * Common abbreviations and their expansions for fuzzy matching
 */
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
  'msg': 'message',
  'msgs': 'messages',
};

/**
 * Normalize text for comparison (lowercase, expand abbreviations, remove special chars)
 */
function normalizeText(text) {
  if (!text) return '';
  let normalized = text.toLowerCase().trim();
  
  // Expand abbreviations
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    normalized = normalized.replace(regex, full);
  }
  
  // Remove special characters but keep spaces
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Calculate Levenshtein distance between two strings
 */
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

/**
 * Calculate fuzzy similarity between two strings (0-1)
 */
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

/**
 * Calculate keyword overlap score between two keyword arrays
 */
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

/**
 * Extract keywords from text
 */
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
    'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  ]);
  
  const words = normalizeText(text)
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
  
  // Count frequency and return top words
  const freq = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Generate combined search text for topic embedding
 * Includes name, description, keywords, and users for better semantic matching
 */
function getTopicEmbeddingText({ name, description, keywords, users }) {
  const parts = [name];
  if (description) parts.push(description);
  if (keywords?.length) parts.push(`Keywords: ${keywords.join(', ')}`);
  if (users?.length) parts.push(`Users: ${users.join(', ')}`);
  return parts.join(' | ');
}

/**
 * Analyze if a new topic should be created or use existing
 */
async function analyzeTopicCreation(proposedTopic, existingTopics, options = {}) {
  const {
    fuzzyThreshold = 0.6,
    keywordThreshold = 0.4,
  } = options;

  const suggestions = [];
  const proposedNormalized = normalizeText(proposedTopic.name);
  const proposedKeywords = proposedTopic.keywords || extractKeywords(proposedTopic.description || proposedTopic.name);

  for (const existing of existingTopics) {
    const existingId = existing._additional?.id || existing.id;
    const existingName = existing.name;
    const existingDescription = existing.description || '';
    const existingKeywords = existing.keywords || [];

    // Calculate fuzzy name similarity
    const nameSimilarity = fuzzySimilarity(proposedTopic.name, existingName);
    
    // Calculate description similarity
    const descSimilarity = proposedTopic.description 
      ? fuzzySimilarity(proposedTopic.description, existingDescription)
      : 0;
    
    // Calculate keyword overlap
    const kwOverlap = keywordOverlap(proposedKeywords, existingKeywords);
    
    // Combined score (weighted)
    const combinedScore = (nameSimilarity * 0.5) + (descSimilarity * 0.2) + (kwOverlap * 0.3);
    
    const matchTypes = [];
    if (nameSimilarity >= fuzzyThreshold) matchTypes.push('name');
    if (descSimilarity >= fuzzyThreshold) matchTypes.push('description');
    if (kwOverlap >= keywordThreshold) matchTypes.push('keywords');

    if (matchTypes.length > 0 || combinedScore >= 0.5) {
      suggestions.push({
        topic: {
          id: existingId,
          name: existingName,
          description: existingDescription,
          keywords: existingKeywords,
        },
        combinedScore,
        scores: {
          name: nameSimilarity,
          description: descSimilarity,
          keywords: kwOverlap,
        },
        matchTypes,
        recommendation: combinedScore >= 0.7 ? 'use_existing' : 'consider_merge',
      });
    }
  }

  // Sort by combined score
  suggestions.sort((a, b) => b.combinedScore - a.combinedScore);

  const shouldCreate = suggestions.length === 0 || suggestions[0].combinedScore < 0.5;
  
  return {
    shouldCreate,
    confidence: shouldCreate ? 0.8 : 1 - suggestions[0].combinedScore,
    suggestions,
    reasoning: shouldCreate
      ? 'No similar topics found - safe to create new topic'
      : `Found similar topic "${suggestions[0].topic.name}" (${(suggestions[0].combinedScore * 100).toFixed(0)}% match)`,
  };
}

/**
 * Validate if a new topic would be a duplicate
 */
async function validateNewTopic(proposedTopic, options = {}) {
  // Fetch all existing topics
  const existingTopics = await fetchAllTopics();
  
  if (existingTopics.length === 0) {
    return {
      shouldCreate: true,
      confidence: 1.0,
      suggestions: [],
      reasoning: 'No existing topics - this will be the first one',
    };
  }

  return analyzeTopicCreation(proposedTopic, existingTopics, options);
}

// ============================================================================
// Database Queries
// ============================================================================

/**
 * Fetch topic info for a message by timestamp
 */
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

/**
 * Fetch topics for multiple messages (batch lookup)
 */
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

/**
 * Fetch thread messages from database
 */
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

/**
 * Search topics using hybrid search
 */
async function searchTopics(query, limit = 5) {
  const result = await client.graphql
    .get()
    .withClassName('Topic')
    .withFields(TOPIC_FIELDS)
    .withHybrid({ query, alpha: 0.5 })
    .withLimit(limit)
    .do();

  return result.data?.Get?.Topic || [];
}

/**
 * Fetch all topics
 */
async function fetchAllTopics(limit = MAX_TOPICS_LIMIT) {
  const result = await client.graphql
    .get()
    .withClassName('Topic')
    .withFields(TOPIC_FIELDS)
    .withLimit(limit)
    .do();

  return result.data?.Get?.Topic || [];
}

/**
 * Fetch a single topic by ID
 */
async function getTopicById(topicId) {
  try {
    const result = await client.data
      .getterById()
      .withClassName('Topic')
      .withId(topicId)
      .do();
    
    if (!result || !result.properties) {
      return null;
    }
    
    return {
      id: result.id,
      name: result.properties.name,
      description: result.properties.description,
      keywords: result.properties.keywords || [],
      users: result.properties.users || [],
      messageCount: result.properties.messageCount || 0,
    };
  } catch (error) {
    return null;
  }
}

// ============================================================================
// Tool Handlers
// ============================================================================

const toolHandlers = {
  /**
   * Get N messages before current message from Slack API
   */
  async get_conversation_context({ count = 5 }) {
    const channelId = currentChannelInfo?.id;
    const messageTs = currentMessage?.ts;
    const threadTs = currentMessage?.thread_ts;

    if (!channelId || !messageTs) {
      return { messages: [], note: 'No channel or message context available.' };
    }

    // Check if this is a thread reply
    const isThreadReply = threadTs && threadTs !== messageTs;

    if (isThreadReply) {
      // Fetch all messages in the thread (including parent)
      const threadMessages = await fetchThreadMessages(channelId, threadTs);
      
      if (threadMessages.length === 0) {
        return { messages: [], note: 'Could not fetch thread messages.', isThread: true };
      }

      // Filter out the current message and map the results
      const contextMessages = threadMessages
        .filter(m => m.ts !== messageTs)  // Exclude current message
        .map((m) => ({
          text: m.text,
          user: m.user,
          user_name: m.user_name,
          minutesAgo: getMinutesBetween(messageTs, m.ts),
          isParent: m.ts === threadTs,
        }));

      return {
        isThread: true,
        threadTs: threadTs,
        totalThreadMessages: threadMessages.length,
        parentMessage: threadMessages[0] ? {
          text: truncate(threadMessages[0].text, 200),
          user: threadMessages[0].user,
          user_name: threadMessages[0].user_name,
        } : null,
        messages: contextMessages,
        note: `This is a thread reply. Showing ${contextMessages.length} previous messages in this thread.`,
      };
    }

    // Not a thread - fetch previous channel messages
    const messages = await fetchMessagesBefore(channelId, messageTs, count);
    
    if (messages.length === 0) {
      return { messages: [], note: 'No previous messages found.', isThread: false };
    }

    return {
      isThread: false,
      messages: messages.map((m) => ({
        text: m.text,
        user: m.user,
        user_name: m.user_name,
        minutesAgo: getMinutesBetween(messageTs, m.ts),
      })),
    };
  },

  /**
   * Get thread parent info
   */
  async get_thread_parent() {
    const threadTs = currentMessage?.thread_ts;
    const isThreadReply = threadTs && threadTs !== currentMessage?.ts;

    if (!isThreadReply) {
      return { isThreadReply: false, message: 'This is not a thread reply.' };
    }

    try {
      const messages = await fetchThreadFromDB(threadTs);

      if (messages.length === 0) {
        return this._getThreadParentFromMemory(threadTs);
      }

      const parent = messages.find((m) => m.timestamp === threadTs) || messages[0];
      const topic = extractTopicInfo(parent.topic);

      return {
        isThreadReply: true,
        parentFound: true,
        parentTopicId: topic?.id,
        parentTopicName: topic?.name,
        parentText: truncate(parent.text, 200),
        threadMessageCount: messages.length,
        recommendation: topic
          ? `This is a thread reply. Use the same topic as parent: "${topic.name}"`
          : 'Thread parent found but no topic assigned yet.',
      };
    } catch (error) {
      return { isThreadReply: true, parentFound: false, error: error.message };
    }
  },

  /**
   * Fallback: get thread parent from in-memory context
   */
  _getThreadParentFromMemory(threadTs) {
    const channelContext = conversationContext[currentChannelInfo?.id];
    const parentInMemory = channelContext?.recentMessages?.find(
      (m) => m.timestamp === threadTs
    );

    if (!parentInMemory) {
      return { isThreadReply: true, parentFound: false, message: 'Thread parent not found yet.' };
    }

    return {
      isThreadReply: true,
      parentFound: true,
      parentTopicId: parentInMemory.topicId,
      parentTopicName: parentInMemory.topicName,
      parentText: parentInMemory.text,
      recommendation: `This is a reply to: "${truncate(parentInMemory.text, 100)}". Use topic: "${parentInMemory.topicName}".`,
    };
  },

  /**
   * Get current channel's active topic
   */
  async get_current_channel_topic() {
    const context = conversationContext[currentChannelInfo?.id];

    if (!context?.currentTopicId) {
      return { hasTopic: false, message: 'No topic set for current channel conversation yet.' };
    }

    const timeSinceLast = this._getTimeSinceLastMessage(context);

    return {
      hasTopic: true,
      topicId: context.currentTopicId,
      topicName: context.currentTopicName,
      timeSinceLastMessage: timeSinceLast,
      recommendation: `Current conversation topic is "${context.currentTopicName}". Use same topic if this continues it.`,
    };
  },

  /**
   * Helper: calculate time since last message in context
   */
  _getTimeSinceLastMessage(context) {
    if (!context.recentMessages?.length || !currentMessage) return 'unknown';
    
    const lastMsg = context.recentMessages[context.recentMessages.length - 1];
    const minutes = getMinutesBetween(currentMessage.ts, lastMsg.timestamp);
    return `${minutes} minutes`;
  },

  /**
   * Search for existing topics
   */
  async search_existing_topics({ query, limit = 5 }) {
    try {
      const topics = await searchTopics(query, limit);

      if (topics.length === 0) {
        return { found: false, message: 'No matching topics found.' };
      }

      return {
        found: true,
        topics: topics.map((t) => mapTopic(t, true)),
      };
    } catch (error) {
      return { found: false, error: error.message };
    }
  },

  /**
   * Get all existing topics
   */
  async get_all_topics() {
    try {
      const topics = await fetchAllTopics();

      if (topics.length === 0) {
        return { count: 0, message: 'No topics exist yet. You may need to create the first one.' };
      }

      return {
        count: topics.length,
        topics: topics.map((t) => mapTopic(t)),
      };
    } catch (error) {
      return { count: 0, error: error.message };
    }
  },

  /**
   * Hybrid search (keyword + semantic)
   */
  async hybrid_search({ query, limit = 10 }) {
    const results = await hybridSearchMessages(query, 0.5, limit);
    return {
      count: results.length,
      messages: results.map((m) => ({
        text: truncate(m.text, 200),
        user: m.user,
        topic: m.topic?.[0]?.name || null,
        score: m.relevanceScore,
      })),
    };
  },

  /**
   * Semantic search (by meaning)
   */
  async semantic_search({ query, limit = 10 }) {
    const results = await semanticSearchMessages(query, limit);
    return {
      count: results.length,
      messages: results.map((m) => ({
        text: truncate(m.text, 200),
        user: m.user,
        topic: m.topic?.[0]?.name || null,
        similarity: m.similarity,
      })),
    };
  },

  /**
   * Keyword search (exact match)
   */
  async keyword_search({ query, limit = 10 }) {
    const results = await keywordSearchMessages(query, limit);
    return {
      count: results.length,
      messages: results.map((m) => ({
        text: truncate(m.text, 200),
        user: m.user,
        topic: m.topic?.[0]?.name || null,
        score: m.bm25Score,
      })),
    };
  },

  /**
   * Get messages from a specific topic
   */
  async get_topic_messages({ topic_id, limit = 5 }) {
    const results = await getMessagesByTopic(topic_id, limit);
    return {
      count: results.length,
      messages: results.map((m) => ({
        text: truncate(m.text, 200),
        user: m.user,
      })),
    };
  },

  /**
   * Assign message to existing topic
   */
  async assign_to_topic(args) {
    return { action: 'assign', ...args };
  },

  /**
   * Create a new topic
   */
  async create_new_topic(args) {
    return { action: 'create', ...args };
  },

  /**
   * Validate a proposed new topic for duplicates
   */
  async validate_new_topic({ name, description = '', keywords = [] }) {
    if (!name) {
      return { error: 'Topic name is required' };
    }

    try {
      const result = await validateNewTopic(
        { name, description, keywords },
        { semanticThreshold: 0.6, fuzzyThreshold: 0.5, keywordThreshold: 0.3 }
      );

      if (result.shouldCreate) {
        return {
          canCreate: true,
          confidence: result.confidence,
          reasoning: result.reasoning,
          message: 'OK to create this topic - no significant duplicates found.',
        };
      }

      // Found potential duplicates
      const topSuggestion = result.suggestions[0];
      return {
        canCreate: false,
        hasDuplicate: true,
        duplicateWarning: `⚠️ Similar topic exists: "${topSuggestion.topic.name}"`,
        existingTopic: {
          id: topSuggestion.topic.id,
          name: topSuggestion.topic.name,
          description: topSuggestion.topic.description,
          similarity: `${(topSuggestion.combinedScore * 100).toFixed(0)}%`,
          matchTypes: topSuggestion.matchTypes,
        },
        recommendation: topSuggestion.recommendation === 'use_existing'
          ? `USE EXISTING: Assign to "${topSuggestion.topic.name}" instead of creating duplicate`
          : `CONSIDER MERGE: "${name}" overlaps with "${topSuggestion.topic.name}"`,
        reasoning: result.reasoning,
        otherSimilar: result.suggestions.slice(1, 3).map(s => ({
          name: s.topic.name,
          similarity: `${(s.combinedScore * 100).toFixed(0)}%`,
        })),
      };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Find the best matching topic for a message using multi-strategy matching
   */
  async find_best_topic_match({ message_text }) {
    // Use provided text or fall back to current message
    const text = message_text || currentMessage?.text;
    
    if (!text) {
      return { error: 'No message text provided and no current message available' };
    }

    try {
      // Fetch all existing topics
      const existingTopics = await fetchAllTopics();
      
      if (existingTopics.length === 0) {
        return {
          found: false,
          message: 'No topics exist yet. You will need to create the first one.',
          recommendation: 'create_new',
        };
      }

      // Extract keywords from message for matching
      const messageKeywords = extractKeywords(text);
      
      // Score each topic against the message
      const scoredTopics = [];
      
      for (const topic of existingTopics) {
        const topicId = topic._additional?.id;
        const topicName = topic.name;
        const topicDescription = topic.description || '';
        const topicKeywords = topic.keywords || [];
        
        // Calculate fuzzy name similarity (message text vs topic name)
        const nameSimilarity = fuzzySimilarity(text, topicName);
        
        // Calculate description similarity
        const descSimilarity = topicDescription 
          ? fuzzySimilarity(text, topicDescription)
          : 0;
        
        // Calculate keyword overlap
        const kwOverlap = keywordOverlap(messageKeywords, topicKeywords);
        
        // Combined score (weighted for message-to-topic matching)
        // More weight on keywords and description for message matching
        const combinedScore = (nameSimilarity * 0.2) + (descSimilarity * 0.3) + (kwOverlap * 0.5);
        
        if (combinedScore > 0.1) { // Only include topics with some relevance
          scoredTopics.push({
            topic: {
              id: topicId,
              name: topicName,
              description: topicDescription,
              keywords: topicKeywords,
              messageCount: topic.messageCount || 0,
            },
            scores: {
              name: nameSimilarity,
              description: descSimilarity,
              keywords: kwOverlap,
            },
            combinedScore,
            confidence: combinedScore,
          });
        }
      }
      
      // Sort by combined score
      scoredTopics.sort((a, b) => b.combinedScore - a.combinedScore);
      
      if (scoredTopics.length === 0) {
        return {
          found: false,
          message: 'No matching topics found for this message content.',
          recommendation: 'create_new',
          existingTopicCount: existingTopics.length,
        };
      }
      
      const bestMatch = scoredTopics[0];
      const confidencePercent = (bestMatch.combinedScore * 100).toFixed(0);
      
      // Determine recommendation based on confidence
      let recommendation;
      if (bestMatch.combinedScore >= 0.75) {
        recommendation = 'assign';
      } else if (bestMatch.combinedScore >= 0.5) {
        recommendation = 'likely_assign';
      } else if (bestMatch.combinedScore >= 0.3) {
        recommendation = 'review';
      } else {
        recommendation = 'consider_new';
      }
      
      return {
        found: true,
        bestMatch: {
          id: bestMatch.topic.id,
          name: bestMatch.topic.name,
          description: bestMatch.topic.description,
          messageCount: bestMatch.topic.messageCount,
          confidence: `${confidencePercent}%`,
          confidenceValue: bestMatch.combinedScore,
          scores: {
            nameMatch: `${(bestMatch.scores.name * 100).toFixed(0)}%`,
            descriptionMatch: `${(bestMatch.scores.description * 100).toFixed(0)}%`,
            keywordOverlap: `${(bestMatch.scores.keywords * 100).toFixed(0)}%`,
          },
        },
        recommendation,
        recommendationText: recommendation === 'assign' 
          ? `HIGH CONFIDENCE: Assign to "${bestMatch.topic.name}"`
          : recommendation === 'likely_assign'
          ? `GOOD MATCH: "${bestMatch.topic.name}" is likely the right topic`
          : recommendation === 'review'
          ? `POSSIBLE MATCH: Review if "${bestMatch.topic.name}" fits`
          : `LOW CONFIDENCE: Consider creating a new topic`,
        otherMatches: scoredTopics.slice(1, 4).map(t => ({
          id: t.topic.id,
          name: t.topic.name,
          confidence: `${(t.combinedScore * 100).toFixed(0)}%`,
        })),
        messageKeywords,
      };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Evaluate if an existing topic is specific enough or too broad/categorical
   */
  async evaluate_topic_specificity({ topic_id, proposed_message }) {
    // Get the topic and its messages
    const topicMessages = await getMessagesByTopic(topic_id, 10);
    const topic = await getTopicById(topic_id);
    
    if (!topic) {
      return { error: 'Topic not found' };
    }
    
    // Analyze specificity
    const issues = [];
    
    // Check 1: Does topic name sound like a category?
    const categoryPatterns = [
      /issues?$/i,
      /problems?$/i,
      /stuff$/i,
      /things?$/i,
      /general/i,
      /misc/i,
      /various/i,
      /and\s+\w+\s+(issues?|problems?)/i,  // "X and Y issues"
    ];
    
    for (const pattern of categoryPatterns) {
      if (pattern.test(topic.name)) {
        issues.push(`Topic name "${topic.name}" sounds like a category, not a specific issue`);
        break;
      }
    }
    
    // Check 2: Do existing messages seem to be about different things?
    if (topicMessages.length >= 3) {
      // This is a simplified check - in production you'd use embeddings
      const uniqueSubjects = new Set();
      for (const msg of topicMessages) {
        // Extract key nouns/subjects (simplified)
        const keywords = extractKeywords(msg.text);
        uniqueSubjects.add(keywords.slice(0, 2).join(' '));
      }
      
      if (uniqueSubjects.size > topicMessages.length * 0.6) {
        issues.push(`Topic contains ${topicMessages.length} messages about seemingly different subjects`);
      }
    }
    
    // Check 3: Would the proposed message fit naturally?
    const messageKeywords = extractKeywords(proposed_message);
    const topicKeywords = topic.keywords || [];
    const overlap = keywordOverlap(messageKeywords, topicKeywords);
    
    if (overlap < 0.2) {
      issues.push(`Low keyword overlap (${(overlap * 100).toFixed(0)}%) - message may not naturally fit this topic`);
    }
    
    const isSpecific = issues.length === 0;
    
    return {
      topicId: topic_id,
      topicName: topic.name,
      isSpecificEnough: isSpecific,
      issues: issues,
      recommendation: isSpecific 
        ? `Topic is specific - OK to assign if message is about "${topic.name}"`
        : `Topic may be too broad. Consider creating a more specific topic for this message.`,
      existingMessageSample: topicMessages.slice(0, 3).map(m => truncate(m.text, 100)),
    };
  },
};

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

/**
 * Create topic in database with duplicate detection
 */
async function createTopicInDB(name, description, keywords, options = {}) {
  const { skipValidation = false, verbose = true, users = [] } = options;
  
  // Validate topic before creation to prevent duplicates
  if (!skipValidation) {
    try {
      const existingTopics = await fetchAllTopics();
      const validation = await analyzeTopicCreation(
        { name, description, keywords },
        existingTopics,
        { semanticThreshold: 0.7, fuzzyThreshold: 0.6, keywordThreshold: 0.4 }
      );
      
      // If we shouldn't create this topic, return the existing one
      if (!validation.shouldCreate && validation.suggestions.length > 0) {
        const bestMatch = validation.suggestions[0];
        if (bestMatch.recommendation === 'use_existing' || bestMatch.combinedScore >= 0.75) {
          if (verbose) {
            console.log(`   ⚠️  Topic "${name}" is similar to existing "${bestMatch.topic.name}" (${(bestMatch.combinedScore * 100).toFixed(0)}% match)`);
            console.log(`   → Using existing topic instead of creating duplicate`);
          }
          return bestMatch.topic.id;
        }
      }
    } catch (error) {
      // If validation fails, proceed with creation
      console.error(`   ⚠️  Topic validation error: ${error.message}, proceeding with creation`);
    }
  }
  
  // Generate combined search text for better semantic matching (includes users)
  const combinedSearchText = getTopicEmbeddingText({ name, description, keywords, users });
  
  const result = await client.data
    .creator()
    .withClassName('Topic')
    .withProperties({
      name,
      description,
      keywords,
      users: users || [],  // List of user names associated with this topic
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
  // Get user name from message (enriched by slack-tester.js)
  const userName = message.user_name || message.user_real_name || message.user;
  
  // Create message with user name
  const msgResult = await client.data
    .creator()
    .withClassName('SlackMessage')
    .withProperties({
      text: message.text,
      user: message.user,
      userName: userName,  // Include user's display name
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

  // Update topic: message count + add user to users list + regenerate embedding
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
  
  // Regenerate combined search text with updated users for better embedding
  const updatedCombinedSearchText = getTopicEmbeddingText({
    name: currentTopic.properties.name,
    description: currentTopic.properties.description,
    keywords: currentTopic.properties.keywords,
    users: updatedUsers,
  });

  await client.data
    .updater()
    .withClassName('Topic')
    .withId(topicId)
    .withProperties({
      // Preserve existing properties
      name: currentTopic.properties.name,
      description: currentTopic.properties.description,
      keywords: currentTopic.properties.keywords,
      createdAt: currentTopic.properties.createdAt,
      // Update these
      users: updatedUsers,
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

  // Keep only last 20 messages in memory
  if (conversationContext[channelId].recentMessages.length > 20) {
    conversationContext[channelId].recentMessages.shift();
  }

  conversationContext[channelId].currentTopicId = topicId;
  conversationContext[channelId].currentTopicName = topicName;

  return msgResult.id;
}

/**
 * Main categorization function using agentic loop
 */
async function categorizeMessage(message, channelInfo, options = {}) {
  const { verbose = true, maxIterations = 10 } = options;
  const startTime = Date.now();

  if (!message.text || message.text.trim().length === 0) {
    if (verbose) console.log('  ⏭️  Skipping empty message');
    return null;
  }

  // Set current context for tool calls
  currentMessage = message;
  currentChannelInfo = channelInfo;

  // Define these BEFORE using them in logging
  const isShortMessage = message.text.length < 15;
  const isThreadReply = message.thread_ts && message.thread_ts !== message.ts;

  if (verbose) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🤖 SMART CATEGORIZER - New Message`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   📝 Text: "${message.text.substring(0, 80)}${message.text.length > 80 ? '...' : ''}"`);
    console.log(`   📏 Length: ${message.text.length} chars (${isShortMessage ? 'SHORT - likely confirmation' : 'SUBSTANTIVE'})`);
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
**Thread Reply:** ${isThreadReply ? 'YES - this replies to another message' : 'NO'}
**Message Type:** ${isShortMessage ? 'SHORT (likely confirmation/reaction)' : 'SUBSTANTIVE (has real content)'}

## YOUR INSTRUCTIONS

${isThreadReply 
  ? `This is a THREAD REPLY.
1. Call get_thread_parent to find what this replies to
2. Use the SAME topic as the parent message`
  : isShortMessage 
    ? `This is a SHORT message (probably "ok", "yes", "حله", "مرسی", etc.)
1. Call get_conversation_context to see recent messages
2. This is likely a response - inherit the topic from the most recent message`
    : `This is a SUBSTANTIVE message with real content.
1. First, understand what SUBJECT this message discusses
2. Call get_conversation_context to see the recent conversation
3. Call get_all_topics to see existing topics
4. Call search_existing_topics with keywords from this message
5. Decide: Does this match an existing topic, or is it a new subject?

Key question: What is this message ABOUT? Find or create the right topic.`}

DO NOT make a decision until you have gathered sufficient context using the tools.`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  let decision = null;
  let iterations = 0;

  while (!decision && iterations < maxIterations) {
    iterations++;

    if (verbose) {
      console.log(`\n   ${'─'.repeat(50)}`);
      console.log(`   📍 ITERATION ${iterations}/${maxIterations}`);
      console.log(`   ${'─'.repeat(50)}`);
    };

    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1000,
      });

      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      // Log assistant's thinking if it has content
      if (verbose && assistantMessage.content) {
        console.log(`\n      💭 Agent thinking:`);
        console.log(`         ${assistantMessage.content.split('\n').join('\n         ')}`);
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments || '{}');

          if (verbose) {
            console.log(`\n      🔧 Tool: ${toolName}`);
            if (Object.keys(args).length > 0) {
              console.log(`         Args: ${JSON.stringify(args)}`);
            }
          }

          const result = await executeToolCall(toolName, args);

          if (result.action === 'assign' || result.action === 'create') {
            decision = result;
            if (verbose) {
              console.log(`\n      ✅ DECISION MADE`);
              console.log(`         Action: ${result.action === 'assign' ? 'Assign to existing topic' : 'Create new topic'}`);
              console.log(`         Topic: ${result.action === 'assign' ? result.topic_name : result.name}`);
              console.log(`         Reasoning: ${result.reasoning}`);
            }
          } else {
            // Log the tool result
            if (verbose) {
              console.log(`         📋 Result:`);
              const resultStr = JSON.stringify(result, null, 2);
              const lines = resultStr.split('\n');
              // Show first 15 lines, summarize if longer
              if (lines.length > 15) {
                console.log(`         ${lines.slice(0, 15).join('\n         ')}`);
                console.log(`         ... (${lines.length - 15} more lines)`);
              } else {
                console.log(`         ${lines.join('\n         ')}`);
              }
            }
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result, null, 2),
            });
          }
        }
      } else if (response.choices[0].finish_reason === 'stop' && !decision) {
        // Agent stopped without using a decision tool - prompt it to decide
        if (verbose) {
          console.log(`\n      ⚠️  Agent stopped without making a decision`);
          console.log(`         Prompting agent to make a final choice...`);
        }
        
        messages.push({
          role: 'user',
          content: `You have gathered context but haven't made a final decision yet.

Based on what you learned, you MUST now call either:
- assign_to_topic (if you found a matching existing topic)
- create_new_topic (if this is a new subject)

Make your decision now.`,
        });
        
        // Continue to next iteration to let agent decide
        continue;
      }
    } catch (error) {
      console.error(`\n      ❌ ERROR in iteration ${iterations}`);
      console.error(`         Message: ${error.message}`);
      if (error.status) console.error(`         HTTP Status: ${error.status}`);
      if (error.code) console.error(`         Code: ${error.code}`);
      
      if (iterations >= maxIterations) {
        console.error(`         Max iterations reached, throwing error`);
        throw error;
      }
      console.log(`         Retrying...`);
    }
  }

  // If no decision after all iterations, create a fallback based on message analysis
  if (!decision) {
    if (verbose) {
      console.log(`\n   ⚠️  FALLBACK MODE`);
      console.log(`   ${'─'.repeat(50)}`);
      console.log(`   Max iterations (${maxIterations}) reached without decision.`);
      console.log(`   Using fallback logic...`);
    }
    
    // Simple fallback: analyze message content
    const text = message.text.toLowerCase();
    const channelContext = conversationContext[channelInfo.id];
    
    // For short messages, use recent topic if available
    if (message.text.length < 15 && channelContext?.currentTopicId) {
      decision = {
        action: 'assign',
        topic_id: channelContext.currentTopicId,
        topic_name: channelContext.currentTopicName,
        reasoning: 'Fallback: Short message assigned to recent topic',
      };
      if (verbose) {
        console.log(`   → Short message detected`);
        console.log(`   → Assigning to recent topic: "${channelContext.currentTopicName}"`);
      }
    } else {
      // Create a general topic as last resort
      decision = {
        action: 'create',
        name: 'General Discussion',
        description: 'General messages and conversations',
        keywords: ['general', 'chat', 'discussion'],
        reasoning: 'Fallback: Could not determine specific topic',
      };
      if (verbose) {
        console.log(`   → Creating fallback "General Discussion" topic`);
      }
    }
  }

  // Execute decision
  let topicId, topicName;

  if (decision.action === 'assign') {
    topicId = decision.topic_id;
    topicName = decision.topic_name;
  } else {
    // Get user name for initial topic creation
    const userName = message.user_name || message.user_real_name || message.user;
    topicId = await createTopicInDB(decision.name, decision.description, decision.keywords, {
      users: userName ? [userName] : [],
    });
    topicName = decision.name;
    if (verbose) console.log(`      🆕 Created topic: ${topicId}`);
  }

  const messageId = await storeMessageWithTopic(message, channelInfo, topicId, topicName);

  const totalTime = Date.now() - startTime;
  if (verbose) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`   ✨ CATEGORIZATION COMPLETE`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   📌 Topic: ${topicName}`);
    console.log(`   🆔 Topic ID: ${topicId}`);
    console.log(`   📝 Message ID: ${messageId}`);
    console.log(`   🔄 Iterations: ${iterations}`);
    console.log(`   ⏱️  Time: ${totalTime}ms`);
    console.log(`   📊 Action: ${decision.action === 'assign' ? 'Assigned to existing' : 'Created new topic'}`);
    console.log(`   💡 Reasoning: ${decision.reasoning}`);
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

/**
 * Get all topics (compatibility)
 */
async function getAllTopics() {
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields('name description keywords users combinedSearchText messageCount createdAt updatedAt _additional { id }')
      .withLimit(100)
      .do();
    return result.data.Get.Topic || [];
  } catch (error) {
    console.error('Error getting topics:', error);
    return [];
  }
}

/**
 * Reset conversation context (useful for testing)
 */
function resetContext() {
  Object.keys(conversationContext).forEach(key => delete conversationContext[key]);
}

// ============================================================================
// FAST SINGLE-SHOT CATEGORIZER
// ============================================================================

/**
 * Build pre-loaded context for fast categorization
 */
async function buildCategorizationContext(message, channelInfo) {
  const isThreadReply = message.thread_ts && message.thread_ts !== message.ts;
  const isShortMessage = message.text.length < 15;

  // Fetch all context in parallel
  const [recentMessages, allTopics, threadContext] = await Promise.all([
    // Get recent messages from Slack
    fetchMessagesBefore(channelInfo.id, message.ts, 5),
    // Get all existing topics
    fetchAllTopics(),
    // Get thread parent if applicable
    isThreadReply ? fetchThreadFromDB(message.thread_ts) : Promise.resolve([]),
  ]);

  // Enrich recent messages with their topics
  const topicsMap = await fetchMessageTopics(recentMessages);

  const enrichedRecentMessages = recentMessages.map((m) => ({
    text: truncate(m.text, 150),
    user: m.user,
    minutesAgo: getMinutesBetween(message.ts, m.ts),
    topicId: topicsMap[m.ts]?.id || null,
    topicName: topicsMap[m.ts]?.name || null,
  }));

  // Process thread context
  let threadParent = null;
  if (isThreadReply && threadContext.length > 0) {
    const parent = threadContext.find((m) => m.timestamp === message.thread_ts) || threadContext[0];
    const topic = extractTopicInfo(parent.topic);
    threadParent = {
      text: truncate(parent.text, 200),
      topicId: topic?.id,
      topicName: topic?.name,
    };
  }

  return {
    message: {
      text: message.text,
      user: message.user,
      ts: message.ts,
      length: message.text.length,
      isShortMessage,
      isThreadReply,
    },
    channel: {
      id: channelInfo.id,
      name: channelInfo.name,
    },
    recentMessages: enrichedRecentMessages,
    topics: allTopics.map((t) => ({
      id: t._additional.id,
      name: t.name,
      description: t.description,
      messageCount: t.messageCount,
      keywords: t.keywords,
    })),
    threadParent,
  };
}

/**
 * Build the user message with all context injected
 */
function buildFastCategorizerPrompt(context) {
  const { message, channel, recentMessages, topics, threadParent } = context;

  const messageType = message.isShortMessage ? 'SHORT (likely confirmation/reaction)' : 'SUBSTANTIVE';

  // Thread context section
  let threadSection = 'Not a thread reply.';
  if (threadParent) {
    threadSection = `This is a THREAD REPLY.
Parent message: "${threadParent.text}"
Parent topic: ${threadParent.topicName || 'uncategorized'} ${threadParent.topicId ? `(ID: ${threadParent.topicId})` : ''}
→ Use the same topic as parent.`;
  }

  // Recent messages section
  let recentSection = 'No recent messages.';
  if (recentMessages.length > 0) {
    recentSection = recentMessages
      .map(
        (m, i) =>
          `${i + 1}. [${m.minutesAgo} min ago] ${m.user}: "${m.text}"
   Topic: ${m.topicName || 'uncategorized'} ${m.topicId ? `(ID: ${m.topicId})` : ''}`
      )
      .join('\n');
  }

  // Topics section
  let topicsSection = 'No topics exist yet. You will need to create the first one.';
  if (topics.length > 0) {
    topicsSection = topics
      .map(
        (t) =>
          `- **${t.name}** (ID: ${t.id})
  ${t.description || 'No description'}
  Messages: ${t.messageCount || 0} | Keywords: ${t.keywords?.join(', ') || 'none'}`
      )
      .join('\n');
  }

  return `# MESSAGE TO CATEGORIZE

Text: "${message.text}"
User: ${message.user}
Channel: ${channel.name}
Timestamp: ${message.ts}
Message length: ${message.length} characters
Type: ${messageType}

# THREAD CONTEXT
${threadSection}

# RECENT CONVERSATION (last ${recentMessages.length} messages in this channel)
${recentSection}

# ALL EXISTING TOPICS (${topics.length} total)
${topicsSection}

# YOUR TASK

Analyze the message and context above. Output your decision as JSON.`;
}

/**
 * Parse LLM response into decision object
 */
function parseFastCategorizerResponse(responseText) {
  try {
    // Try to extract JSON from the response
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (parsed.action === 'assign') {
      if (!parsed.topic_id || !parsed.topic_name) {
        throw new Error('Missing topic_id or topic_name for assign action');
      }
      return {
        action: 'assign',
        topic_id: parsed.topic_id,
        topic_name: parsed.topic_name,
        confidence: parsed.confidence || 0.8,
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    } else if (parsed.action === 'create') {
      if (!parsed.topic_name) {
        throw new Error('Missing topic_name for create action');
      }
      return {
        action: 'create',
        name: parsed.topic_name,
        description: parsed.topic_description || `Messages about ${parsed.topic_name}`,
        keywords: parsed.topic_keywords || [],
        confidence: parsed.confidence || 0.7,
        reasoning: parsed.reasoning || 'New topic needed',
      };
    } else {
      throw new Error(`Invalid action: ${parsed.action}`);
    }
  } catch (error) {
    throw new Error(`Failed to parse LLM response: ${error.message}\nResponse: ${responseText}`);
  }
}

/**
 * Decide whether to use fast or full agent mode
 */
function shouldUseFastMode(message, context) {
  // Always use fast mode for thread replies - simple decision
  if (context.message.isThreadReply && context.threadParent?.topicId) {
    return true;
  }

  // Always use fast mode for short messages with recent context
  if (context.message.isShortMessage && context.recentMessages.length > 0) {
    return true;
  }

  // Use agent mode if no context and many topics (needs search)
  if (context.recentMessages.length === 0 && context.topics.length > 20) {
    return false;
  }

  // Use agent mode for very long/complex messages
  if (message.text.length > 500) {
    return false;
  }

  // Default: use fast mode
  return true;
}

/**
 * Smart categorization - automatically chooses fast or agent mode
 */
async function categorizeMessageSmart(message, channelInfo, options = {}) {
  const { verbose = true } = options;

  if (!message.text || message.text.trim().length === 0) {
    if (verbose) console.log('  ⏭️  Skipping empty message');
    return null;
  }

  return categorizeMessage(message, channelInfo, options);

}

export { 
  categorizeMessage, 
  categorizeMessageSmart,
  getAllTopics, 
  resetContext,
  buildCategorizationContext,
  shouldUseFastMode,
  createTopicInDB,
};
