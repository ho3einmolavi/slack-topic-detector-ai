import { client } from './weaviate-setup.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Search Tools for Agentic RAG
 * These tools are available for the LLM agent to use
 */

/**
 * Hybrid search combining BM25 (keyword) + vector (semantic) search
 * @param {string} query - Search query
 * @param {number} alpha - Balance: 0 = pure keyword, 1 = pure semantic, 0.5 = balanced
 * @param {number} limit - Max results
 */
async function hybridSearchMessages(query, alpha = 0.5, limit = 15) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
            _additional { id }
          }
        }
        _additional { score }
      `)
      .withHybrid({
        query: query,
        alpha: alpha,
      })
      .withLimit(limit)
      .do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
      relevanceScore: msg._additional?.score || 0,
    }));
  } catch (error) {
    console.error('Hybrid search error:', error.message);
    return [];
  }
}

/**
 * Pure semantic search using vector similarity
 */
async function semanticSearchMessages(query, limit = 15) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
            _additional { id }
          }
        }
        _additional { distance certainty }
      `)
      .withNearText({ concepts: [query] })
      .withLimit(limit)
      .do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
      similarity: msg._additional?.certainty || (1 - (msg._additional?.distance || 1)),
    }));
  } catch (error) {
    console.error('Semantic search error:', error.message);
    return [];
  }
}

/**
 * Keyword search using BM25 (good for exact matches)
 */
async function keywordSearchMessages(query, limit = 15) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
            _additional { id }
          }
        }
        _additional { score }
      `)
      .withBm25({
        query: query,
        properties: ['text'],
      })
      .withLimit(limit)
      .do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
      bm25Score: msg._additional?.score || 0,
    }));
  } catch (error) {
    console.error('Keyword search error:', error.message);
    return [];
  }
}

/**
 * Search messages by channel name
 */
async function searchByChannel(channelName, query = null, limit = 20) {
  try {
    let graphqlQuery = client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
          }
        }
        _additional { id }
      `)
      .withWhere({
        path: ['channelName'],
        operator: 'Like',
        valueText: `*${channelName}*`,
      })
      .withLimit(limit);

    // If query provided, add hybrid search
    if (query) {
      graphqlQuery = graphqlQuery.withHybrid({
        query: query,
        alpha: 0.5,
      });
    }

    const result = await graphqlQuery.do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
    }));
  } catch (error) {
    console.error('Channel search error:', error.message);
    return [];
  }
}

/**
 * Search messages by user ID
 */
async function searchByUser(userId, query = null, limit = 20) {
  try {
    let graphqlQuery = client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
          }
        }
        _additional { id }
      `)
      .withWhere({
        path: ['user'],
        operator: 'Equal',
        valueText: userId,
      })
      .withLimit(limit);

    if (query) {
      graphqlQuery = graphqlQuery.withHybrid({
        query: query,
        alpha: 0.5,
      });
    }

    const result = await graphqlQuery.do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
    }));
  } catch (error) {
    console.error('User search error:', error.message);
    return [];
  }
}

/**
 * Search messages within a date range
 */
async function searchByDateRange(startDate, endDate, query = null, limit = 30) {
  try {
    // Convert dates to Unix timestamps
    const startTs = new Date(startDate).getTime() / 1000;
    const endTs = new Date(endDate).getTime() / 1000;

    let graphqlQuery = client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
          }
        }
        _additional { id }
      `)
      .withWhere({
        operator: 'And',
        operands: [
          {
            path: ['timestamp'],
            operator: 'GreaterThanEqual',
            valueText: startTs.toString(),
          },
          {
            path: ['timestamp'],
            operator: 'LessThanEqual',
            valueText: endTs.toString(),
          },
        ],
      })
      .withLimit(limit);

    if (query) {
      graphqlQuery = graphqlQuery.withHybrid({
        query: query,
        alpha: 0.5,
      });
    }

    const result = await graphqlQuery.do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
    }));
  } catch (error) {
    console.error('Date range search error:', error.message);
    return [];
  }
}

/**
 * Get all messages in a thread
 */
