/**
 * Main categorizer module
 * Orchestrates the message categorization process
 */
import { openai } from './services/openai.js';
import { MODEL } from './config/constants.js';
import { SYSTEM_PROMPT } from './prompts/system-prompt.js';
import { tools, executeToolCall, setCurrentContext } from './tools/index.js';
import { conversationContext } from './context/conversation.js';
import { createTopicInDB, storeMessageWithTopic, updateTopic } from './services/database.js';
import { truncate } from './utils/text.js';
import { logToolResult } from './utils/logger.js';

/**
 * Categorize a Slack message into a topic
 * @param {Object} message - Slack message object
 * @param {Object} channelInfo - Channel information
 * @param {Object} options - Options
 * @returns {Promise<Object|null>} Categorization result
 */
export async function categorizeMessage(message, channelInfo, options = {}) {
  const { verbose = true, maxIterations = 5 } = options;
  const startTime = Date.now();

  if (!message.text || message.text.trim().length === 0) {
    if (verbose) console.log('  ⏭️  Skipping empty message');
    return null;
  }

  // Set current context for tool calls
  setCurrentContext(message, channelInfo);

  const isShortMessage = message.text.length < 15;
  const isThreadReply = message.thread_ts && message.thread_ts !== message.ts;

  if (verbose) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🤖 SMART CATEGORIZER (Modular Architecture)`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   📝 Text: "${message.text.substring(0, 80)}${message.text.length > 80 ? '...' : ''}"`);
    console.log(`   📏 Length: ${message.text.length} chars (${isShortMessage ? 'SHORT' : 'SUBSTANTIVE'})`);
    console.log(`   👤 User: ${message.user}`);
    console.log(`   📺 Channel: ${channelInfo.name}`);
    console.log(`   🧵 Thread Reply: ${isThreadReply ? 'YES' : 'NO'}`);
    console.log(`${'─'.repeat(70)}`);
  }
  
  const userMessage = `## NEW MESSAGE TO CATEGORIZE

**Message:** "${message.text}"
**Length:** ${message.text.length} characters
**User:** ${message.user}
**Channel:** ${channelInfo.name}
**Thread Reply:** ${isThreadReply ? 'YES' : 'NO'}
**Message Type:** ${isShortMessage ? 'SHORT (likely confirmation/reaction)' : 'SUBSTANTIVE'}

Follow the workflow:
1. Call get_context first
2. Call find_topics with relevant query
3. Call categorize to make final decision`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  let decision = null;
  let iterations = 0;

  while (!decision && iterations < maxIterations) {
    iterations++;

    if (verbose) {
      console.log(`\n   📍 Iteration ${iterations}/${maxIterations}`);
    }

    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 800,
      });

      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      if (verbose && assistantMessage.content) {
        console.log(`      💭 ${assistantMessage.content.substring(0, 100)}...`);
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments || '{}');

          if (verbose) {
            console.log(`      🔧 ${toolName}${args.query ? `: "${args.query.substring(0, 50)}..."` : ''}`);
          }

          const result = await executeToolCall(toolName, args);

          if (result.action === 'assign' || result.action === 'create') {
            decision = result;
            if (verbose) {
              console.log(`      ✅ Decision: ${result.action === 'assign' ? 'ASSIGN' : 'CREATE'} → ${result.action === 'assign' ? result.topic_name : result.name}`);
              if (result.action === 'assign') {
                const hasImprovements = result.improved_name || result.improved_description;
                console.log(`      📊 Improvements: ${hasImprovements ? 'YES' : 'NO'}${result.improved_name ? ` | New name: "${result.improved_name}"` : ''}${result.improved_description ? ' | +description' : ''}`);
              }
            }
          } else {
            if (verbose) {
              logToolResult(toolName, result);
            }
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result, null, 2),
            });
          }
        }
      } else if (response.choices[0].finish_reason === 'stop' && !decision) {
        messages.push({
          role: 'user',
          content: 'You must make a final decision. Call the categorize tool now with action="assign" or action="create".',
        });
      }
    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
      if (iterations >= maxIterations) throw error;
    }
  }

  // Fallback if no decision made
  if (!decision) {
    if (verbose) console.log(`   ⚠️  Fallback mode activated`);
    
    const channelContext = conversationContext[channelInfo.id];
    
    if (message.text.length < 15 && channelContext?.currentTopicId) {
      decision = {
        action: 'assign',
        topic_id: channelContext.currentTopicId,
        topic_name: channelContext.currentTopicName,
        reasoning: 'Fallback: Short message assigned to recent topic',
      };
    } else {
      decision = {
        action: 'create',
        name: 'General Discussion',
        description: 'General messages and conversations',
        keywords: ['general', 'chat', 'discussion'],
        reasoning: 'Fallback: Could not determine specific topic',
      };
    }
  }

  // Execute decision
  let topicId, topicName;

  if (decision.action === 'assign') {
    topicId = decision.topic_id;
    topicName = decision.topic_name;
    
    // Update topic name/description if improvements were provided
    if (decision.improved_name || decision.improved_description) {
      if (verbose) {
        console.log(`\n      ┌─────────────────────────────────────────────────────────────`);
        console.log(`      │ 🔄 TOPIC IMPROVEMENT DETECTED`);
        console.log(`      ├─────────────────────────────────────────────────────────────`);
        if (decision.improved_name) {
          console.log(`      │ 📛 Name: "${topicName}" → "${decision.improved_name}"`);
        }
        if (decision.improved_description) {
          console.log(`      │ 📝 Description: "${decision.improved_description.substring(0, 60)}${decision.improved_description.length > 60 ? '...' : ''}"`);
        }
        console.log(`      └─────────────────────────────────────────────────────────────`);
      }
      
      const updates = {};
      if (decision.improved_name) {
        updates.name = decision.improved_name;
        topicName = decision.improved_name; // Use improved name
      }
      if (decision.improved_description) {
        updates.description = decision.improved_description;
      }
      
      await updateTopic(topicId, updates);
      
      if (verbose) {
        console.log(`      ✅ Topic updated in DB & vector embeddings regenerated`);
      }
    } else {
      if (verbose) {
        console.log(`      ℹ️  No topic improvements suggested (name/description unchanged)`);
      }
    }
  } else {
    const userName = message.user_name || message.user_real_name || message.user;
    topicId = await createTopicInDB(decision.name, decision.description, decision.keywords, {
      users: userName ? [userName] : [],
      sampleMessages: [truncate(message.text, 100)],
    });
    topicName = decision.name;
    if (verbose) console.log(`      🆕 Created topic: ${topicId}`);
  }

  const messageId = await storeMessageWithTopic(message, channelInfo, topicId, topicName, conversationContext);

  const totalTime = Date.now() - startTime;
  if (verbose) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`   ✨ COMPLETE: ${topicName}`);
    console.log(`   📊 ${iterations} iterations | ${totalTime}ms | ${decision.action.toUpperCase()}`);
    console.log(`   💬 ${decision.reasoning}`);
    console.log(`${'═'.repeat(70)}\n`);
  }

  return {
    messageId,
    topicId,
    topicName,
    decision: decision.action,
    reasoning: decision.reasoning,
    processingTime: totalTime,
    iterations,
  };
}

// Alias for backwards compatibility
export const categorizeMessageSmart = categorizeMessage;
