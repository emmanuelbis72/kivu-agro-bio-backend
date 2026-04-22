-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'staff',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- WAREHOUSES
-- =========================
CREATE TABLE IF NOT EXISTS warehouses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    city VARCHAR(120) NOT NULL,
    address TEXT,
    manager_name VARCHAR(150),
    phone VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- PRODUCTS
-- =========================
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(120),
    sku VARCHAR(100) NOT NULL UNIQUE,
    barcode VARCHAR(100),
    unit VARCHAR(50) DEFAULT 'piece',
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    alert_threshold INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- STOCK PAR DEPOT
-- =========================
CREATE TABLE IF NOT EXISTS warehouse_stock (
    id SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
    stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
    package_size NUMERIC(14,2),
    package_unit VARCHAR(20),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT warehouse_stock_quantity_chk CHECK (quantity >= 0),
    CONSTRAINT warehouse_stock_stock_form_chk CHECK (stock_form IN ('bulk', 'package')),
    CONSTRAINT warehouse_stock_package_chk CHECK (
        (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
        OR
        (stock_form = 'package' AND package_size > 0 AND package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
    )
);

-- =========================
-- MOUVEMENTS DE STOCK
-- =========================
CREATE TABLE IF NOT EXISTS stock_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    movement_type VARCHAR(30) NOT NULL,
    quantity NUMERIC(14,2) NOT NULL,
    stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
    package_size NUMERIC(14,2),
    package_unit VARCHAR(20),
    unit_cost NUMERIC(12,2) DEFAULT 0,
    reference_type VARCHAR(50),
    reference_id INTEGER,
    notes TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_movement_type CHECK (
        movement_type IN (
            'IN',
            'OUT',
            'TRANSFER_IN',
            'TRANSFER_OUT',
            'ADJUSTMENT',
            'PRODUCTION_CONSUME',
            'PRODUCTION_OUTPUT',
            'TRANSFORM_IN',
            'TRANSFORM_OUT',
            'MIXTURE_IN',
            'MIXTURE_OUT'
        )
    ),
    CONSTRAINT stock_movements_quantity_chk CHECK (quantity > 0),
    CONSTRAINT stock_movements_stock_form_chk CHECK (stock_form IN ('bulk', 'package')),
    CONSTRAINT stock_movements_package_chk CHECK (
        (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
        OR
        (stock_form = 'package' AND package_size > 0 AND package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
    )
);

CREATE TABLE IF NOT EXISTS stock_transfers (
    id SERIAL PRIMARY KEY,
    transfer_number VARCHAR(50) NOT NULL UNIQUE,
    source_warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    destination_warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    notes TEXT NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT stock_transfers_different_warehouses_chk
      CHECK (source_warehouse_id <> destination_warehouse_id),
    CONSTRAINT stock_transfers_status_chk
      CHECK (status IN ('completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id SERIAL PRIMARY KEY,
    transfer_id INT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity NUMERIC(14,2) NOT NULL,
    stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
    package_size NUMERIC(14,2),
    package_unit VARCHAR(20),
    unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT stock_transfer_items_quantity_chk CHECK (quantity > 0),
    CONSTRAINT stock_transfer_items_stock_form_chk CHECK (stock_form IN ('bulk', 'package')),
    CONSTRAINT stock_transfer_items_package_chk CHECK (
        (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
        OR
        (stock_form = 'package' AND package_size > 0 AND package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
    )
);

CREATE TABLE IF NOT EXISTS stock_transformations (
    id SERIAL PRIMARY KEY,
    warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    transformation_type VARCHAR(30) NOT NULL,
    target_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    target_quantity NUMERIC(14,2) NOT NULL,
    target_stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
    target_package_size NUMERIC(14,2),
    target_package_unit VARCHAR(20),
    notes TEXT NULL,
    created_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT stock_transformations_type_chk CHECK (transformation_type IN ('bulk_to_package', 'bulk_mix')),
    CONSTRAINT stock_transformations_quantity_chk CHECK (target_quantity > 0),
    CONSTRAINT stock_transformations_stock_form_chk CHECK (target_stock_form IN ('bulk', 'package')),
    CONSTRAINT stock_transformations_package_chk CHECK (
        (target_stock_form = 'bulk' AND target_package_size IS NULL AND target_package_unit IS NULL)
        OR
        (target_stock_form = 'package' AND target_package_size > 0 AND target_package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
    )
);

CREATE TABLE IF NOT EXISTS stock_transformation_inputs (
    id SERIAL PRIMARY KEY,
    transformation_id INT NOT NULL REFERENCES stock_transformations(id) ON DELETE CASCADE,
    source_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    source_quantity NUMERIC(14,2) NOT NULL,
    source_stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT stock_transformation_inputs_quantity_chk CHECK (source_quantity > 0),
    CONSTRAINT stock_transformation_inputs_stock_form_chk CHECK (source_stock_form = 'bulk')
);

-- =========================
-- CUSTOMERS
-- =========================
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    customer_type VARCHAR(50) NOT NULL DEFAULT 'retail',
    business_name VARCHAR(200) NOT NULL,
    contact_name VARCHAR(150),
    phone VARCHAR(50),
    email VARCHAR(150),
    city VARCHAR(120),
    address TEXT,
    payment_terms_days INTEGER NOT NULL DEFAULT 0,
    credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- INVOICES
-- =========================
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    invoice_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance_due NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_invoice_status CHECK (
        status IN ('draft', 'issued', 'partial', 'paid', 'cancelled')
    )
);

-- =========================
-- INVOICE ITEMS
-- =========================
CREATE TABLE IF NOT EXISTS invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    line_total NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- PAYMENTS
-- =========================
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_date DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
    reference VARCHAR(100),
    notes TEXT,
    received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- EXPENSES
-- =========================
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    expense_date DATE NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
    supplier VARCHAR(150),
    reference VARCHAR(100),
    notes TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_expense_amount CHECK (amount > 0),
    CONSTRAINT chk_expense_payment_method CHECK (
        payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'card')
    )
);

-- =========================
-- OHADA / EXERCICES
-- =========================
CREATE TABLE IF NOT EXISTS fiscal_periods (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    label VARCHAR(120) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_fiscal_period_status CHECK (
        status IN ('open', 'closed', 'archived')
    ),
    CONSTRAINT chk_fiscal_period_dates CHECK (end_date >= start_date)
);

-- =========================
-- OHADA / PLAN COMPTABLE
-- =========================
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    account_number VARCHAR(20) NOT NULL UNIQUE,
    account_name VARCHAR(200) NOT NULL,
    account_class VARCHAR(5) NOT NULL,
    account_type VARCHAR(30) NOT NULL,
    parent_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    is_postable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ohada_category VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_account_type CHECK (
        account_type IN ('asset', 'liability', 'equity', 'income', 'expense', 'off_balance')
    )
);

-- =========================
-- OHADA / ECRITURES COMPTABLES
-- =========================
CREATE TABLE IF NOT EXISTS journal_entries (
    id SERIAL PRIMARY KEY,
    entry_number VARCHAR(50) NOT NULL UNIQUE,
    entry_date DATE NOT NULL,
    journal_code VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    reference_type VARCHAR(50),
    reference_id INTEGER,
    source_module VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    fiscal_period_id INTEGER REFERENCES fiscal_periods(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_journal_entry_status CHECK (
        status IN ('draft', 'posted', 'cancelled')
    )
);

-- =========================
-- OHADA / LIGNES D'ECRITURES
-- =========================
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id SERIAL PRIMARY KEY,
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL,
    description TEXT,
    debit NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit NUMERIC(14,2) NOT NULL DEFAULT 0,
    partner_type VARCHAR(50),
    partner_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_journal_line_positive_values CHECK (
        debit >= 0 AND credit >= 0
    ),
    CONSTRAINT chk_journal_line_not_both_zero CHECK (
        debit > 0 OR credit > 0
    ),
    CONSTRAINT chk_journal_line_not_both_sides CHECK (
        NOT (debit > 0 AND credit > 0)
    ),
    CONSTRAINT unique_journal_entry_line UNIQUE (journal_entry_id, line_number)
);

-- =========================
-- INDEXES EXPLOITATION
-- =========================
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse_id ON stock_movements(warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_stock_variant
ON warehouse_stock (
    warehouse_id,
    product_id,
    stock_form,
    COALESCE(package_size, 0),
    COALESCE(package_unit, '')
);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_warehouse_id ON warehouse_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product_id ON warehouse_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_warehouse ON stock_transfers(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination_warehouse ON stock_transfers(destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product_id ON stock_transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transformations_warehouse_id ON stock_transformations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transformations_target_product_id ON stock_transformations(target_product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transformation_inputs_transformation_id ON stock_transformation_inputs(transformation_id);
CREATE INDEX IF NOT EXISTS idx_stock_transformation_inputs_product_id ON stock_transformation_inputs(source_product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

-- =========================
-- INDEXES COMPTABILITE OHADA
-- =========================
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_dates ON fiscal_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_accounts_account_class ON accounts(account_class);
CREATE INDEX IF NOT EXISTS idx_accounts_account_type ON accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_journal_code ON journal_entries(journal_code);
CREATE INDEX IF NOT EXISTS idx_journal_entries_fiscal_period_id ON journal_entries(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id);
