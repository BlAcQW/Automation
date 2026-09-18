---
name: solution-validator
description: Comprehensive solution research and validation. For any new product idea, service offering, or business concept, this skill provides thorough market research, creates a business model canvas (BMC), searches GitHub for competitive/similar projects, analyzes the competitive landscape, and delivers a viability assessment. Use this whenever you're exploring a new SaaS idea, considering a feature, vetting a partnership, or validating a business concept before building. Output: detailed research report + BMC + competitive matrix + go/no-go recommendation.
allowed-tools: WebSearch, WebFetch, Bash(gh search:*), Bash(gh api:*)
---

# Solution Validator

Rigorous research and validation framework for new business ideas, products, and services. Combines market intelligence, business model design, and technical competitive analysis to reduce execution risk.

---

## When to Use This Skill

- **New product/service idea**: Before building, validate market demand, business viability, and competitive landscape
- **Feature consideration**: Is this worth building? What's the market size? Who else does it?
- **Partnership evaluation**: Should we integrate X, acquire Y, or partner with Z?
- **Market expansion**: Testing a new market segment (e.g., Ikieguy entering a new vertical in Liberia)
- **Business model testing**: "Can we charge for this? What's the revenue model?"
- **Competitive intelligence**: What are similar projects doing? How do we differentiate?
- **Due diligence**: Pre-investment or pre-acquisition research

---

## Input & Questions

The skill asks you for:

1. **Solution Description**
   - What is it? (product, service, feature, platform)
   - Who is it for? (target customer)
   - What problem does it solve?
   
2. **Context**
   - Is this for an existing company or a new venture?
   - Geographic focus (Ghana, Liberia, West Africa, global)?
   - Budget/timeline constraints?
   - Technical assumptions (existing tech stack, build vs. buy)?

3. **Success Criteria**
   - What does "success" look like? (revenue target, user count, market share, impact)
   - Key decision thresholds (e.g., "only proceed if TAM > $10M")

---

## Research Framework

### **1. Market Research**
- **TAM (Total Addressable Market)**: Size of the opportunity globally
- **SAM (Serviceable Addressable Market)**: Realistic market for this company
- **SOM (Serviceable Obtainable Market)**: Year 1–3 realistic penetration
- **Trends**: Is the market growing, shrinking, or stable?
- **Customer pain**: How acute is the problem? Willing to pay?
- **Regulatory**: Any blockers (data protection, licensing, compliance)?

### **2. Competitive Analysis**
- **Direct competitors**: Who else solves this problem?
- **Indirect competitors**: Alternative solutions or workarounds
- **GitHub landscape**: 
  - Open-source projects addressing this (active? mature? community size?)
  - Forks, stars, update frequency, license
  - Code quality / production-readiness signals
- **Differentiation**: What's your unique angle? (price, speed, localization, features?)
- **Barriers to entry**: What stops others from copying? (IP, network effects, brand, cost)

### **3. Business Model Canvas**

A one-page visual breakdown:

```
┌─────────────────────┬──────────────────┬─────────────────────┐
│ Key Partners        │ Key Activities   │ Value Proposition   │
│                     │                  │                     │
│ • ...               │ • ...            │ • ...               │
│ • ...               │ • ...            │ • ...               │
├─────────────────────┼──────────────────┼─────────────────────┤
│ Key Resources       │                  │ Customer Segments   │
│                     │                  │                     │
│ • ...               │                  │ • ...               │
│ • ...               │                  │ • ...               │
├─────────────────────┼──────────────────┼─────────────────────┤
│ Cost Structure      │ Revenue Streams  │ Customer Channels   │
│                     │                  │                     │
│ • ...               │ • ...            │ • ...               │
│ • ...               │ • ...            │ • ...               │
└─────────────────────┴──────────────────┴─────────────────────┘
```

Covers:
- **Value Proposition**: Why customers choose this
- **Customer Segments**: Who buys? (SMB, enterprise, individual, etc.)
- **Channels**: How do customers discover/buy? (direct sales, SaaS, mobile app, reseller)
- **Customer Relationships**: How do you retain? (support, community, upsell)
- **Revenue Streams**: How do you make money? (subscription, one-time, freemium, license)
- **Key Resources**: What's needed to operate? (team, tech, capital, partnerships)
- **Key Activities**: What do you do daily? (build, support, market, integrate)
- **Key Partners**: Who helps? (integrations, resellers, cloud providers, investors)
- **Cost Structure**: Fixed + variable costs; unit economics

### **4. Viability Assessment**

Scoring across dimensions:

| Dimension | Good Signal | Red Flag |
|-----------|-------------|----------|
| **Market Size** | TAM >$50M, growing | TAM <$10M, shrinking |
| **Customer Pain** | Acute, willing to pay | Nice-to-have, DIY alternatives |
| **Competition** | Few direct competitors, differentiation clear | Crowded, commoditized, hard to differentiate |
| **Go-to-Market** | Clear path to customers, known channels | Unclear acquisition, expensive to reach |
| **Unit Economics** | CAC < 3x LTV, gross margin >60% | CAC > LTV, margin <30% |
| **Execution Risk** | Existing tech, known team | New tech, unproven founders |
| **Regulatory** | Clear, no blockers | Uncertain, potential compliance issues |
| **Timeline to Revenue** | <6 months | >18 months |

### **5. GitHub Competitive Matrix**

Example output:

