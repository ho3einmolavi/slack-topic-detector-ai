/**
 * Weaviate database operations
 */
import { client } from '../../weaviate-setup.js';
import { TOPIC_FIELDS, MESSAGE_WITH_TOPIC_FIELDS, MAX_TOPICS_LIMIT } from '../config/constants.js';
import { buildTopicEmbeddingText } from '../utils/embedding.js';
import { truncate } from '../utils/text.js';

/**
 * Extract topic info from a topic object
 * @param {Array} topic - Topic array from query result
 * @returns {Object|null} Extracted topic info
 */
export function extractTopicInfo(topic) {
  if (!topic?.[0]) return null;
  return {
    id: topic[0]._additional?.id,
    name: topic[0].name,
  };
}

/**
 * Fetch message topic by timestamp
 * @param {string} timestamp - Message timestamp
 * @returns {Promise<Object|null>} Topic info
 */
export async function fetchMessageTopic(timestamp) {
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
 * Fetch topics for multiple messages
 * @param {Array} messages - Messages array
 * @returns {Promise<Object>} Map of timestamp to topic
 */
export async function fetchMessageTopics(messages) {
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
 * @param {string} threadTs - Thread timestamp
 * @returns {Promise<Array>} Thread messages
 */
export async function fetchThreadFromDB(threadTs) {
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
 * Fetch all topics
 * @param {number} limit - Maximum topics to fetch
 * @returns {Promise<Array>} Topics array
 */
export async function fetchAllTopics(limit = MAX_TOPICS_LIMIT) {
  const result = await client.graphql
    .get()
    .withClassName('Topic')
    .withFields(TOPIC_FIELDS)
    .withLimit(limit)
    .do();

  return result.data?.Get?.Topic || [];
}

/**
 * Get topic by ID
 * @param {string} topicId - Topic UUID
 * @returns {Promise<Object|null>} Topic object
 */
export async function getTopicById(topicId) {
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

/**
 * Create a new topic in the database
 * @param {string} name - Topic name
 * @param {string} description - Topic description
 * @param {Array} keywords - Topic keywords
 * @param {Object} options - Additional options
 * @returns {Promise<string>} Created topic ID
 */
export async function createTopicInDB(name, description, keywords, options = {}) {
  const { users = [], sampleMessages = [] } = options;
  
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
 * Store a message and link it to a topic
 * @param {Object} message - Message object
 * @param {Object} channelInfo - Channel information
 * @param {string} topicId - Topic ID to link
 * @param {string} topicName - Topic name
 * @param {Object} conversationContext - Conversation context object
 * @returns {Promise<string>} Created message ID
 */
export async function storeMessageWithTopic(message, channelInfo, topicId, topicName, conversationContext) {
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

  const existingUsers = currentTopic.properties.users || [];
  const updatedUsers = existingUsers.includes(userName) 
    ? existingUsers 
    : [...existingUsers, userName];
  
  const existingSamples = currentTopic.properties.sampleMessages || [];
  const updatedSamples = [...existingSamples, truncate(message.text, 100)].slice(-10);
  
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

/**
 * Get all topics from database
 * @returns {Promise<Array>} All topics
 */
export async function getAllTopics() {
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
