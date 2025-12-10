/**
 * Smart Categorizer - Re-export from modular source
 * 
 * This file maintains backward compatibility by re-exporting
 * from the new modular structure in src/
 */

export {
  categorizeMessage,
  categorizeMessageSmart,
  getAllTopics,
  resetContext,
  createTopicInDB,
  buildTopicEmbeddingText,
} from './src/index.js';
