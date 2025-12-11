import readline from 'readline';
import { toolHandlers } from '../tools/handlers.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from the root .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Chat CLI started. Type your query to search topics. Type "exit" to quit.');

const ask = () => {
  rl.question('> ', async (query) => {
    if (query.toLowerCase() === 'exit') {
      rl.close();
      process.exit(0);
    }

    if (!query.trim()) {
      ask();
      return;
    }

    try {
      console.log('Searching...');
      const result = await toolHandlers.find_topics({ query });
      
      console.log('\n--- Results ---');
      if (result.recommendation) {
        const { action, reason, suggested_topic_name } = result.recommendation;
        console.log(`Recommendation: ${action.toUpperCase()}`);
        console.log(`Reason: ${reason}`);
        if (suggested_topic_name) {
          console.log(`Suggested Topic: ${suggested_topic_name}`);
        }
      }
      
      if (result.matches && result.matches.length > 0) {
        console.log('\nMatches:');
        result.matches.forEach((match, index) => {
          console.log(`\n${index + 1}. ${match.name} (Confidence: ${match.confidence})`);
          console.log(`   Description: ${match.description}`);
          if (match.match_reasons && match.match_reasons.length > 0) {
            console.log(`   Reasons: ${match.match_reasons.join(', ')}`);
          }
        });
      } else {
        console.log('No matches found.');
      }
      console.log('\n---------------');
      
    } catch (error) {
      console.error('Error during search:', error.message);
    }
    
    ask();
  });
};

ask();
