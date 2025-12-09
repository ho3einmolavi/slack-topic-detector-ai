# Slack Message Topic Categorization with Weaviate

This project automatically categorizes Slack messages into topics using Weaviate vector database and OpenAI embeddings. It simulates a webhook for each message and uses semantic similarity to find related topics or create new ones.

## 🏗️ Architecture

1. **Weaviate Vector Database**: Stores messages and topics with vector embeddings
2. **OpenAI Embeddings**: text-embedding-3-small for vector generation
3. **OpenAI GPT-4**: Generates topic names and descriptions
4. **Semantic Search**: Finds similar topics using cosine similarity
5. **Auto-Topic Creation**: Creates new topics when no match is found

## 📋 Prerequisites

- Node.js 18+ (with ES modules support)
- Weaviate instance (local or cloud)
- OpenAI API key

## 🚀 Setup

### 1. Install Weaviate (Local)

Using Docker:

```bash
docker run -d \
  --name weaviate \
  -p 8080:8080 \
  -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true \
  -e PERSISTENCE_DATA_PATH=/var/lib/weaviate \
  -e ENABLE_MODULES=text2vec-openai \
  -e DEFAULT_VECTORIZER_MODULE=text2vec-openai \
  cr.weaviate.io/semitechnologies/weaviate:latest
```

Or use [Weaviate Cloud](https://console.weaviate.cloud/) for a managed instance.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file:

```env
# Weaviate Configuration
WEAVIATE_URL=http://localhost:8080
WEAVIATE_API_KEY=

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Topic Similarity Threshold (0-1, higher = more strict matching)
TOPIC_SIMILARITY_THRESHOLD=0.75
```

**Important Settings:**

- `TOPIC_SIMILARITY_THRESHOLD`: Controls when a message matches an existing topic
  - `0.75` (default): Moderate strictness - good balance
  - `0.85+`: Strict - creates more specific topics
  - `0.60-0.70`: Loose - groups more messages together

### 4. Setup Database Schema

```bash
npm run setup
```

This creates two classes in Weaviate:
- **Topic**: Stores conversation topics with embeddings
- **SlackMessage**: Stores messages linked to topics

## 🎯 Usage

### Basic Usage

Process all messages from your JSON file:

```bash
npm run process
```

### Advanced Options

```bash
# Process only the first 10 messages (for testing)
node webhook-simulator.js --max=10

# Add delay between messages (in milliseconds)
node webhook-simulator.js --delay=1000

# Skip thread replies, only process main messages
node webhook-simulator.js --skip-threads

# Use a different JSON file
node webhook-simulator.js path/to/other-messages.json

# Combine options
node webhook-simulator.js --max=50 --delay=500 --skip-threads
```

## 📊 How It Works

For each message, the system:

1. **🔍 Searches** for similar topics using vector similarity
2. **📏 Compares** similarity score against threshold
3. **✅ Matches** if similarity >= threshold, or
4. **🆕 Creates** a new topic if no match found
5. **💾 Stores** the message with a reference to its topic
6. **📈 Updates** the topic's message count

### Example Flow

```
Message: "عباس جان. ما دکمه reject all هم نیاز داریم"

1. Search for related topics...
   - "Feature Requests" (similarity: 82%)
   - "UI Components" (similarity: 65%)
   - "Bug Reports" (similarity: 45%)

2. Best match: "Feature Requests" (82% >= 75% threshold)

3. ✅ Message categorized under "Feature Requests"
   - Topic message count: 15 → 16
```

## 🔍 Query Topics

You can query topics programmatically:

```javascript
import { getAllTopics } from './topic-categorizer.js';

const topics = await getAllTopics();
topics.forEach(topic => {
  console.log(`${topic.name}: ${topic.messageCount} messages`);
});
```

## 📁 File Structure

```
.
├── package.json              # Dependencies and scripts
├── .env                      # Configuration (create this)
├── weaviate-setup.js        # Schema setup script
├── topic-categorizer.js     # Core logic for topic matching/creation
├── webhook-simulator.js     # Processes messages from JSON
├── slack-messages.json      # Your Slack export data
└── README.md                # This file
```

## 🎨 Schema Structure

### Topic Class

```javascript
{
  name: string,           // Topic name/title
  description: string,    // What this topic is about
  keywords: string[],     // Related keywords
  messageCount: int,      // Number of messages
  createdAt: date,       // Creation timestamp
  updatedAt: date        // Last update timestamp
}
```

### SlackMessage Class

```javascript
{
  text: string,          // Message content
  user: string,          // User ID
  timestamp: string,     // Message timestamp
  channelId: string,     // Channel ID
  channelName: string,   // Channel name
  threadTs: string,      // Thread timestamp (if any)
  topic: Reference,      // Link to Topic
  processedAt: date      // Processing timestamp
}
```

## 🔧 Customization

### Adjust Similarity Threshold

Edit `.env`:

```env
# More strict (more topics)
TOPIC_SIMILARITY_THRESHOLD=0.85

# More loose (fewer topics)
TOPIC_SIMILARITY_THRESHOLD=0.65
```

### Change Embedding Model

Edit `weaviate-setup.js`:

```javascript
moduleConfig: {
  'text2vec-openai': {
    model: 'text-embedding-3-large', // More powerful but expensive
    // or: 'text-embedding-ada-002' // Older but reliable
  }
}
```

### Change Topic Generation Model

Edit `topic-categorizer.js`:

```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4o',  // More powerful
  // or: 'gpt-3.5-turbo'  // Faster and cheaper
  // ...
});
```

## 🐛 Troubleshooting

### Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:8080
```

**Solution**: Make sure Weaviate is running:

```bash
docker ps | grep weaviate
```

### OpenAI API Error

```
Error: 401 Incorrect API key
```

**Solution**: Check your `.env` file has the correct `OPENAI_API_KEY`.

### Schema Already Exists

The setup script automatically deletes existing classes and recreates them. If you want to keep your data, comment out the deletion logic in `weaviate-setup.js`.

## 📈 Performance Tips

1. **Batch Processing**: The simulator processes messages sequentially. For production, use batch inserts.
2. **Rate Limiting**: Add `--delay=1000` to avoid OpenAI rate limits
3. **Testing**: Use `--max=10` to test with a small subset first
4. **Thread Replies**: Use `--skip-threads` to focus on main messages only

## 🚀 Next Steps

- Add a REST API endpoint for real webhook integration
- Create a dashboard to visualize topics
- Add support for multiple channels
- Implement topic merging for similar topics
- Add user analytics per topic

## 📄 License

MIT

## 🤝 Contributing

Feel free to open issues or submit pull requests!
