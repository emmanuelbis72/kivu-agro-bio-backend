# AI Super-Agent Architecture

## Purpose

This document defines a practical target architecture for turning the KIVU AGRO BIO application into a true cross-functional AI operating layer.

The design is aligned with the current live database and backend services. It is intentionally grounded in the modules that already exist:

- stock
- production
- products
- customers
- invoices
- payments
- expenses
- accounting
- business rules
- company knowledge

The goal is not to create a generic chatbot. The goal is to build a disciplined super-agent that can:

- observe the whole business
- detect risks and opportunities
- reason by function
- project forward
- recommend actions
- execute safe actions where allowed
- escalate decisions when financial or operational risk is high

## Strategic Outcome

The target AI system should behave like a coordinated executive team:

- `CEO Agent`: global view, priorities, growth, risk, decisions
- `Finance Agent`: cash, margin, liquidity, working capital, scenario planning
- `Accounting Agent`: posting quality, fiscal control, reconciliation, compliance
- `Commercial Agent`: customers, invoices, collections, upsell, pipeline discipline
- `Marketing Agent`: campaign learning, demand stimulation, product push, channel ROI
- `Operations Agent`: stock, warehouses, replenishment, transfers, bottlenecks
- `Production Agent`: recipes, batches, yield, component availability, production timing
- `Knowledge Agent`: memory, policies, SOPs, historical patterns, retrieval

These agents should not work as isolated bots. They should work through one orchestrator and one memory layer.

## Current Assets Already Present

The current system already gives a strong base for this architecture.

### Existing data foundations

- `products`, `warehouse_stock`, `stock_movements`, `stock_transfers`, `stock_transfer_items`
- `stock_conversions`, `stock_transformations`, `stock_transformation_inputs`
- `product_recipes`, `production_batches`, `production_batch_items`
- `customers`, `invoices`, `invoice_items`, `payments`
- `expenses`
- `accounts`, `fiscal_periods`, `journal_entries`, `journal_entry_lines`
- `business_rules`, `company_knowledge`

### Existing AI/backend foundations

The codebase already contains the following AI service building blocks:

- `services/ai/aiOrchestrator.service.js`
- `services/ai/ceoReasoning.service.js`
- `services/ai/businessRules.service.js`
- `services/ai/companyKnowledge.service.js`
- `services/ai/naturalQuery.service.js`
- `services/ai/customerScoring.service.js`
- `services/ai/productScoring.service.js`
- `services/ai/cashScoring.service.js`
- `services/ai/kabotAlerts.service.js`
- `services/ai/kabotScoring.service.js`

This means the right next move is not "add random AI." It is to give this layer clearer responsibilities, stronger memory, and a better execution model.

## Core Design Principles

### 1. Operational truth stays in the business tables

The operational schema remains the source of truth:

- stock truth comes from stock tables
- sales truth comes from invoices and payments
- accounting truth comes from journal tables
- production truth comes from recipes and batches

AI tables must never replace operational truth. They should only add:

- observations
- forecasts
- recommendations
- scenario outputs
- execution history
- semantic memory

### 2. The super-agent must be role-based

The system should reason through domain roles, because each function has a different job:

- CEO cares about priorities, risk, growth, and arbitration
- finance cares about liquidity, margin, and projection
- accounting cares about correctness and compliance
- commercial cares about revenue, collection, and customer value
- operations cares about service level, replenishment, and movement efficiency
- production cares about feasibility, availability, and yield
- marketing cares about demand generation and offer performance

### 3. Action must be gated

The AI should not freely execute everything.

Execution modes should be:

- `observe_only`
- `recommend_only`
- `draft_action`
- `auto_execute_low_risk`
- `approval_required`

Examples:

- low stock alert: can auto-generate alert
- customer collection reminder draft: can auto-draft
- price change recommendation: approval required
- accounting write-off: approval required
- warehouse transfer suggestion: recommend or draft
- invoice posting: only if rules are satisfied

