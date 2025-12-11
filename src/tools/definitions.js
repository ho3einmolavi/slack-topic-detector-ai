/**
 * OpenAI tool definitions for the categorizer agent
 */

export const tools = [
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
          improved_name: {
            type: 'string',
            description: 'Optional if action="assign". A better/more accurate topic name based on accumulated messages',
          },
          improved_description: {
            type: 'string',
            description: 'Optional if action="assign". A better/more accurate topic description/summary based on accumulated messages',
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
