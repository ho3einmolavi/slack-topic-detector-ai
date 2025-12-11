
import { client } from './weaviate-setup.js';
import fs from 'fs';

// Simple CSV stringifier
function toCSV(data, columns) {
  const header = columns.join(',') + '\n';
  const rows = data.map(row => {
    return columns.map(col => {
      let val = row[col] || '';
      // Escape quotes and wrap in quotes if necessary
      if (typeof val === 'string') {
        val = val.replace(/"/g, '""'); // Escape double quotes
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val}"`;
        }
      }
      return val;
    }).join(',');
  }).join('\n');
  return header + rows;
}

async function exportData() {
  console.log('Starting export...');

  try {
    // Fetch all messages with their associated topic
    const limit = 10000; 
    
    const result = await client.graphql
      .get()
      .withClassName('SlackMessage')
      .withFields(`
        timestamp
        text
        user
        userName
        channelName
        threadTs
        processedAt
        topic {
          ... on Topic {
            name
            description
            _additional { id }
          }
        }
      `)
      .withLimit(limit)
      .do();

    const messages = result.data?.Get?.SlackMessage || [];
    console.log(`Found ${messages.length} messages.`);

    if (messages.length === 0) {
      console.log('No messages found to export.');
      return;
    }

    // Flatten the data structure for CSV
    const flattenedData = messages.map(msg => {
      const topic = msg.topic?.[0] || {};
      return {
        message_timestamp: msg.timestamp,
        message_text: msg.text,
        user_id: msg.user,
        user_name: msg.userName,
        channel: msg.channelName,
        thread_ts: msg.threadTs,
        processed_at: msg.processedAt,
        topic_name: topic.name || 'Unassigned',
        topic_description: topic.description || '',
        topic_id: topic._additional?.id || ''
      };
    });

    // Define columns
    const columns = [
      'message_timestamp', 
      'user_name', 
      'topic_name', 
      'message_text', 
      'channel', 
      'thread_ts', 
      'topic_description',
      'topic_id',
      'user_id', 
      'processed_at'
    ];
    
    const csv = toCSV(flattenedData, columns);

    // Write to file
    const filename = 'weaviate_export.csv';
    fs.writeFileSync(filename, csv);
    
    console.log(`Successfully exported data to ${filename}`);

  } catch (error) {
    console.error('Export failed:', error);
  }
}

exportData();