### 4. Every conclusion must be explainable

Every AI output should keep:

- what data it used
- what rules it used
- what time horizon it analyzed
- what assumptions it made
- whether the result is descriptive, predictive, or prescriptive

### 5. Memory must be structured

The AI must remember:

- policies
- business rules
- recurring patterns
- prior decisions
- what was recommended
- what was accepted or rejected
- what worked and what failed

This is essential if the system is expected to act as a real executive copilot.

## Target Super-Agent Architecture

## 1. Orchestration Layer

### Main component

`AI Orchestrator`

Responsibilities:

- classify the user or system request
- decide which specialist agents must be invoked
- gather needed data
- merge conclusions
- resolve conflicts between agents
- return one final answer, recommendation set, or action plan

Typical orchestration flows:

- dashboard wake-up -> CEO + Finance + Operations + Collections
- stock alert -> Operations + Production
- unpaid invoice surge -> Commercial + Finance
- margin deterioration -> CEO + Finance + Commercial
- inventory risk -> Operations + Production + Commercial

## 2. Specialist Agents

### CEO Agent

Mission:

- summarize business health
- detect strategic risk
- rank urgent decisions
- propose weekly and monthly priorities

Reads:

- sales trends
- payment delays
- expenses
- stock variation reports
- production performance
- AI alerts
- business rules
- company knowledge

Outputs:

- executive brief
- top 5 risks
- top 5 opportunities
- decisions needing approval
- projected business posture for 7, 30, and 90 days

### Finance Agent

Mission:

- protect cash
- estimate future liquidity
- explain margin movement
- recommend corrective actions

Reads:

- invoices
- payments
- expenses
- product costs
- stock costs
- accounting entries

Outputs:

- cash forecast
- receivables risk
- margin by product / category / customer
- expense anomaly alerts
- scenario analysis

### Accounting Agent

Mission:

- maintain accounting discipline
- validate posting status
- detect broken accounting links
- support closing readiness

Reads:

- invoices, payments, expenses
- accounting_status fields
- journal_entries
- journal_entry_lines
- accounts
- fiscal_periods

Outputs:

- posting exceptions
- reconciliation checks
- closing checklist
- missing account mapping alerts
- compliance warnings

### Commercial Agent

Mission:

- maximize healthy revenue
- improve collection
- improve customer quality

Reads:

- customers
- invoices
- payments
- customer scoring
- product performance

Outputs:

- collection priority list
- customers at churn risk
- customers with upsell potential
- overdue actions
- sales discipline alerts

### Marketing Agent

Mission:

- stimulate demand where it matters
- improve ROI of campaigns
- support product positioning

Reads:

- product sales
- customer segments
- stock availability
- seasonality
- campaign memory when added

Outputs:

- campaign suggestions
- slow-moving product push plan
- demand stimulation ideas
- market-facing messaging drafts

### Operations Agent

Mission:

- keep stock healthy
- reduce stockouts and overstock
- improve movement decisions

Reads:

- warehouse_stock
- stock_movements
- transfers
- transformations
- customer demand patterns

Outputs:

- replenishment suggestions
- warehouse balancing suggestions
- stockout risk alerts
- dead stock alerts
- movement anomaly alerts

### Production Agent

Mission:

- ensure production feasibility
- predict batch bottlenecks
- improve raw material readiness

Reads:

- product_recipes
- production_batches
- production_batch_items
- warehouse stock
- transformation inputs

Outputs:

- production readiness score
- missing component alerts
- next best batch suggestions
- projected output under stock constraints

### Knowledge Agent

Mission:

- provide consistent memory and explanation
- ensure answers respect company policies and past decisions

Reads:

- business_rules
- company_knowledge
- future document memory tables

Outputs:

- policy-grounded reasoning context
- retrieved SOPs
- historical precedent summaries

## 3. Shared AI Capability Layer

Every specialist agent should use shared lower-level capabilities.

### Shared capabilities

