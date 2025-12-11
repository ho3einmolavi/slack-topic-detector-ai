import { client } from './weaviate-setup.js';
import fs from 'fs';

// Simple CSV stringifier
function toCSV(data, columns) {
  const header = columns.join(',') + '\n';
  const rows = data.map(row => {
    return columns.map(col => {
      let val = row[col];
      if (val === null || val === undefined) val = '';
      
      // Handle arrays (like keywords)
      if (Array.isArray(val)) {
        val = val.join(';');
      }
      
      // Convert to string and escape
      val = String(val);
      val = val.replace(/"/g, '""'); // Escape double quotes
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val}"`;
      }
      return val;
    }).join(',');
  }).join('\n');
  return header + rows;
}

async function exportSplitData() {
  console.log('Starting split export...');

  try {
    // 1. Fetch all Topics
    console.log('Fetching topics...');
    const topicResult = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields(`
        name
        description
        keywords
        users
        messageCount
        createdAt
        updatedAt
        _additional { id }
      `)
      .withLimit(1000) // Adjust if you have more topics
      .do();

    const topics = topicResult.data?.Get?.Topic || [];
    console.log(`Found ${topics.length} topics.`);

    // Prepare Topics for CSV
    const topicRows = topics.map(t => ({
      topic_id: t._additional?.id,
      name: t.name,
      description: t.description,
      keywords: t.keywords || [],
      users: t.users || [],
      message_count: t.messageCount,
      created_at: t.createdAt,
      updated_at: t.updatedAt
    }));

    const topicColumns = [
      'topic_id',
      'name',
      'description',
      'keywords',
      'users',
      'message_count',
      'created_at',
      'updated_at'
    ];

    const topicsCsv = toCSV(topicRows, topicColumns);
    fs.writeFileSync('topics_export.csv', topicsCsv);
    console.log('✅ exported topics_export.csv');


    // 2. Fetch all Messages
    console.log('Fetching messages...');
    const messageResult = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        timestamp
        text
        user
        userName
        channelId
        channelName
        threadTs
        processedAt
        topic {
          ... on Topic {
            _additional { id }
          }
        }
      `)
      .withLimit(10000)
      .do();

    const messages = messageResult.data?.Get?.SlackMessage || [];
    console.log(`Found ${messages.length} messages.`);

    // Prepare Messages for JSON
    const messageRows = messages.map(msg => ({
      timestamp: msg.timestamp,
      text: msg.text,
      user_id: msg.user,
      user_name: msg.userName,
      channel_id: msg.channelId,
      channel_name: msg.channelName,
      thread_ts: msg.threadTs,
      processed_at: msg.processedAt,
      topic_id: msg.topic?.[0]?._additional?.id || null // Reference topic by ID only
    }));

    fs.writeFileSync('messages_export.json', JSON.stringify(messageRows, null, 2));
    console.log('✅ exported messages_export.json');

  } catch (error) {
    console.error('Export failed:', error);
  }
}

exportSplitData();
