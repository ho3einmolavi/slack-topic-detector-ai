# 🚀 Quick Start Guide

Get up and running in 5 minutes!

## Step 1: Start Weaviate

### Using Docker Compose (Recommended):
```bash
npm run weaviate:start
# or
docker-compose up -d
```

### Check Status:
```bash
npm run weaviate:status
# or
./weaviate-manager.sh status
```

### Manual Docker Command (Alternative):
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

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Configure Environment

Create `.env` file:

```env
WEAVIATE_URL=http://localhost:8080
OPENAI_API_KEY=sk-your-key-here
TOPIC_SIMILARITY_THRESHOLD=0.75
```

## Step 4: Setup Database

```bash
npm run setup
```

## Step 5: Process Messages

### Test with 10 messages first:
```bash
npm test
```

### Process all messages:
```bash
npm run process
```

## Step 6: View Results

```bash
# List all topics
npm run query

# Search topics
node query-topics.js search "feature request"

# View messages for a topic (use ID from list command)
node query-topics.js messages <topic-id>

# Show statistics
node query-topics.js stats
```

## 🎯 That's it!

Your messages are now categorized into topics using AI! 🎉

## 💡 Tips

- Start with `npm test` to process only 10 messages
- Adjust `TOPIC_SIMILARITY_THRESHOLD` in `.env` to control topic granularity
- Use `--skip-threads` to focus on main messages only
- Add `--delay=1000` to avoid rate limits

## 📊 View Dashboard

Open the interactive dashboard:

```bash
npm run dashboard
# or
open dashboard.html
```

## 🔄 Reset Database

If you need to start fresh and clear all data:

```bash
# Reset database only (deletes all data and schema)
npm run reset

# Reset and recreate schema in one command
npm run reset-all
```

## 🛠️ Manage Weaviate

Use the Weaviate manager script:

```bash
# Check status and stats
./weaviate-manager.sh status
npm run weaviate:status

# Start Weaviate
./weaviate-manager.sh start
npm run weaviate:start

# Stop Weaviate
./weaviate-manager.sh stop
npm run weaviate:stop

# View logs
./weaviate-manager.sh logs
npm run weaviate:logs

# Restart Weaviate
./weaviate-manager.sh restart
```

## 🆘 Troubleshooting

### Weaviate won't start?
```bash
# Check if port 8080 is in use
lsof -i :8080

# Check Docker
docker ps -a | grep weaviate

# View logs
docker logs weaviate
```

### Dashboard shows connection error?
1. Make sure Weaviate is running: `./weaviate-manager.sh status`
2. Wait 10-15 seconds after starting
3. Check http://localhost:8080/v1/meta in your browser

### No data showing?
1. Run setup: `npm run setup`
2. Process messages: `npm run process`
3. Refresh dashboard

## 🆘 Need Help?

Check the main [README.md](./README.md) for detailed documentation.
