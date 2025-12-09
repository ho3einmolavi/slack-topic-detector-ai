import weaviate from 'weaviate-ts-client';
import dotenv from 'dotenv';

dotenv.config();

const client = weaviate.client({
  scheme: process.env.WEAVIATE_URL?.startsWith('https') ? 'https' : 'http',
  host: process.env.WEAVIATE_URL?.replace(/^https?:\/\//, '') || 'localhost:8080',
  apiKey: process.env.WEAVIATE_API_KEY ? 
    new weaviate.ApiKey(process.env.WEAVIATE_API_KEY) : undefined,
  headers: {
    'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY,
  },
});

/**
 * Delete all existing data and schema
 */
async function resetDatabase() {
  console.log('🗑️  Resetting Weaviate database...\n');

  try {
    const schema = await client.schema.getter().do();
    const existingClasses = schema.classes.map(c => c.class);

    // Delete existing classes if they exist
    if (existingClasses.includes('Topic')) {
      console.log('   Deleting Topic class and all its data...');
      await client.schema.classDeleter().withClassName('Topic').do();
    }
    if (existingClasses.includes('SlackMessage')) {
      console.log('   Deleting SlackMessage class and all its data...');
      await client.schema.classDeleter().withClassName('SlackMessage').do();
    }

    console.log('✅ Database reset complete!\n');
    return true;
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  }
}

async function setupSchema() {
  console.log('🚀 Setting up Weaviate schema...\n');

  try {
    // Check if classes already exist
    const schema = await client.schema.getter().do();
    const existingClasses = schema.classes.map(c => c.class);

    // Delete existing classes if they exist (for clean setup)
    if (existingClasses.includes('Topic')) {
      console.log('🗑️  Deleting existing Topic class...');
      await client.schema.classDeleter().withClassName('Topic').do();
    }
    if (existingClasses.includes('SlackMessage')) {
      console.log('🗑️  Deleting existing SlackMessage class...');
      await client.schema.classDeleter().withClassName('SlackMessage').do();
    }

    // Create Topic class
    const topicClass = {
      class: 'Topic',
      description: 'A conversation topic derived from Slack messages',
      vectorizer: 'text2vec-openai',
      moduleConfig: {
        'text2vec-openai': {
          model: 'text-embedding-3-small',
          modelVersion: '002',
          type: 'text',
        },
      },
      properties: [
        {
          name: 'name',
          dataType: ['text'],
          description: 'The topic name/title',
          moduleConfig: {
            'text2vec-openai': {
              skip: false,
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'description',
          dataType: ['text'],
          description: 'A description of what this topic is about',
          moduleConfig: {
            'text2vec-openai': {
              skip: false,
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'keywords',
          dataType: ['text[]'],
          description: 'Keywords associated with this topic',
          moduleConfig: {
            'text2vec-openai': {
              skip: true, // Don't vectorize keywords separately
            },
          },
        },
        {
          name: 'users',
          dataType: ['text[]'],
          description: 'List of user names associated with this topic',
          moduleConfig: {
            'text2vec-openai': {
              skip: true, // Don't vectorize users
            },
          },
        },
        {
          name: 'combinedSearchText',
          dataType: ['text'],
          description: 'Combined text of name, description, and keywords for enhanced semantic search',
          moduleConfig: {
            'text2vec-openai': {
              skip: false,
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'messageCount',
          dataType: ['int'],
          description: 'Number of messages categorized under this topic',
        },
        {
          name: 'createdAt',
          dataType: ['date'],
          description: 'When this topic was first created',
        },
        {
          name: 'updatedAt',
          dataType: ['date'],
          description: 'When this topic was last updated',
        },
      ],
    };

    console.log('✅ Creating Topic class...');
    await client.schema.classCreator().withClass(topicClass).do();

    // Create SlackMessage class
    const messageClass = {
      class: 'SlackMessage',
      description: 'A Slack message with its metadata',
      vectorizer: 'text2vec-openai',
      moduleConfig: {
        'text2vec-openai': {
          model: 'text-embedding-3-small',
          modelVersion: '002',
          type: 'text',
        },
      },
      properties: [
        {
          name: 'text',
          dataType: ['text'],
          description: 'The message text content',
          moduleConfig: {
            'text2vec-openai': {
              skip: false,
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'user',
          dataType: ['text'],
          description: 'User ID who sent the message',
        },
        {
          name: 'timestamp',
          dataType: ['text'],
          description: 'Message timestamp',
        },
        {
          name: 'channelId',
          dataType: ['text'],
          description: 'Channel ID where message was sent',
        },
        {
          name: 'channelName',
          dataType: ['text'],
          description: 'Channel name',
        },
        {
          name: 'threadTs',
          dataType: ['text'],
          description: 'Thread timestamp if part of a thread',
        },
        {
          name: 'topic',
          dataType: ['Topic'],
          description: 'The topic this message belongs to',
        },
        {
          name: 'processedAt',
          dataType: ['date'],
          description: 'When this message was processed',
        },
      ],
    };

    console.log('✅ Creating SlackMessage class...');
    await client.schema.classCreator().withClass(messageClass).do();

    console.log('\n✨ Schema setup completed successfully!\n');
    console.log('Created classes:');
    console.log('  - Topic: Stores conversation topics');
    console.log('  - SlackMessage: Stores individual messages with topic references\n');

    return true;
  } catch (error) {
    console.error('❌ Error setting up schema:', error);
    throw error;
  }
}

// Run setup if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'reset') {
    // Reset database only
    resetDatabase()
      .then(() => {
        console.log('💡 Database has been reset. Run "npm run setup" to recreate the schema.');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Failed to reset database:', error);
        process.exit(1);
      });
  } else if (command === 'reset-and-setup') {
    // Reset and setup in one command
    resetDatabase()
      .then(() => setupSchema())
      .then(() => {
        console.log('🎉 Database reset and setup complete! You can now run the webhook simulator.');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Failed to reset and setup:', error);
        process.exit(1);
      });
  } else {
    // Default: just setup
    setupSchema()
      .then(() => {
        console.log('🎉 Setup complete! You can now run the webhook simulator.');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Failed to setup schema:', error);
        process.exit(1);
      });
  }
}

export { client, setupSchema, resetDatabase };
