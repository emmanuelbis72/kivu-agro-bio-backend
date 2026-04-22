-- ============================================================================
-- KIVU AGRO BIO - AI EXTENSIONS SCHEMA
-- ============================================================================
-- Purpose:
--   Add a production-ready AI persistence layer on top of the live ERP schema.
--
-- Design goals:
--   - Stay compatible with the current operational schema
--   - Support orchestration, alerts, forecasts, recommendations, scenarios
--   - Support CEO / finance / accounting / commercial / marketing / operations
--   - Support memory, approvals, action tracking, and model traceability
--   - Remain portable across PostgreSQL environments
--
-- Notes:
--   - This file does not modify core business tables.
--   - This file creates only additive AI support tables.
--   - JSONB is used heavily to keep the first implementation flexible.
-- ============================================================================

BEGIN;

-- ============================================================================
-- AI AGENT RUNS
-- ============================================================================
-- One record per orchestrated AI run, whether triggered by a user, scheduler,
-- dashboard refresh, alert pipeline, or background analysis.

CREATE TABLE IF NOT EXISTS ai_agent_runs (
    id SERIAL PRIMARY KEY,
    run_key VARCHAR(100) NOT NULL UNIQUE,
    trigger_source VARCHAR(50) NOT NULL DEFAULT 'manual',
    trigger_label VARCHAR(150),
    orchestrator_name VARCHAR(100) NOT NULL DEFAULT 'ai_orchestrator',
    request_text TEXT,
    request_type VARCHAR(50) NOT NULL DEFAULT 'analysis',
    target_domain VARCHAR(50) NOT NULL DEFAULT 'general',
    invoked_agents JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    rules_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    knowledge_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary TEXT,
    result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score NUMERIC(5,2),
    risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
    execution_mode VARCHAR(30) NOT NULL DEFAULT 'recommend_only',
    approval_state VARCHAR(30) NOT NULL DEFAULT 'not_required',
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_agent_runs_trigger_source_chk CHECK (
        trigger_source IN ('manual', 'dashboard', 'scheduled', 'alert', 'api', 'system')
    ),
    CONSTRAINT ai_agent_runs_request_type_chk CHECK (
        request_type IN ('analysis', 'forecast', 'recommendation', 'scenario', 'decision_support', 'automation')
    ),
    CONSTRAINT ai_agent_runs_target_domain_chk CHECK (
        target_domain IN ('general', 'ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge')
    ),
    CONSTRAINT ai_agent_runs_risk_level_chk CHECK (
        risk_level IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT ai_agent_runs_execution_mode_chk CHECK (
        execution_mode IN ('observe_only', 'recommend_only', 'draft_action', 'auto_execute_low_risk', 'approval_required')
    ),
    CONSTRAINT ai_agent_runs_approval_state_chk CHECK (
        approval_state IN ('not_required', 'pending', 'approved', 'rejected', 'expired')
    ),
    CONSTRAINT ai_agent_runs_status_chk CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ),
    CONSTRAINT ai_agent_runs_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_trigger_source
    ON ai_agent_runs (trigger_source);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_target_domain
    ON ai_agent_runs (target_domain);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_status
    ON ai_agent_runs (status);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_started_at
    ON ai_agent_runs (started_at DESC);


-- ============================================================================
-- AI ALERTS
-- ============================================================================
-- Persistent alert store for cross-functional monitoring.

CREATE TABLE IF NOT EXISTS ai_alerts (
    id SERIAL PRIMARY KEY,
    alert_key VARCHAR(120) NOT NULL UNIQUE,
    run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
    source_agent VARCHAR(100) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    alert_type VARCHAR(60) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    priority_weight INTEGER NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    explanation TEXT,
    recommendation TEXT,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    object_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    alert_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolution_state VARCHAR(30) NOT NULL DEFAULT 'open',
    resolved_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_alerts_domain_chk CHECK (
        domain IN ('ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge', 'general')
    ),
    CONSTRAINT ai_alerts_severity_chk CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT ai_alerts_priority_weight_chk CHECK (
        priority_weight >= 1 AND priority_weight <= 10
    ),
    CONSTRAINT ai_alerts_resolution_state_chk CHECK (
        resolution_state IN ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed')
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_domain
    ON ai_alerts (domain);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_severity
    ON ai_alerts (severity);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_resolution_state
    ON ai_alerts (resolution_state);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_detected_at
    ON ai_alerts (detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_entity
    ON ai_alerts (entity_type, entity_id);


-- ============================================================================
-- AI FORECASTS
-- ============================================================================
-- Predictive outputs across stock, sales, cash, collections, and production.

CREATE TABLE IF NOT EXISTS ai_forecasts (
    id SERIAL PRIMARY KEY,
    forecast_key VARCHAR(120) NOT NULL UNIQUE,
    run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
    source_agent VARCHAR(100) NOT NULL,
    forecast_domain VARCHAR(50) NOT NULL,
    forecast_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    period_granularity VARCHAR(20) NOT NULL DEFAULT 'day',
    horizon_days INTEGER NOT NULL,
    horizon_start DATE NOT NULL,
    horizon_end DATE NOT NULL,
    scenario_label VARCHAR(50) NOT NULL DEFAULT 'baseline',
    method_name VARCHAR(100),
    confidence_score NUMERIC(5,2),
    input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    forecast_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    projected_value NUMERIC(18,4),
    projected_unit VARCHAR(30),
    explanation TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_forecasts_domain_chk CHECK (
        forecast_domain IN ('stock', 'sales', 'cash', 'receivables', 'expenses', 'production', 'marketing', 'general')
    ),
    CONSTRAINT ai_forecasts_period_granularity_chk CHECK (
        period_granularity IN ('day', 'week', 'month', 'quarter')
    ),
    CONSTRAINT ai_forecasts_scenario_label_chk CHECK (
        scenario_label IN ('baseline', 'prudent', 'aggressive', 'stress', 'custom')
    ),
    CONSTRAINT ai_forecasts_horizon_days_chk CHECK (
        horizon_days > 0
    ),
    CONSTRAINT ai_forecasts_horizon_dates_chk CHECK (
        horizon_end >= horizon_start
    ),
    CONSTRAINT ai_forecasts_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_forecasts_domain
    ON ai_forecasts (forecast_domain);

CREATE INDEX IF NOT EXISTS idx_ai_forecasts_entity
    ON ai_forecasts (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_ai_forecasts_horizon_start
    ON ai_forecasts (horizon_start);

CREATE INDEX IF NOT EXISTS idx_ai_forecasts_horizon_end
    ON ai_forecasts (horizon_end);

CREATE INDEX IF NOT EXISTS idx_ai_forecasts_created_at
    ON ai_forecasts (created_at DESC);


-- ============================================================================
-- AI RECOMMENDATIONS
-- ============================================================================
-- Prescriptive advice produced by specialist agents or the orchestrator.

CREATE TABLE IF NOT EXISTS ai_recommendations (
    id SERIAL PRIMARY KEY,
    recommendation_key VARCHAR(120) NOT NULL UNIQUE,
    run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
    source_agent VARCHAR(100) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    recommendation_type VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    rationale TEXT,
    expected_impact VARCHAR(50) NOT NULL DEFAULT 'medium',
    urgency VARCHAR(20) NOT NULL DEFAULT 'medium',
    confidence_score NUMERIC(5,2),
    entity_type VARCHAR(50),
    entity_id INTEGER,
    action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    supporting_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    approval_requirement VARCHAR(30) NOT NULL DEFAULT 'approval_required',
    decision_state VARCHAR(30) NOT NULL DEFAULT 'proposed',
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMP,
    decision_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_recommendations_domain_chk CHECK (
        domain IN ('ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge', 'general')
    ),
    CONSTRAINT ai_recommendations_expected_impact_chk CHECK (
        expected_impact IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT ai_recommendations_urgency_chk CHECK (
        urgency IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT ai_recommendations_approval_requirement_chk CHECK (
        approval_requirement IN ('not_required', 'optional_review', 'approval_required')
    ),
    CONSTRAINT ai_recommendations_decision_state_chk CHECK (
        decision_state IN ('proposed', 'approved', 'rejected', 'deferred', 'executed', 'expired')
    ),
    CONSTRAINT ai_recommendations_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_domain
    ON ai_recommendations (domain);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_decision_state
    ON ai_recommendations (decision_state);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_urgency
    ON ai_recommendations (urgency);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_entity
    ON ai_recommendations (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_created_at
    ON ai_recommendations (created_at DESC);


-- ============================================================================
-- AI SCENARIOS
-- ============================================================================
-- Structured what-if analysis for CEO and finance decision support.

CREATE TABLE IF NOT EXISTS ai_scenarios (
    id SERIAL PRIMARY KEY,
    scenario_key VARCHAR(120) NOT NULL UNIQUE,
    run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
    source_agent VARCHAR(100) NOT NULL,
    scenario_type VARCHAR(80) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
    baseline_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    optimistic_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    downside_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommended_option VARCHAR(30),
    confidence_score NUMERIC(5,2),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_scenarios_domain_chk CHECK (
        domain IN ('ceo', 'finance', 'commercial', 'marketing', 'operations', 'stock', 'production', 'general')
    ),
    CONSTRAINT ai_scenarios_recommended_option_chk CHECK (
        recommended_option IS NULL OR recommended_option IN ('baseline', 'optimistic', 'downside', 'custom')
    ),
    CONSTRAINT ai_scenarios_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_scenarios_domain
    ON ai_scenarios (domain);

CREATE INDEX IF NOT EXISTS idx_ai_scenarios_scenario_type
    ON ai_scenarios (scenario_type);

CREATE INDEX IF NOT EXISTS idx_ai_scenarios_created_at
    ON ai_scenarios (created_at DESC);


-- ============================================================================
-- AI ACTION QUEUE
-- ============================================================================
-- Tracks approved or drafted actions that may later be executed by users or by
-- low-risk automation.

CREATE TABLE IF NOT EXISTS ai_action_queue (
    id SERIAL PRIMARY KEY,
    action_key VARCHAR(120) NOT NULL UNIQUE,
    recommendation_id INTEGER REFERENCES ai_recommendations(id) ON DELETE SET NULL,
    run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
    domain VARCHAR(50) NOT NULL,
    target_module VARCHAR(50) NOT NULL,
    action_type VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    execution_mode VARCHAR(30) NOT NULL DEFAULT 'draft_action',
    priority_level VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(30) NOT NULL DEFAULT 'queued',
    due_at TIMESTAMP,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    executed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    executed_at TIMESTAMP,
    execution_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_action_queue_domain_chk CHECK (
        domain IN ('ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge', 'general')
    ),
    CONSTRAINT ai_action_queue_target_module_chk CHECK (
        target_module IN ('dashboard', 'stock', 'production', 'products', 'customers', 'invoices', 'payments', 'expenses', 'accounting', 'knowledge', 'ai')
    ),
    CONSTRAINT ai_action_queue_execution_mode_chk CHECK (
        execution_mode IN ('observe_only', 'recommend_only', 'draft_action', 'auto_execute_low_risk', 'approval_required')
    ),
    CONSTRAINT ai_action_queue_priority_level_chk CHECK (
        priority_level IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT ai_action_queue_status_chk CHECK (
        status IN ('queued', 'approved', 'scheduled', 'running', 'completed', 'failed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_action_queue_domain
    ON ai_action_queue (domain);

CREATE INDEX IF NOT EXISTS idx_ai_action_queue_target_module
    ON ai_action_queue (target_module);

CREATE INDEX IF NOT EXISTS idx_ai_action_queue_status
    ON ai_action_queue (status);

CREATE INDEX IF NOT EXISTS idx_ai_action_queue_due_at
    ON ai_action_queue (due_at);


-- ============================================================================
-- CUSTOMER SCORES
-- ============================================================================
-- Periodic or event-driven customer intelligence.

CREATE TABLE IF NOT EXISTS customer_scores (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    score_date DATE NOT NULL DEFAULT CURRENT_DATE,
    source_agent VARCHAR(100) NOT NULL DEFAULT 'customer_scoring',
    payment_risk_score NUMERIC(5,2),
    strategic_value_score NUMERIC(5,2),
    churn_risk_score NUMERIC(5,2),
    upsell_potential_score NUMERIC(5,2),
    collection_priority_score NUMERIC(5,2),
    customer_segment VARCHAR(50),
    score_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    explanation TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_scores_payment_risk_chk CHECK (
        payment_risk_score IS NULL OR (payment_risk_score >= 0 AND payment_risk_score <= 100)
    ),
    CONSTRAINT customer_scores_strategic_value_chk CHECK (
        strategic_value_score IS NULL OR (strategic_value_score >= 0 AND strategic_value_score <= 100)
    ),
    CONSTRAINT customer_scores_churn_risk_chk CHECK (
        churn_risk_score IS NULL OR (churn_risk_score >= 0 AND churn_risk_score <= 100)
    ),
    CONSTRAINT customer_scores_upsell_potential_chk CHECK (
        upsell_potential_score IS NULL OR (upsell_potential_score >= 0 AND upsell_potential_score <= 100)
    ),
    CONSTRAINT customer_scores_collection_priority_chk CHECK (
        collection_priority_score IS NULL OR (collection_priority_score >= 0 AND collection_priority_score <= 100)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_scores_customer_day
    ON customer_scores (customer_id, score_date);

CREATE INDEX IF NOT EXISTS idx_customer_scores_score_date
    ON customer_scores (score_date DESC);


-- ============================================================================
-- PRODUCT DEMAND SNAPSHOTS
-- ============================================================================
-- Historical demand memory for forecasting, replenishment, and slow-product detection.

CREATE TABLE IF NOT EXISTS product_demand_snapshots (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    snapshot_date DATE NOT NULL,
    period_granularity VARCHAR(20) NOT NULL DEFAULT 'day',
    quantity_sold NUMERIC(14,2) NOT NULL DEFAULT 0,
    sales_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    stockout_events INTEGER NOT NULL DEFAULT 0,
    average_stock_level NUMERIC(14,2),
    gross_margin_amount NUMERIC(14,2),
    gross_margin_percent NUMERIC(7,2),
    demand_score NUMERIC(5,2),
    snapshot_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT product_demand_snapshots_period_chk CHECK (
        period_granularity IN ('day', 'week', 'month')
    ),
    CONSTRAINT product_demand_snapshots_quantity_sold_chk CHECK (
        quantity_sold >= 0
    ),
    CONSTRAINT product_demand_snapshots_sales_amount_chk CHECK (
        sales_amount >= 0
    ),
    CONSTRAINT product_demand_snapshots_stockout_events_chk CHECK (
        stockout_events >= 0
    ),
    CONSTRAINT product_demand_snapshots_demand_score_chk CHECK (
        demand_score IS NULL OR (demand_score >= 0 AND demand_score <= 100)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_demand_snapshots_scope
    ON product_demand_snapshots (product_id, warehouse_id, snapshot_date, period_granularity);

CREATE INDEX IF NOT EXISTS idx_product_demand_snapshots_snapshot_date
    ON product_demand_snapshots (snapshot_date DESC);


-- ============================================================================
-- CAMPAIGN PERFORMANCE
-- ============================================================================
-- Marketing memory for performance attribution and ROI learning.

CREATE TABLE IF NOT EXISTS campaign_performance (
    id SERIAL PRIMARY KEY,
    campaign_key VARCHAR(120) NOT NULL UNIQUE,
    campaign_name VARCHAR(255) NOT NULL,
    channel VARCHAR(80) NOT NULL,
    objective VARCHAR(80),
    target_city VARCHAR(120),
    target_segment VARCHAR(120),
    start_date DATE NOT NULL,
    end_date DATE,
    spend_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    impressions INTEGER,
    leads_count INTEGER NOT NULL DEFAULT 0,
    conversions_count INTEGER NOT NULL DEFAULT 0,
    revenue_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    roi_percent NUMERIC(9,2),
    performance_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT campaign_performance_dates_chk CHECK (
        end_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT campaign_performance_spend_chk CHECK (
        spend_amount >= 0
    ),
    CONSTRAINT campaign_performance_leads_chk CHECK (
        leads_count >= 0
    ),
    CONSTRAINT campaign_performance_conversions_chk CHECK (
        conversions_count >= 0
    ),
    CONSTRAINT campaign_performance_revenue_chk CHECK (
        revenue_amount >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_campaign_performance_channel
    ON campaign_performance (channel);

CREATE INDEX IF NOT EXISTS idx_campaign_performance_start_date
    ON campaign_performance (start_date DESC);


-- ============================================================================
-- DOCUMENT CHUNKS
-- ============================================================================
-- Retrieval-ready structured document memory.

CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    document_key VARCHAR(150) NOT NULL,
    document_type VARCHAR(60) NOT NULL DEFAULT 'knowledge',
    source_table VARCHAR(80),
    source_record_id INTEGER,
    chunk_index INTEGER NOT NULL,
    title VARCHAR(255),
    category VARCHAR(100),
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}'::text[],
    entity_type VARCHAR(50),
    entity_id INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT document_chunks_chunk_index_chk CHECK (
        chunk_index >= 0
    ),
    CONSTRAINT document_chunks_document_type_chk CHECK (
        document_type IN ('knowledge', 'policy', 'procedure', 'report', 'note', 'customer_history', 'supplier_history', 'campaign', 'meeting', 'custom')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_chunks_doc_index
    ON document_chunks (document_key, chunk_index);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_type
    ON document_chunks (document_type);

CREATE INDEX IF NOT EXISTS idx_document_chunks_category
    ON document_chunks (category);

CREATE INDEX IF NOT EXISTS idx_document_chunks_entity
    ON document_chunks (entity_type, entity_id);


-- ============================================================================
-- DOCUMENT EMBEDDINGS
-- ============================================================================
-- Portable embedding registry without requiring pgvector.
-- If pgvector is installed later, this table can evolve to include a vector column.

CREATE TABLE IF NOT EXISTS document_embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    embedding_provider VARCHAR(80) NOT NULL,
    embedding_model VARCHAR(120) NOT NULL,
    embedding_dimensions INTEGER,
    embedding_ref TEXT,
    embedding_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT document_embeddings_dimensions_chk CHECK (
        embedding_dimensions IS NULL OR embedding_dimensions > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_embeddings_chunk_model
    ON document_embeddings (chunk_id, embedding_provider, embedding_model);


-- ============================================================================
-- OPTIONAL MATERIALIZED MEMORY FOR KPI SNAPSHOTS
-- ============================================================================
-- Cross-functional summary snapshots for executive trend analysis.

CREATE TABLE IF NOT EXISTS ai_kpi_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    period_granularity VARCHAR(20) NOT NULL DEFAULT 'day',
    kpi_domain VARCHAR(50) NOT NULL,
    kpi_key VARCHAR(100) NOT NULL,
    kpi_value NUMERIC(18,4),
    kpi_unit VARCHAR(30),
    dimension_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_kpi_snapshots_period_chk CHECK (
        period_granularity IN ('day', 'week', 'month')
    ),
    CONSTRAINT ai_kpi_snapshots_domain_chk CHECK (
        kpi_domain IN ('ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'general')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_kpi_snapshots_scope
    ON ai_kpi_snapshots (snapshot_date, period_granularity, kpi_domain, kpi_key);

CREATE INDEX IF NOT EXISTS idx_ai_kpi_snapshots_snapshot_date
    ON ai_kpi_snapshots (snapshot_date DESC);


COMMIT;

-- ============================================================================
-- OPTIONAL FUTURE ENHANCEMENT
-- ============================================================================
-- If pgvector becomes available later, one possible extension path is:
--
--   CREATE EXTENSION IF NOT EXISTS vector;
--   ALTER TABLE document_embeddings ADD COLUMN embedding vector(1536);
--
-- This file does not require pgvector in order to remain deployable on the
-- current environment.
