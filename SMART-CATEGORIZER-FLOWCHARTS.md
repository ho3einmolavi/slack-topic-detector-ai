# 📊 Smart Categorizer - Visual Flowcharts

> Mermaid diagrams for the Smart Categorizer Agent. View in GitHub, GitLab, or any Mermaid-compatible viewer.

---

## 1. High-Level Architecture

```mermaid
flowchart TB
    subgraph Input["📥 INPUT"]
        MSG[/"Slack Message"/]
        CH[/"Channel Info"/]
    end

    subgraph Processing["⚙️ AGENT PROCESSING"]
        INIT["Initialize Agent"]
        TOOLS["Tool Execution"]
        LLM["LLM Decision"]
    end

    subgraph Decision["📋 DECISION"]
        ASSIGN["✅ Assign to<br/>Existing Topic"]
        CREATE["🆕 Create<br/>New Topic"]
    end

    subgraph Storage["💾 STORAGE"]
        WV[(Weaviate DB)]
        MEM["In-Memory<br/>Context"]
    end

    subgraph Output["📤 OUTPUT"]
        RES[/"Result Object"/]
    end

    MSG --> INIT
    CH --> INIT
    
    INIT --> TOOLS
    TOOLS --> LLM
    LLM -->|Need More Info| TOOLS
    LLM -->|Decision Made| Decision
    
    ASSIGN --> WV
    CREATE --> WV
    WV --> MEM
    MEM --> RES

    style INIT fill:#FFB6C1
    style LLM fill:#87CEEB
    style WV fill:#90EE90
```

---

## 2. Main Categorization Flow

```mermaid
flowchart TD
    START((Start)) --> VALIDATE{Message<br/>Empty?}
    VALIDATE -->|Yes| SKIP[Return null]
    VALIDATE -->|No| INIT[Initialize Agent]
    
    INIT --> AGENT_LOOP{Iteration<br/>< Max?}
    AGENT_LOOP -->|Yes| AGENT_LLM[Call LLM<br/>with Tools]
    AGENT_LLM --> TOOL_CHECK{Tool<br/>Calls?}
    TOOL_CHECK -->|Yes| EXEC_TOOLS[Execute<br/>Tools]
    EXEC_TOOLS --> DECISION_CHECK{Decision<br/>Tool?}
    DECISION_CHECK -->|No| AGENT_LOOP
    DECISION_CHECK -->|Yes| DECISION
    TOOL_CHECK -->|No| FORCE_DECIDE[Prompt for<br/>Decision]
    FORCE_DECIDE --> AGENT_LOOP
    AGENT_LOOP -->|No - Max Reached| FALLBACK[Use Fallback<br/>Logic]
    
    FALLBACK --> DECISION{Action<br/>Type?}
    
    DECISION -->|assign| ASSIGN_TOPIC[Use Existing<br/>Topic ID]
    DECISION -->|create| CREATE_TOPIC[Create Topic<br/>in DB]
    
    ASSIGN_TOPIC --> STORE_MSG[Store Message<br/>+ Link to Topic]
    CREATE_TOPIC --> STORE_MSG
    
    STORE_MSG --> UPDATE_CTX[Update Channel<br/>Context]
    UPDATE_CTX --> RESULT[Return Result]
    RESULT --> END((End))

    style START fill:#90EE90
    style END fill:#90EE90
    style AGENT_LLM fill:#87CEEB
    style DECISION fill:#FFD700
```

---

## 3. Agent Tool-Calling Loop

```mermaid
sequenceDiagram
    autonumber
    participant User as User Message
    participant Agent as LLM Agent
    participant Tools as Tool Handlers
    participant DB as Weaviate DB

    User->>Agent: "Categorize: 'حله'"
    
    Note over Agent: Iteration 1
    Agent->>Agent: Think: "Short message,<br/>need context"
    Agent->>Tools: get_conversation_context(5)
    Tools->>DB: Fetch recent messages
    DB-->>Tools: Messages + topics
    Tools-->>Agent: {messages: [...]}
    
    Note over Agent: Iteration 2
    Agent->>Agent: Think: "Recent msg about<br/>database migration"
    Agent->>Tools: get_all_topics()
    Tools->>DB: Query all topics
    DB-->>Tools: Topic list
    Tools-->>Agent: {topics: [...]}
    
    Note over Agent: Iteration 3 (Final)
    Agent->>Agent: Think: "Confirmation to<br/>db discussion"
    Agent->>Tools: assign_to_topic(<br/>id="abc-123",<br/>name="Database Migration")
    
    Note over Tools: DECISION MADE
    Tools-->>Agent: {action: "assign", ...}
    
    Agent->>DB: Store message + link
    Agent-->>User: Result object
```

---

## 4. Topic Duplicate Detection