async function getThreadMessages(threadTs, limit = 50) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
          }
        }
        _additional { id }
      `)
      .withWhere({
        path: ['threadTs'],
        operator: 'Equal',
        valueText: threadTs,
      })
      .withLimit(limit)
      .do();

    const messages = result.data.Get.SlackMessage || [];
    
    // Sort by timestamp
    return messages
      .map(msg => ({
        ...msg,
        readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
      }))
      .sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
  } catch (error) {
    console.error('Thread search error:', error.message);
    return [];
  }
}

/**
 * Search topics by name/description
 */
async function searchTopics(query, limit = 10) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields(`
        name
        description
        keywords
        messageCount
        createdAt
        updatedAt
        _additional { id distance }
      `)
      .withHybrid({
        query: query,
        alpha: 0.5,
      })
      .withLimit(limit)
      .do();

    return (result.data.Get.Topic || []).map(topic => ({
      ...topic,
      similarity: 1 - (topic._additional?.distance || 0),
    }));
  } catch (error) {
    console.error('Topic search error:', error.message);
    return [];
  }
}

/**
 * Get messages for a specific topic
 */
async function getMessagesByTopic(topicId, limit = 20) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        text
        user
        timestamp
        channelName
        threadTs
        topic {
          ... on Topic {
            name
            _additional { id }
          }
        }
        _additional { id }
      `)
      .withWhere({
        path: ['topic', 'Topic', 'id'],
        operator: 'Equal',
        valueText: topicId,
      })
      .withLimit(limit)
      .do();

    return (result.data.Get.SlackMessage || []).map(msg => ({
      ...msg,
      readableTime: new Date(parseFloat(msg.timestamp) * 1000).toLocaleString(),
    }));
  } catch (error) {
    console.error('Topic messages error:', error.message);
    return [];
  }
}

/**
 * Get list of all unique users
 */
async function getAllUsers() {
  try {
    const result = await client.graphql
      .aggregate()
      .withClassName('SlackMessage')
      .withFields('user { topOccurrences(limit: 100) { value occurs } }')
      .do();

    const userOccurrences = result.data.Aggregate.SlackMessage[0]?.user?.topOccurrences || [];
    return userOccurrences.map(u => ({ userId: u.value, messageCount: u.occurs }));
  } catch (error) {
    console.error('Get users error:', error.message);
    return [];
  }
}

/**
 * Get list of all channels
 */
async function getAllChannels() {
  try {
    const result = await client.graphql
      .aggregate()
      .withClassName('SlackMessage')
      .withFields('channelName { topOccurrences(limit: 50) { value occurs } }')
      .do();

    const channelOccurrences = result.data.Aggregate.SlackMessage[0]?.channelName?.topOccurrences || [];
    return channelOccurrences.map(c => ({ channelName: c.value, messageCount: c.occurs }));
  } catch (error) {
    console.error('Get channels error:', error.message);
    return [];
  }
}

/**
 * Get database statistics
 */
async function getStatistics() {
  try {
    const [topicsResult, messagesResult] = await Promise.all([
      client.graphql.aggregate().withClassName('Topic').withFields('meta { count }').do(),
      client.graphql.aggregate().withClassName('SlackMessage').withFields('meta { count }').do(),
    ]);

    const topicCount = topicsResult.data.Aggregate.Topic[0]?.meta?.count || 0;
    const messageCount = messagesResult.data.Aggregate.SlackMessage[0]?.meta?.count || 0;

    return {
      totalTopics: topicCount,
      totalMessages: messageCount,
      averageMessagesPerTopic: topicCount > 0 ? (messageCount / topicCount).toFixed(2) : 0,
    };
  } catch (error) {
    console.error('Statistics error:', error.message);
    return null;
  }
}

/**
 * Combined smart search - tries multiple strategies and merges results
 */
