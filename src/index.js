/**
 * Smart Categorizer - Main entry point
 * 
 * A modular message categorization system that uses AI to organize
 * Slack messages into specific, actionable topics.
 */

// Main categorizer
export { categorizeMessage, categorizeMessageSmart } from './categorizer.js';

// Database operations
export { 
  getAllTopics, 
  createTopicInDB, 
  updateTopic,
  getTopicById,
  fetchAllTopics 
} from './services/database.js';

// Context management
export { resetContext, conversationContext } from './context/conversation.js';

// Utilities
export { buildTopicEmbeddingText, buildMessageEmbeddingText } from './utils/embedding.js';

// Search functions (for advanced usage)
export { 
  hybridSearchTopics, 
  semanticSearchTopics, 
  keywordSearchTopics 
} from './search/index.js';
