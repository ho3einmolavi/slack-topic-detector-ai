import { promises as fs } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SLACK_API_KEY = process.env.SLACK_API_KEY;
const SLACK_API_BASE = 'https://slack.com/api';
const CHANNEL_ID = 'C0594LCK43H'; // From URL: https://app.slack.com/client/T46P0EFR8/C0594LCK43H

// Calculate timestamp for 2 months ago (approximately 60 days)
const twoMonthsAgo = Math.floor((Date.now() - (60 * 24 * 60 * 60 * 1000)) / 1000);

// User cache to avoid repeated API calls
const userCache = new Map();

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

async function getChannelInfo(channelId) {
  console.log('📋 Fetching channel info...');
  try {
    const response = await slackApiCall('conversations.info', { channel: channelId });
    return response.channel;
  } catch (error) {
    console.log(`⚠️  Could not fetch channel info: ${error.message}`);
    return { id: channelId, name: channelId };
  }
}

/**
 * Fetch user info from Slack API (with caching)
 */
async function getUserInfo(userId) {
  // Return from cache if available
  if (userCache.has(userId)) {
    return userCache.get(userId);
  }

  try {
    const response = await slackApiCall('users.info', { user: userId });
    const user = response.user;
    
    const userInfo = {
      id: user.id,
      name: user.name,
      real_name: user.real_name || user.name,
      display_name: user.profile?.display_name || user.real_name || user.name,
      is_bot: user.is_bot || false,
    };
    
    // Cache the user info
    userCache.set(userId, userInfo);
    return userInfo;
  } catch (error) {
    // Return a fallback if user lookup fails
    const fallback = {
      id: userId,
      name: userId,
      real_name: userId,
      display_name: userId,
      is_bot: false,
    };
    userCache.set(userId, fallback);
    return fallback;
  }
}

/**
 * Enrich a single message with user data
 */
async function enrichMessageWithUser(message) {
  if (message.user) {
    const userInfo = await getUserInfo(message.user);
    message.user_name = userInfo.display_name || userInfo.real_name;
    message.user_real_name = userInfo.real_name;
    message.user_is_bot = userInfo.is_bot;
  } else if (message.bot_id) {
    message.user_name = message.username || 'Bot';
    message.user_real_name = message.username || 'Bot';
    message.user_is_bot = true;
  }
  return message;
}

/**
 * Enrich all messages with user data
 */
async function enrichMessagesWithUsers(messages) {
  console.log(`\n👤 Enriching messages with user data...`);
  
  // Collect all unique user IDs
  const userIds = new Set();
  for (const message of messages) {
    if (message.user) userIds.add(message.user);
  }
  
  console.log(`  📊 Found ${userIds.size} unique users`);
  
  // Pre-fetch all user info (with progress)
  let fetched = 0;
  for (const userId of userIds) {
    await getUserInfo(userId);
    fetched++;
    if (fetched % 10 === 0 || fetched === userIds.size) {
      process.stdout.write(`\r  👤 Fetching user info: ${fetched}/${userIds.size}`);
    }
  }
  console.log(''); // New line after progress
  
  // Enrich all messages
  for (const message of messages) {
    await enrichMessageWithUser(message);
  }
  
  console.log(`✅ Enriched ${messages.length} messages with user data\n`);
  return messages;
}

async function getMessagesFromConversation(conversationId, conversationName) {
  console.log(`  📨 Fetching messages from ${conversationName || conversationId}...`);
  const messages = [];
  let cursor = null;

  do {
    const params = {
      channel: conversationId,
      oldest: twoMonthsAgo.toString(),
      limit: 200
    };
    if (cursor) params.cursor = cursor;

    try {
      const response = await slackApiCall('conversations.history', params);
      messages.push(...response.messages);
      cursor = response.response_metadata?.next_cursor || null;
    } catch (error) {
      // Some conversations might not be accessible, skip them
      console.log(`    ⚠️  Could not fetch messages: ${error.message}`);
      break;
    }
  } while (cursor);

  return messages;
}

async function main() {
  try {
    console.log('🚀 Starting Slack message fetch...\n');
    console.log(`📌 Channel ID: ${CHANNEL_ID}\n`);
    
    // Get channel info
    const channel = await getChannelInfo(CHANNEL_ID);
    console.log(`✅ Channel: ${channel.name || channel.id}\n`);
    
    // Fetch messages from the channel
    const messages = await getMessagesFromConversation(CHANNEL_ID, channel.name);

    // Enrich messages with user data (names)
    await enrichMessagesWithUsers(messages);

    // Build users lookup object from cache
    const users = {};
    for (const [userId, userInfo] of userCache) {
      users[userId] = userInfo;
    }

    const result = {
      fetched_at: new Date().toISOString(),
      period: {
        from: new Date(twoMonthsAgo * 1000).toISOString(),
        to: new Date().toISOString()
      },
      channel: {
        id: channel.id,
        name: channel.name || channel.id,
        type: channel.is_im ? 'im' : channel.is_mpim ? 'mpim' : channel.is_private ? 'private_channel' : 'public_channel'
      },
      total_messages: messages.length,
      total_users: Object.keys(users).length,
      users: users,
      messages: messages.reverse()
    };

    // Save to JSON file
    const outputFile = 'slack-messages.json';
    await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
    
    console.log(`\n✅ Done!`);
    console.log(`📊 Total messages: ${result.total_messages}`);
    console.log(`👤 Total users: ${result.total_users}`);
    console.log(`💾 Saved to: ${outputFile}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

