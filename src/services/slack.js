/**
 * Slack API service
 */
import dotenv from 'dotenv';

dotenv.config();

const SLACK_API_KEY = process.env.SLACK_API_KEY;
const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Make a Slack API call
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} API response data
 */
export async function slackApiCall(endpoint, params = {}) {
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
 * Fetch messages before a given timestamp
 * @param {string} channelId - Channel ID
 * @param {string} beforeTs - Timestamp to fetch before
 * @param {number} count - Number of messages to fetch
 * @returns {Promise<Array>} Messages array
 */
export async function fetchMessagesBefore(channelId, beforeTs, count = 5) {
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

/**
 * Fetch thread messages
 * @param {string} channelId - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @returns {Promise<Array>} Thread messages array
 */
export async function fetchThreadMessages(channelId, threadTs) {
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
