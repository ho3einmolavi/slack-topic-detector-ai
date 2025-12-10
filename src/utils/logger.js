/**
 * Logging utilities for the categorizer
 */
import { truncate } from './text.js';

/**
 * Log tool results in a readable format
 * @param {string} toolName - Tool name
 * @param {Object} result - Tool result
 */
export function logToolResult(toolName, result) {
  switch (toolName) {
    case 'get_context':
      if (result.thread_parent) {
        console.log(`         🧵 Thread parent: "${truncate(result.thread_parent.text, 50)}"`);
        if (result.thread_parent.topic) {
          console.log(`            └─ Topic: ${result.thread_parent.topic.name}`);
        }
      }
      if (result.recent_messages?.length > 0) {
        console.log(`         📨 Recent messages (${result.recent_messages.length}):`);
        result.recent_messages.slice(0, 3).forEach((m, i) => {
          const topicInfo = m.topic_name ? ` → [${m.topic_name}]` : '';
          console.log(`            ${i + 1}. "${truncate(m.text, 40)}"${topicInfo}`);
        });
      } else {
        console.log(`         📨 No recent messages found`);
      }
      if (result.channel?.current_topic) {
        console.log(`         📺 Channel topic: ${result.channel.current_topic.name}`);
      }
      if (result.hint) {
        console.log(`         💡 ${result.hint}`);
      }
      break;

    case 'find_topics':
      if (result.matches?.length > 0) {
        console.log(`         🔍 Found ${result.matches.length} matching topics:`);
        result.matches.slice(0, 3).forEach((m, i) => {
          const conf = (m.confidence * 100).toFixed(0);
          const reasons = m.match_reasons?.slice(0, 2).join(', ') || '';
          console.log(`            ${i + 1}. ${m.name} (${conf}%) ${reasons ? `[${reasons}]` : ''}`);
        });
      } else {
        console.log(`         🔍 No matching topics found`);
      }
      if (result.recommendation) {
        const conf = (result.recommendation.confidence * 100).toFixed(0);
        console.log(`         📊 Recommendation: ${result.recommendation.action.toUpperCase()} (${conf}%)`);
        if (result.recommendation.reason) {
          console.log(`            └─ ${result.recommendation.reason}`);
        }
      }
      break;

    default:
      if (result.error) {
        console.log(`         ❌ Error: ${result.error}`);
      }
  }
}