```mermaid
flowchart TD
    subgraph Input["📥 Proposed Topic"]
        NAME["name: 'DB Performance'"]
        DESC["desc: 'Database perf issues'"]
        KW["keywords: ['db', 'slow']"]
    end

    subgraph Normalize["🔄 Normalization"]
        N1["DB → database"]
        N2["lowercase"]
        N3["remove special chars"]
    end

    subgraph Compare["📊 Compare with Each Existing Topic"]
        EX["Existing: 'Database Performance'"]
        
        subgraph Scores["Score Calculation"]
            S1["Name Similarity<br/>Levenshtein: 0.85"]
            S2["Desc Similarity<br/>Levenshtein: 0.70"]
            S3["Keyword Overlap<br/>Fuzzy Set: 0.60"]
        end
        
        COMBINED["Combined Score<br/>(0.85×0.5) + (0.70×0.2) + (0.60×0.3)<br/>= 0.745 (74.5%)"]
    end

    subgraph Decision["📋 Recommendation"]
        D1{Score >= 0.70?}
        USE["✅ USE EXISTING<br/>'Database Performance'"]
        D2{Score >= 0.50?}
        MERGE["⚠️ CONSIDER MERGE"]
        CREATE["🆕 SAFE TO CREATE"]
    end

    NAME --> N1
    DESC --> N2
    KW --> N3
    
    N1 --> EX
    N2 --> EX
    N3 --> EX
    
    EX --> S1
    EX --> S2
    EX --> S3
    
    S1 --> COMBINED
    S2 --> COMBINED
    S3 --> COMBINED
    
    COMBINED --> D1
    D1 -->|Yes| USE
    D1 -->|No| D2
    D2 -->|Yes| MERGE
    D2 -->|No| CREATE

    style USE fill:#90EE90
    style MERGE fill:#FFD700
    style CREATE fill:#87CEEB
```

---

## 5. Database Entity Relationship

```mermaid
erDiagram
    Topic ||--o{ SlackMessage : "has many"
    
    Topic {
        uuid id PK
        string name "Database Migration"
        string description "Messages about db migration"
        array keywords "['postgres', 'sql']"
        array users "['Hossein', 'Ali']"
        string combinedSearchText "for embedding"
        int messageCount 42
        datetime createdAt
        datetime updatedAt
    }
    
    SlackMessage {
        uuid id PK
        string text "let's migrate to postgres"
        string user "U123ABC"
        string userName "Hossein Molavi"
        string timestamp "1234567890.001"
        string channelId "C123ABC"
        string channelName "dev-team"
        string threadTs "nullable"
        datetime processedAt
        uuid topicId FK
    }
```

---

## 6. Tool Categories and Usage

```mermaid
mindmap
  root((Agent Tools))
    Context Tools
      get_conversation_context
        Fetch N messages before
        For short messages
      get_thread_parent
        Thread reply detection
        Inherit parent topic
      get_current_channel_topic
        Recent topic in channel
        Conversation continuity
    Smart Matching
      find_best_topic_match
        Semantic + fuzzy + keywords
        Use FIRST for substantive
      validate_new_topic
        Duplicate detection
        REQUIRED before create
    Topic Tools
      get_all_topics
        List all topics
        Before creating new
      search_existing_topics
        Hybrid search
        Find by keywords
      get_topic_messages
        Sample messages
        Understand topic content
    Search Tools
      hybrid_search
        Keyword + semantic
        Best general search
      semantic_search
        By meaning
        Concept matching
      keyword_search
        Exact BM25 match
        Names and terms
    Decision Tools
      assign_to_topic
        Link to existing
        Final decision
      create_new_topic
        New topic
        After validation
```

---

## 7. Message Type Decision Tree

```mermaid
flowchart TD
    MSG((Message)) --> TYPE{Message<br/>Type?}
    
    TYPE -->|Thread Reply| TR[Get Thread Parent]
    TR --> TR_TOPIC{Parent has<br/>Topic?}
    TR_TOPIC -->|Yes| TR_ASSIGN["✅ ASSIGN<br/>Same as Parent"]
    TR_TOPIC -->|No| TR_CATEGORIZE[Categorize Parent First]
    
    TYPE -->|Short < 15 chars| SHORT[Get Recent Context]
    SHORT --> SHORT_CTX{Has Recent<br/>Message?}
    SHORT_CTX -->|Yes| SHORT_ASSIGN["✅ ASSIGN<br/>Same as Recent"]
    SHORT_CTX -->|No| SHORT_SEARCH[Search Topics]
    
    TYPE -->|Substantive| SUB[Find Best Match]
    SUB --> SUB_CONF{Confidence<br/>>= 75%?}
    SUB_CONF -->|Yes| SUB_ASSIGN["✅ ASSIGN<br/>to Match"]
    SUB_CONF -->|No| SUB_VAL{Confidence<br/>>= 50%?}
    SUB_VAL -->|Yes| SUB_REVIEW[Review Match]
    SUB_VAL -->|No| SUB_NEW[Validate New Topic]
    
    SUB_NEW --> NEW_CHECK{Is Duplicate?}
    NEW_CHECK -->|Yes| NEW_USE["✅ ASSIGN<br/>to Existing"]
    NEW_CHECK -->|No| NEW_CREATE["🆕 CREATE<br/>New Topic"]

    style TR_ASSIGN fill:#90EE90
    style SHORT_ASSIGN fill:#90EE90
    style SUB_ASSIGN fill:#90EE90
    style NEW_USE fill:#90EE90
    style NEW_CREATE fill:#87CEEB
```

