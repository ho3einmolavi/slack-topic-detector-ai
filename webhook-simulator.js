import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

// Choose categorizer mode:
// - 'smart' (default): Conversation-aware with context tracking
// - 'agentic': Per-message LLM analysis
// - 'simple': Fast vector similarity only
const CATEGORIZER_MODE = process.env.CATEGORIZER_MODE || 'smart';

// Dynamic import based on mode
let categorizeMessage, getAllTopics;

if (CATEGORIZER_MODE === 'smart') {
  const smartModule = await import('./smart-categorizer.js');
  categorizeMessage = smartModule.categorizeMessage;
  getAllTopics = smartModule.getAllTopics;
  console.log('🧠 Using SMART categorizer (conversation-aware with context)\n');
} else if (CATEGORIZER_MODE === 'agentic') {
  const agenticModule = await import('./agentic-categorizer.js');
  categorizeMessage = agenticModule.categorizeMessage;
  getAllTopics = agenticModule.getAllTopics;
  console.log('🤖 Using AGENTIC categorizer (per-message LLM analysis)\n');
} else {
  const simpleModule = await import('./topic-categorizer.js');
  categorizeMessage = simpleModule.categorizeMessage;
  getAllTopics = simpleModule.getAllTopics;
  console.log('⚡ Using SIMPLE categorizer (vector similarity)\n');
}

/**
 * Simulate webhook delay (optional)
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process all messages from the Slack export (expects flattened JSON)
 */
async function processMessages(jsonPath, options = {}) {
  const {
    delayBetweenMessages = 0, // Delay in ms between processing messages
    maxMessages = null, // Max number of messages to process (null = all)
    onlyParentMessages = false, // Only process parent messages (skip thread replies)
  } = options;

  try {
    console.log('🚀 Starting webhook simulator...\n');
    console.log(`📂 Reading messages from: ${jsonPath}`);
    
    // Read the JSON file
    const data = await fs.readFile(jsonPath, 'utf-8');
    const slackData = JSON.parse(data);
    
    const channelInfo = slackData.channel;
    let messages = slackData.messages || [];
    
    // Messages should already be sorted by timestamp in the flattened JSON
    const isFlattened = slackData.flattened === true;
    console.log(`📊 Found ${messages.length} messages in channel "${channelInfo.name}"`);
    console.log(`📁 Format: ${isFlattened ? 'Flattened (sorted by time)' : 'Original (nested threads)'}`);
    
    // Count parent messages vs thread replies
    const parentCount = messages.filter(msg => !msg.thread_ts || msg.thread_ts === msg.ts).length;
    const replyCount = messages.length - parentCount;
    console.log(`   ├─ Parent messages: ${parentCount}`);
    console.log(`   └─ Thread replies: ${replyCount}`);
    
    // Filter to only parent messages if requested
    if (onlyParentMessages) {
      const originalCount = messages.length;
      messages = messages.filter(msg => !msg.thread_ts || msg.thread_ts === msg.ts);
      console.log(`🔍 Filtered to ${messages.length} parent messages only (skipped ${originalCount - messages.length} thread replies)`);
    }
    
    // Limit messages if requested
    if (maxMessages && maxMessages < messages.length) {
      messages = messages.slice(0, maxMessages);
      console.log(`⚡ Processing first ${maxMessages} messages only`);
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('🎯 Starting message processing...');
    console.log('='.repeat(60));
    
    const results = {
      total: messages.length,
      processed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };
    
    // Process each message
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      try {
        console.log(`\n[${i + 1}/${messages.length}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        const result = await categorizeMessage(message, channelInfo);
        
        if (result) {
          results.processed++;
        } else {
          results.skipped++;
        }
        
        // Add delay if specified
        if (delayBetweenMessages > 0 && i < messages.length - 1) {
          await delay(delayBetweenMessages);
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          messageIndex: i,
          messageTs: message.ts,
          error: error.message,
        });
        console.error(`\n❌ Failed to process message ${i + 1}:`, error.message);
      }
    }
    
    // Print summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Processing Complete!');
    console.log('='.repeat(60));
    console.log(`\n📈 Summary:`);
    console.log(`   Total messages: ${results.total}`);
    console.log(`   ✅ Processed: ${results.processed}`);
    console.log(`   ⏭️  Skipped: ${results.skipped}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    
    if (results.errors.length > 0) {
      console.log(`\n⚠️  Errors:`);
      results.errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. Message ${err.messageIndex + 1} (ts: ${err.messageTs}): ${err.error}`);
      });
    }
    
    // Get and display all topics
    console.log(`\n${'='.repeat(60)}`);
    console.log('📚 Discovered Topics:');
    console.log(`${'='.repeat(60)}\n`);
    
    const topics = await getAllTopics();
    
    if (topics.length === 0) {
      console.log('   No topics created.');
    } else {
      // Sort by message count
      topics.sort((a, b) => b.messageCount - a.messageCount);
      
      topics.forEach((topic, idx) => {
        console.log(`${idx + 1}. 📌 ${topic.name}`);
        console.log(`   Description: ${topic.description}`);
        console.log(`   Messages: ${topic.messageCount}`);
        console.log(`   Keywords: ${topic.keywords?.join(', ') || 'N/A'}`);
        console.log(`   Created: ${new Date(topic.createdAt).toLocaleString()}`);
        console.log();
      });
    }
    
    return results;
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const options = {
    jsonPath: args.find(arg => arg.endsWith('.json')) || './slack-messages.json',
    maxMessages: args.find(arg => arg.startsWith('--max='))?.split('=')[1] 
      ? parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1]) 
      : null,
    delayBetweenMessages: args.find(arg => arg.startsWith('--delay='))?.split('=')[1]
      ? parseInt(args.find(arg => arg.startsWith('--delay='))?.split('=')[1])
      : 0,
    onlyParentMessages: args.includes('--parents-only'),
  };
  
  console.log('⚙️  Configuration:');
  console.log(`   JSON file: ${options.jsonPath}`);
  console.log(`   Max messages: ${options.maxMessages || 'all'}`);
  console.log(`   Delay between messages: ${options.delayBetweenMessages}ms`);
  console.log(`   Only parent messages: ${options.onlyParentMessages}`);
  console.log();
  
  await processMessages(options.jsonPath, options);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => {
      console.log('\n🎉 All done!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}

export { processMessages };