- `rules engine`
- `retrieval engine`
- `forecast engine`
- `scoring engine`
- `alert engine`
- `scenario engine`
- `action drafting engine`
- `execution guardrail engine`

### Why this matters

This prevents duplication. For example:

- CEO and Finance both need scenario analysis
- Commercial and Finance both need receivables scoring
- Operations and Production both need stock risk signals

## Target Usage Across the Application

## Stock

The AI should:

- detect low stock and future stockout risk
- distinguish bulk and package variants
- suggest transfer versus replenishment versus transformation
- identify stagnant stock
- identify suspicious movement patterns

Professional behavior:

- never recommend selling raw materials to customers if finished products are required
- prioritize finished-product availability for customer demand
- propose conversion from bulk to package when demand justifies it
- propose mixture production only if components are available and financially viable

## Production

The AI should:

- evaluate whether a batch is feasible before launch
- project the number of batches possible from current inputs
- detect missing recipe components
- estimate impact of production on downstream sales capacity

Professional behavior:

- warn when a batch consumes critical raw materials needed elsewhere
- rank production by expected demand and contribution margin
- avoid recommending production that creates overstock

## Products

The AI should:

- classify product performance
- detect pricing anomalies
- identify products with weak margins
- identify products with high commercial potential

Professional behavior:

- separate catalog logic from stock form logic
- use product role and product economics for business reasoning

## Customers

The AI should:

- score payment risk
- score strategic value
- identify high-risk overdue customers
- identify high-potential customers

Professional behavior:

- distinguish between high revenue and good quality revenue
- recommend stricter terms where overdue behavior is persistent

## Invoices

The AI should:

- track issued, partial, paid, and overdue dynamics
- detect invoicing bottlenecks
- explain revenue concentration

Professional behavior:

- tie invoice status back to payment behavior and stock impact
- treat invoice issuance as both commercial and cash-flow data

## Payments

The AI should:

- monitor collection speed
- detect unusual payment delays
- predict short-term cash pressure

Professional behavior:

- prioritize collection suggestions by amount, age, customer quality, and relationship value

## Expenses

The AI should:

- classify cost pressure
- spot unusual expense spikes
- compare fixed versus variable burden

Professional behavior:

- isolate operationally productive expenses from waste
- flag repetitive non-strategic costs

## Accounting

The AI should:

- monitor accounting completeness
- explain accounting status gaps
- detect unposted operational documents
- support close readiness

Professional behavior:

- never present accounting certainty if journal linkage is missing
- always distinguish draft, posted, and unresolved items

## Intelligence Layer

The AI should:

- answer natural language questions across all modules
- retain institutional memory
- support decision review
- create executive summaries

Professional behavior:

- answer with traceability
- respect business rules before giving recommendations

## Decision System

To act like a real super-agent, the AI should classify all work into four decision types.

### Type A: descriptive

Examples:

- what happened this week
- what products moved the most
- which customers are overdue

### Type B: diagnostic

Examples:

- why cash declined
- why margin fell
- why stockouts increased

### Type C: predictive

Examples:

- what will run out next week
- what cash balance is likely in 30 days
- which customers may delay payment

### Type D: prescriptive

Examples:

- what should be produced first
- which invoices to collect first
- whether to transfer stock between warehouses
- whether to reduce or increase spend

The system must explicitly tag outputs with one of these types.

## Required Guardrails

### Financial guardrails

- no autonomous write-off
- no autonomous price override
- no autonomous accounting reclassification without approval

### Commercial guardrails

- no sale recommendation that exceeds available finished stock
- no recommendation to sell raw materials to end customers unless business rules explicitly allow it

### Stock guardrails

- no transfer recommendation that creates critical shortage in the source warehouse
- no transformation recommendation if source stock is below safety level

### Production guardrails

- no batch recommendation if components are insufficient
- no mixture recommendation that destroys margin without strategic reason

### Knowledge guardrails