---

## 8. System Component Interaction

```mermaid
flowchart TB
    subgraph External["🌐 External Services"]
        SLACK["Slack API"]
        OPENAI["OpenAI API"]
    end

    subgraph Application["📱 Smart Categorizer"]
        subgraph Entry["Entry Point"]
            MAIN["categorizeMessage()"]
        end
        
        subgraph Core["Core Components"]
            LOOP["Agent Loop"]
            EXEC["Tool Executor"]
        end
        
        subgraph Handlers["Tool Handlers"]
            CTX_TOOLS["Context Tools"]
            MATCH_TOOLS["Matching Tools"]
            SEARCH_TOOLS["Search Tools"]
            DECISION_TOOLS["Decision Tools"]
        end
        
        subgraph Utils["Utilities"]
            FUZZY["Fuzzy Matcher"]
            NORMALIZE["Text Normalizer"]
            ABBREV["Abbreviation Expander"]
        end
    end

    subgraph Storage["💾 Storage"]
        WEAVIATE[(Weaviate)]
        MEMORY["In-Memory Context"]
    end

    SLACK --> MAIN
    MAIN --> LOOP
    LOOP --> EXEC
    
    EXEC --> Handlers
    
    Handlers --> OPENAI
    Handlers --> WEAVIATE
    
    CTX_TOOLS --> SLACK
    CTX_TOOLS --> WEAVIATE
    
    MATCH_TOOLS --> FUZZY
    FUZZY --> NORMALIZE
    NORMALIZE --> ABBREV
    
    SEARCH_TOOLS --> WEAVIATE
    DECISION_TOOLS --> WEAVIATE
    DECISION_TOOLS --> MEMORY

    style OPENAI fill:#90EE90
    style WEAVIATE fill:#87CEEB
    style SLACK fill:#FFB6C1
```

---

## 9. Agent Iteration Timeline

```mermaid
gantt
    title Agent Processing Timeline (Typical 3 Iterations)
    dateFormat X
    axisFormat %L ms

    section Iteration 1
    LLM Call           :0, 400
    Tool: get_context  :400, 500

    section Iteration 2
    LLM Call           :500, 900
    Tool: get_topics   :900, 1000

    section Iteration 3
    LLM Call           :1000, 1300
    Tool: assign       :1300, 1350

    section Storage
    Store Message      :1350, 1450
    Update Context     :1450, 1500
```

---

## 10. Fallback Logic

```mermaid
stateDiagram-v2
    [*] --> AgentLoop: Start
    
    AgentLoop --> CheckIteration: Each iteration
    
    CheckIteration --> CallLLM: iteration < max
    CheckIteration --> Fallback: iteration >= max
    
    CallLLM --> ExecuteTools: Tool calls
    CallLLM --> PromptDecision: No tools
    
    ExecuteTools --> CheckDecision: Tool result
    PromptDecision --> AgentLoop: Continue
    
    CheckDecision --> Success: Decision made
    CheckDecision --> AgentLoop: Need more info
    
    Fallback --> ShortCheck: Analyze message
    
    ShortCheck --> UseRecent: Short + has context
    ShortCheck --> CreateGeneral: Otherwise
    
    UseRecent --> Success
    CreateGeneral --> Success
    
    Success --> [*]: Return result
    
    note right of Fallback
        Max iterations reached
        without decision
    end note
```

---

## Quick Reference Card

| Flow | Diagram | Use Case |
|------|---------|----------|
| #1 | Architecture | System overview |
| #2 | Main Flow | Complete process |
| #3 | Agent Loop | Tool-calling sequence |
| #4 | Duplicate Detection | Topic validation |
| #5 | ER Diagram | Database schema |
| #6 | Tool Mind Map | Tool categories |
| #7 | Decision Tree | Message routing |
| #8 | Components | System interaction |
| #9 | Timeline | Processing timing |
| #10 | Fallback | Error handling |

---

*Generated for Smart Categorizer v1.1 (Agent Mode with User Tracking)*
