CREATE TABLE IF NOT EXISTS company_knowledge (
  id SERIAL PRIMARY KEY,
  knowledge_key VARCHAR(150) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  source_type VARCHAR(50) DEFAULT 'manual',
  source_reference TEXT NULL,
  priority_level VARCHAR(20) DEFAULT 'normal',
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER NULL,
  updated_by INTEGER NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_category
ON company_knowledge(category);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_is_active
ON company_knowledge(is_active);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_priority_level
ON company_knowledge(priority_level);