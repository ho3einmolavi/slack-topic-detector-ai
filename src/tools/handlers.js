/**
 * Tool handlers for the categorizer agent
 */
import { fetchMessagesBefore, fetchThreadMessages } from '../services/slack.js';
import { fetchMessageTopic, fetchMessageTopics, fetchAllTopics } from '../services/database.js';
import { conversationContext } from '../context/conversation.js';
import { truncate, getMinutesBetween, extractKeywords } from '../utils/index.js';
import { 
  hybridSearchTopics, 
  semanticSearchTopics, 
  keywordSearchTopics,
  reciprocalRankFusion,
  calculateConfidence,
  buildMatchReasons,
  generateRecommendation
} from '../search/index.js';

// Current message context (set by categorizer)
let currentMessage = null;
let currentChannelInfo = null;

/**
 * Set the current message context
 * @param {Object} message - Message object
 * @param {Object} channelInfo - Channel information
 */
export function setCurrentContext(message, channelInfo) {
  currentMessage = message;
  currentChannelInfo = channelInfo;
}

/**
 * Tool handlers object
 */
export const toolHandlers = {
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
      fetchMessagesBefore(channelId, messageTs, Math.min(message_count, 10)),
      isThreadReply ? fetchThreadMessages(channelId, threadTs) : Promise.resolve([]),
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
    console.log(`[find_topics] Starting search for query: "${query}" (include_all: ${include_all})`);
    const messageKeywords = extractKeywords(query);
    console.log(`[find_topics] Extracted keywords:`, messageKeywords);
    
    // Run parallel searches
    const [hybridResults, vectorResults, bm25Results, allTopics] = await Promise.all([
      hybridSearchTopics(query, 15),
      semanticSearchTopics(query, 15),
      keywordSearchTopics(query, 15),
      include_all ? fetchAllTopics() : Promise.resolve([]),
    ]);

    console.log(`[find_topics] Search results - Hybrid: ${hybridResults.length}, Vector: ${vectorResults.length}, BM25: ${bm25Results.length}`);

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
      };
    });

    console.log(`[find_topics] Top ${scoredMatches.length} scored matches:`, scoredMatches.map(m => `${m.name} (${m.confidence})`).join(', '));

    // Generate recommendation
    const recommendation = generateRecommendation(scoredMatches);
    console.log(`[find_topics] Final recommendation:`, recommendation);

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
  async categorize({ action, topic_id, topic_name, improved_name, improved_description, new_topic, reasoning }) {
    if (action === 'assign') {
      if (!topic_id) {
        return { error: 'topic_id is required when action is "assign"' };
      }
      const result = {
        action: 'assign',
        topic_id,
        topic_name: topic_name || 'Unknown',
        reasoning,
      };
      // Include improved name/description if provided
      if (improved_name) {
        result.improved_name = improved_name;
      }
      if (improved_description) {
        result.improved_description = improved_description;
      }
      return result;
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
 * Execute a tool call by name
 * @param {string} toolName - Tool name
 * @param {Object} args - Tool arguments
 * @returns {Promise<Object>} Tool result
 */
export async function executeToolCall(toolName, args) {
  const handler = toolHandlers[toolName];
  
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return handler.call(toolHandlers, args);
}