- every high-impact recommendation must cite either data, rule, knowledge, or all three

## What the AI Must Persist

A serious super-agent cannot live only in prompts. It needs structured persistence.

### Must persist

- alerts generated
- forecasts generated
- recommendations produced
- scenarios computed
- actions executed
- approvals requested
- approvals granted or rejected
- performance of prior recommendations

### Why this is critical

This is what turns AI from a one-time answer engine into an improving operating system.

## Recommended Next Schema Extensions

These are the most important future tables to add after architecture approval.

### `ai_agent_runs`

Purpose:

- keep one record of each orchestrated AI run

Should store:

- run type
- trigger source
- invoked agents
- context snapshot
- summary
- status
- user approval state
- execution result

### `ai_alerts`

Purpose:

- persist operational and strategic alerts

Should store:

- alert type
- severity
- domain
- object reference
- explanation
- recommended action
- resolution state

### `ai_forecasts`

Purpose:

- store predictive outputs

Should store:

- forecast domain
- entity scope
- horizon
- method
- confidence
- scenario label
- output payload

### `ai_recommendations`

Purpose:

- store prescriptive recommendations

Should store:

- recommendation type
- domain
- expected impact
- urgency
- confidence
- action payload
- approval requirement
- final decision

### `ai_scenarios`

Purpose:

- store executive what-if simulations

Should store:

- scenario type
- assumptions
- time horizon
- projected KPIs
- downside / upside view

### `ai_action_queue`

Purpose:

- operationalize approved AI actions

Should store:

- target module
- action type
- payload
- assigned actor
- deadline
- state

### `document_chunks` and `document_embeddings`

Purpose:

- improve retrieval and semantic reasoning

Should store:

- chunk source
- chunk text
- tags
- entity scope
- embedding vector or external reference

### `customer_scores`

Purpose:

- persist scored customer intelligence

Should store:

- payment risk
- strategic value
- churn risk
- upsell potential

### `product_demand_snapshots`

Purpose:

- support planning and forecasting

Should store:

- product
- period
- sold quantity
- stockout count
- margin
- demand score

### `campaign_performance`

Purpose:

- make marketing measurable

Should store:

- campaign
- channel
- spend
- leads
- conversions
- revenue impact

## Recommended Build Order

The safest professional sequence is:

1. Stabilize operational truth
2. Formalize AI architecture
3. Add AI persistence tables
4. Add forecasting and alerting
5. Add approval workflows
6. Add autonomous low-risk actions
7. Add executive scenario engine

### Step 1: stabilize operational truth

Done or close to done:

- stock variants
- invoice stock impact
- production and transformation logic
- accounting links

### Step 2: formalize architecture

This document is that step.

### Step 3: add persistence for AI

This is the next database step.

### Step 4: add predictive models

Start with:

- stockout forecasting
- cash forecasting
- overdue payment prediction
- slow product detection

### Step 5: add approval workflow

This is what makes the AI usable in professional operations.

### Step 6: enable safe execution

First candidates:

- drafting collection plans
- generating alerts
- preparing transfer suggestions
- preparing production recommendations

### Step 7: executive cockpit

Build one CEO dashboard where all specialized signals converge.

## Best Immediate Next Move

The best next step is now clear:

- create `schema_ai_extensions.sql`

That SQL file should add the persistence layer for:

- agent runs
- alerts
- forecasts
- recommendations
- scenarios
- action queue
- customer scores
- product demand snapshots
- campaign performance
- retrieval memory extensions

It should remain fully compatible with the current operational schema and with the existing AI services in `services/ai`.

## Final Position

The best version of this application is not "an ERP with a chatbot."

It is:

- an operational ERP
- with accounting discipline
- with business memory
- with predictive visibility
- with cross-functional agents
- with approval-aware automation
- and with one orchestrated executive intelligence layer above everything

That is the right path if you want the AI to act as a real super-agent across CEO, finance, accounting, commercial, marketing, production, and stock.