```
SIMILAR PROJECTS FOUND:

1. Project-A (Stars: 2.1k, Updated: 2 weeks ago)
   - Language: Python
   - License: MIT (free to use)
   - Maturity: Production-ready, active community
   - Differentiation gap: They do X, we focus on Y + localization

2. Project-B (Stars: 450, Updated: 6 months ago)
   - Language: JavaScript
   - License: Proprietary
   - Maturity: Early stage, slow updates
   - Differentiation gap: We're faster, cheaper, or focused on [your market]

3. Project-C (Stars: 15k, Updated: 1 month ago)
   - Language: Go
   - License: Apache 2.0
   - Maturity: Enterprise-grade
   - Differentiation gap: They're big/expensive; we're SMB-focused or cheaper
```

---

## Output Deliverables

### **1. Executive Summary**
- What is the solution?
- Market size and opportunity
- Viability score (green/yellow/red)
- Go/no-go recommendation + top 3 reasons

### **2. Market Research Report**
- TAM/SAM/SOM breakdown
- Customer pain and willingness to pay
- Growth trends
- Regulatory landscape

### **3. Competitive Analysis**
- Direct competitors (names, features, pricing, weaknesses)
- Indirect competitors (alternatives users are using now)
- GitHub landscape (similar open-source projects, code maturity)
- Differentiation strategy

### **4. Business Model Canvas**
- Filled-out BMC (one visual)
- Revenue model options (with pros/cons)
- Unit economics framework (CAC, LTV, payback period)

### **5. Risk Assessment**
- Execution risks (tech, team, timeline)
- Market risks (demand, competition, regulatory)
- Financial risks (capital needed, burn rate, profitability path)
- Mitigation strategies

### **6. Action Items**
- Top 3 priorities if going forward
- Data gaps to fill (more research needed?)
- Next steps (MVP scope, customer interviews, partnerships to pursue)

---

## Workflow

### **Step 1: Intake**
You describe the solution idea (2–3 min conversation):
- What problem are you solving?
- Who's the customer?
- Why now? What's changed?

### **Step 2: Research**
The skill conducts:
- Web research (market size, trends, customer insights)
- GitHub search (similar projects, competitive intelligence)
- Business model exploration (revenue options, unit economics)

### **Step 3: Validate & Synthesize**
- Cross-check findings (is the market as big as you thought?)
- Identify assumptions vs. facts
- Draft business model canvas
- Create competitive matrix

### **Step 4: Deliver Report**
- Full research report (6–10 pages equivalent)
- BMC (one-pager)
- Go/no-go recommendation
- Next steps

### **Step 5: Iterate**
User can ask:
- "Dig deeper into [competitor]"
- "What if we charge [different model]?"
- "Should we partner instead of build?"
- "What's our 12-month execution plan?"

---

## GitHub Search Strategy

The skill searches for:

1. **Direct matches**: Keywords from your solution (e.g., "AI helpdesk", "telematics tracking")
2. **Open-source alternatives**: What else solves this problem?
3. **Similar tech stacks**: Related projects using your planned tech (Python, Node, React, etc.)
4. **Active vs. abandoned**: Update frequency, community size, contributor count
5. **License implications**: MIT? GPL? Proprietary? Can you fork and build on it?

For each project found:
- Star count (proxy for adoption)
- Last update (is it maintained?)
- Code quality (README, tests, documentation)
- License (can you build on it?)
- Community size (issues, PRs, discussions)

---

## Example Scenarios

### **Scenario 1: New SaaS for Ghana Market**
*Input:* "AI-powered recruitment tool for Ghanaian SMBs"
*Output:*
- TAM: $50M–$100M (HR software spend in West Africa)
- Competition: 3 global competitors (expensive, not localized); 1 African competitor (nascent)
- BMC: B2B SaaS, subscription, freemium option
- GitHub: Found 5 similar projects; none Ghana-focused
- Recommendation: GREEN (if you can localize, differentiate on price/support)

### **Scenario 2: Feature for Existing Product**
*Input:* "Add video calling to our telematics platform"
*Output:*
- Market: Small add-on for existing customer base
- Competition: Twilio, Jitsi, built-in to most platforms
- BMC: Add-on revenue, minimal new cost structure
- GitHub: Jitsi (15k stars, open-source); Daily.co (closed); many wrappers
- Recommendation: YELLOW (do it if your engineers can integrate in <4 weeks; otherwise use Twilio)

### **Scenario 3: Market Expansion**
*Input:* "Expand our HelpDesk into Liberia"
*Output:*
- Market: Similar to Ghana; growing; 15–20 competitors
- Competition: Mostly global players not localized; 1–2 local players
- BMC: Adapt existing model; localize pricing, payment methods, language
- GitHub: Infrastructure same; no new projects needed
- Recommendation: GREEN (expand; you have existing product + market entry experience)

---

## Quick Prompts to Use

- "Validate this idea: [description]. Do market research, GitHub competitive check, and give me a BMC."
- "I'm thinking of building [solution]. What's the market size? Who else is doing this?"
- "Check GitHub: are there open-source projects like [what I want to build]?"
- "Create a business model canvas for [idea] and tell me if we should go for it."
- "Competitive analysis: how do we differentiate from [competitors] in [market]?"

---

## Success Criteria

A good validation result should answer:

- ✅ Is there a real market? (TAM, growing?)
- ✅ Can we reach customers? (clear go-to-market path?)
- ✅ Can we make money? (unit economics viable?)
- ✅ Who else is doing this? (differentiation clear?)
- ✅ Should we build or buy? (GitHub alternatives exist?)
- ✅ What's our next move? (go/no-go + action items)