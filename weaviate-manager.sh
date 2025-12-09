#!/bin/bash

# Weaviate Manager Script
# Easy commands to manage your Weaviate instance

set -e

WEAVIATE_URL="http://localhost:8080"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}🗄️  Weaviate Manager${NC}"
    echo -e "${BLUE}================================${NC}\n"
}

check_status() {
    echo -e "${BLUE}📊 Checking Weaviate status...${NC}"
    
    if docker ps | grep -q weaviate; then
        echo -e "${GREEN}✅ Weaviate container is running${NC}"
        
        # Check if accessible
        if curl -s "$WEAVIATE_URL/v1/meta" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Weaviate is accessible at $WEAVIATE_URL${NC}"
            
            # Get version
            VERSION=$(curl -s "$WEAVIATE_URL/v1/meta" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
            echo -e "${GREEN}   Version: $VERSION${NC}"
            
            # Get stats if available
            echo -e "\n${BLUE}📈 Database Stats:${NC}"
            STATS=$(curl -s -X POST "$WEAVIATE_URL/v1/graphql" \
                -H "Content-Type: application/json" \
                -d '{"query":"{ Aggregate { Topic { meta { count } } SlackMessage { meta { count } } } }"}' 2>/dev/null)
            
            if echo "$STATS" | grep -q "Topic"; then
                TOPICS=$(echo "$STATS" | grep -o '"count":[0-9]*' | head -1 | grep -o '[0-9]*')
                MESSAGES=$(echo "$STATS" | grep -o '"count":[0-9]*' | tail -1 | grep -o '[0-9]*')
                echo -e "${GREEN}   Topics: ${TOPICS:-0}${NC}"
                echo -e "${GREEN}   Messages: ${MESSAGES:-0}${NC}"
            else
                echo -e "${YELLOW}   No data yet (run 'npm run setup' and 'npm run process')${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  Container is running but not responding${NC}"
            echo -e "${YELLOW}   Wait a few seconds and try again${NC}"
        fi
    else
        echo -e "${RED}❌ Weaviate container is not running${NC}"
        echo -e "${YELLOW}   Run: $0 start${NC}"
    fi
}

start_weaviate() {
    echo -e "${BLUE}🚀 Starting Weaviate...${NC}"
    
    if docker ps | grep -q weaviate; then
        echo -e "${YELLOW}⚠️  Weaviate is already running${NC}"
        return
    fi
    
    docker-compose up -d
    
    echo -e "\n${YELLOW}⏳ Waiting for Weaviate to be ready...${NC}"
    for i in {1..30}; do
        if curl -s "$WEAVIATE_URL/v1/meta" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Weaviate is ready!${NC}"
            return
        fi
        echo -n "."
        sleep 1
    done
    
    echo -e "\n${RED}❌ Weaviate failed to start${NC}"
    echo -e "${YELLOW}Check logs: docker logs weaviate${NC}"
}

stop_weaviate() {
    echo -e "${BLUE}🛑 Stopping Weaviate...${NC}"
    docker-compose down
    echo -e "${GREEN}✅ Weaviate stopped${NC}"
}

restart_weaviate() {
    echo -e "${BLUE}🔄 Restarting Weaviate...${NC}"
    stop_weaviate
    sleep 2
    start_weaviate
}

view_logs() {
    echo -e "${BLUE}📋 Viewing Weaviate logs (Ctrl+C to exit)...${NC}\n"
    docker logs -f weaviate
}

show_help() {
    print_header
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  status    - Check Weaviate status and stats"
    echo "  start     - Start Weaviate"
    echo "  stop      - Stop Weaviate"
    echo "  restart   - Restart Weaviate"
    echo "  logs      - View Weaviate logs"
    echo "  help      - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 status"
    echo "  $0 logs"
    echo ""
}

# Main
case "${1:-help}" in
    status)
        print_header
        check_status
        ;;
    start)
        print_header
        start_weaviate
        ;;
    stop)
        print_header
        stop_weaviate
        ;;
    restart)
        print_header
        restart_weaviate
        ;;
    logs)
        print_header
        view_logs
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}\n"
        show_help
        exit 1
        ;;
esac
