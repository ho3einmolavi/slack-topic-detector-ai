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
  console.log('🚀 Setting up Weaviate schema (OPTIMIZED)...\n');

  try {
    const schema = await client.schema.getter().do();
    const existingClasses = schema.classes.map(c => c.class);

    if (existingClasses.includes('Topic')) {
      console.log('🗑️  Deleting existing Topic class...');
      await client.schema.classDeleter().withClassName('Topic').do();
    }
    if (existingClasses.includes('SlackMessage')) {
      console.log('🗑️  Deleting existing SlackMessage class...');
      await client.schema.classDeleter().withClassName('SlackMessage').do();
    }

    // =========================================================================
    // TOPIC CLASS - Optimized for single-field vectorization
    // =========================================================================
    const topicClass = {
      class: 'Topic',
      description: 'A conversation topic derived from Slack messages',
      vectorizer: 'text2vec-openai',
      moduleConfig: {
        'text2vec-openai': {
          model: 'text-embedding-3-small',
          type: 'text',
          // Removed modelVersion - not needed for embedding-3 models
        },
      },
      // Configure inverted index for BM25
      invertedIndexConfig: {
        bm25: {
          b: 0.75,   // Document length normalization (default)
          k1: 1.2,   // Term frequency saturation (default)
        },
        indexTimestamps: true,
        indexNullState: true,
        indexPropertyLength: true,
      },
      properties: [
        // =====================================================================
        // STORED FIELDS (not vectorized - used for display/filtering)
        // =====================================================================
        {
          name: 'name',
          dataType: ['text'],
          description: 'The topic name/title',
          indexFilterable: true,
          indexSearchable: true,  // Enable BM25 search on name
          moduleConfig: {
            'text2vec-openai': {
              skip: true,  // ✅ DON'T vectorize - included in combinedSearchText
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'description',
          dataType: ['text'],
          description: 'A description of what this topic is about',
          indexFilterable: false,
          indexSearchable: true,  // Enable BM25 search on description
          moduleConfig: {
            'text2vec-openai': {
              skip: true,  // ✅ DON'T vectorize - included in combinedSearchText
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'keywords',
          dataType: ['text[]'],
          description: 'Keywords associated with this topic',
          indexFilterable: true,
          indexSearchable: true,  // Enable BM25 search on keywords
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'users',
          dataType: ['text[]'],
          description: 'List of user names associated with this topic',
          indexFilterable: true,
          indexSearchable: false,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'sampleMessages',
          dataType: ['text[]'],
          description: 'Sample messages from this topic for context',
          indexFilterable: false,
          indexSearchable: true,  // Enable BM25 on sample messages
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        // =====================================================================
        // VECTORIZED FIELD (single source of truth for embeddings)
        // =====================================================================
        {
          name: 'combinedSearchText',
          dataType: ['text'],
          description: 'SINGLE vectorized field: TOPIC + DESCRIPTION + KEYWORDS + EXAMPLES',
          indexFilterable: false,
          indexSearchable: true,  // Also enable BM25 on this
          moduleConfig: {
            'text2vec-openai': {
              skip: false,  // ✅ ONLY this field gets vectorized
              vectorizePropertyName: false,
            },
          },
        },
        // =====================================================================
        // METADATA FIELDS (not vectorized, not searchable)
        // =====================================================================
        {
          name: 'messageCount',
          dataType: ['int'],
          description: 'Number of messages categorized under this topic',
          indexFilterable: true,
          indexSearchable: false,
        },
        {
          name: 'createdAt',
          dataType: ['date'],
          description: 'When this topic was first created',
          indexFilterable: true,
          indexSearchable: false,
        },
        {
          name: 'updatedAt',
          dataType: ['date'],
          description: 'When this topic was last updated',
          indexFilterable: true,
          indexSearchable: false,
        },
      ],
    };

    console.log('✅ Creating Topic class (single-field vectorization)...');
    await client.schema.classCreator().withClass(topicClass).do();

    // =========================================================================
    // SLACK MESSAGE CLASS
    // =========================================================================
    const messageClass = {
      class: 'SlackMessage',
      description: 'A Slack message with its metadata',
      vectorizer: 'text2vec-openai',
      moduleConfig: {
        'text2vec-openai': {
          model: 'text-embedding-3-small',
          type: 'text',
        },
      },
      invertedIndexConfig: {
        bm25: {
          b: 0.75,
          k1: 1.2,
        },
        indexTimestamps: true,
      },
      properties: [
        {
          name: 'text',
          dataType: ['text'],
          description: 'The message text content',
          indexFilterable: false,
          indexSearchable: true,
          moduleConfig: {
            'text2vec-openai': {
              skip: false,  // ✅ Vectorize message text
              vectorizePropertyName: false,
            },
          },
        },
        {
          name: 'user',
          dataType: ['text'],
          description: 'User ID who sent the message',
          indexFilterable: true,
          indexSearchable: false,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'userName',
          dataType: ['text'],
          description: 'User display name',
          indexFilterable: true,
          indexSearchable: true,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'timestamp',
          dataType: ['text'],
          description: 'Message timestamp (Slack ts format)',
          indexFilterable: true,
          indexSearchable: false,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'channelId',
          dataType: ['text'],
          description: 'Channel ID where message was sent',
          indexFilterable: true,
          indexSearchable: false,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'channelName',
          dataType: ['text'],
          description: 'Channel name',
          indexFilterable: true,
          indexSearchable: true,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
        },
        {
          name: 'threadTs',
          dataType: ['text'],
          description: 'Thread timestamp if part of a thread',
          indexFilterable: true,
          indexSearchable: false,
          moduleConfig: {
            'text2vec-openai': {
              skip: true,
            },
          },
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
          indexFilterable: true,
          indexSearchable: false,
        },
      ],
    };

    console.log('✅ Creating SlackMessage class...');
    await client.schema.classCreator().withClass(messageClass).do();

    console.log('\n✨ Schema setup completed successfully!\n');
    console.log('Vectorization strategy:');
    console.log('  - Topic: ONLY "combinedSearchText" is vectorized');
    console.log('  - SlackMessage: ONLY "text" is vectorized');
    console.log('\nBM25 searchable fields:');
    console.log('  - Topic: name, description, keywords, sampleMessages, combinedSearchText');
    console.log('  - SlackMessage: text, userName, channelName\n');

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
    resetDatabase()
      .then(() => setupSchema())
      .then(() => {
        console.log('🎉 Database reset and setup complete!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Failed to reset and setup:', error);
        process.exit(1);
      });
  } else {
    setupSchema()
      .then(() => {
        console.log('🎉 Setup complete!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Failed to setup schema:', error);
        process.exit(1);
      });
  }
}

export { client, setupSchema, resetDatabase };
