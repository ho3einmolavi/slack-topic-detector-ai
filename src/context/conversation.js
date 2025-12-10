/**
 * Conversation context management
 */

/**
 * In-memory conversation context storage
 * Structure: { channelId: { recentMessages: [], currentTopicId, currentTopicName } }
 */
export const conversationContext = {};

/**
 * Reset all conversation context
 */
export function resetContext() {
  Object.keys(conversationContext).forEach(key => delete conversationContext[key]);
}

/**
 * Get context for a specific channel
 * @param {string} channelId - Channel ID
 * @returns {Object|null} Channel context
 */
export function getChannelContext(channelId) {
  return conversationContext[channelId] || null;
}

/**
 * Update context for a channel
 * @param {string} channelId - Channel ID
 * @param {Object} update - Update object
 */
export function updateChannelContext(channelId, update) {
  if (!conversationContext[channelId]) {
    conversationContext[channelId] = {
      recentMessages: [],
      currentTopicId: null,
      currentTopicName: null,
    };
  }
  Object.assign(conversationContext[channelId], update);
}
