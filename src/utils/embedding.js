/**
 * Embedding text building utilities
 */

/**
 * Build structured embedding text for topics
 * Optimized for better semantic retrieval
 * @param {Object} topic - Topic object
 * @returns {string} Combined embedding text
 */
export function buildTopicEmbeddingText(topic) {
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
 * @param {Object} message - Message object
 * @param {Object} context - Context object with recent messages
 * @returns {string} Combined embedding text
 */
export function buildMessageEmbeddingText(message, context) {
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