async function smartSearch(query, options = {}) {
  const { limit = 15, includeTopics = true } = options;

  try {
    // Run multiple search strategies in parallel
    const [hybridResults, semanticResults, keywordResults] = await Promise.all([
      hybridSearchMessages(query, 0.5, limit),
      semanticSearchMessages(query, limit),
      keywordSearchMessages(query, limit),
    ]);

    // Merge and deduplicate results
    const seen = new Set();
    const merged = [];

    // Priority: hybrid > semantic > keyword
    const addResults = (results, source) => {
      for (const result of results) {
        const key = `${result.user}-${result.timestamp}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({ ...result, searchSource: source });
        }
      }
    };

    addResults(hybridResults, 'hybrid');
    addResults(semanticResults, 'semantic');
    addResults(keywordResults, 'keyword');

    // Optionally search topics too
    let topics = [];
    if (includeTopics) {
      topics = await searchTopics(query, 5);
    }

    return {
      messages: merged.slice(0, limit),
      topics,
      searchMethods: ['hybrid', 'semantic', 'keyword'],
    };
  } catch (error) {
    console.error('Smart search error:', error.message);
    return { messages: [], topics: [], searchMethods: [] };
  }
}

// Tool definitions for OpenAI function calling
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'hybrid_search',
      description: 'Search messages using hybrid search (combines keyword matching and semantic understanding). Best for most queries.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          alpha: {
            type: 'number',
            description: 'Balance between keyword (0) and semantic (1) search. Default 0.5.',
            default: 0.5,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 15.',
            default: 15,
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
      description: 'Search messages using exact keyword matching (BM25). Best for finding specific terms, names, or technical words.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query with specific keywords',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 15.',
            default: 15,
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
      description: 'Search messages by meaning/concept (vector similarity). Best for finding related content even with different words.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query describing what you are looking for',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 15.',
            default: 15,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_by_channel',
      description: 'Search messages in a specific channel',
      parameters: {
        type: 'object',
        properties: {
          channel_name: {
            type: 'string',
            description: 'Channel name to filter by (partial match supported)',
          },
          query: {
            type: 'string',
            description: 'Optional search query within the channel',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 20.',
            default: 20,
          },
        },
        required: ['channel_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_by_user',
      description: 'Search messages from a specific user',
      parameters: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            description: 'Slack user ID',
          },
          query: {
            type: 'string',
            description: 'Optional search query within user messages',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 20.',
            default: 20,
          },
        },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_by_date_range',
      description: 'Search messages within a specific date range',
      parameters: {
        type: 'object',
        properties: {
          start_date: {
            type: 'string',
            description: 'Start date in ISO format (e.g., 2025-01-01)',
          },
          end_date: {
            type: 'string',
            description: 'End date in ISO format (e.g., 2025-12-31)',
          },
          query: {
            type: 'string',
            description: 'Optional search query within the date range',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 30.',
            default: 30,
          },
        },
        required: ['start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_thread_messages',
      description: 'Get all messages in a specific thread for full context',
      parameters: {
        type: 'object',
        properties: {
          thread_ts: {
            type: 'string',
            description: 'Thread timestamp identifier',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages. Default 50.',
            default: 50,
          },
        },
        required: ['thread_ts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_topics',
      description: 'Search conversation topics',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for topics',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 10.',
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
      name: 'get_messages_by_topic',
      description: 'Get all messages belonging to a specific topic',
      parameters: {
        type: 'object',
        properties: {
          topic_id: {
            type: 'string',
            description: 'Topic UUID',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results. Default 20.',
            default: 20,
          },
        },
        required: ['topic_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_all_users',
      description: 'Get list of all users who have sent messages, with message counts',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_all_channels',
      description: 'Get list of all channels with message counts',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_statistics',
      description: 'Get database statistics (total messages, topics, etc.)',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// Execute a tool by name
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'hybrid_search':
      return await hybridSearchMessages(args.query, args.alpha || 0.5, args.limit || 15);
    case 'keyword_search':
      return await keywordSearchMessages(args.query, args.limit || 15);
    case 'semantic_search':
      return await semanticSearchMessages(args.query, args.limit || 15);
    case 'search_by_channel':
      return await searchByChannel(args.channel_name, args.query, args.limit || 20);
    case 'search_by_user':
      return await searchByUser(args.user_id, args.query, args.limit || 20);
    case 'search_by_date_range':
      return await searchByDateRange(args.start_date, args.end_date, args.query, args.limit || 30);
    case 'get_thread_messages':
      return await getThreadMessages(args.thread_ts, args.limit || 50);
    case 'search_topics':
      return await searchTopics(args.query, args.limit || 10);
    case 'get_messages_by_topic':
      return await getMessagesByTopic(args.topic_id, args.limit || 20);
    case 'get_all_users':
      return await getAllUsers();
    case 'get_all_channels':
      return await getAllChannels();
    case 'get_statistics':
      return await getStatistics();
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export {
  // Individual search functions
  hybridSearchMessages,
  semanticSearchMessages,
  keywordSearchMessages,
  searchByChannel,
  searchByUser,
  searchByDateRange,
  getThreadMessages,
  searchTopics,
  getMessagesByTopic,
  getAllUsers,
  getAllChannels,
  getStatistics,
  smartSearch,
  // For the agent
  toolDefinitions,
  executeTool,
};
