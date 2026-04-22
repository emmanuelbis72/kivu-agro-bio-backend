ALTER TABLE invoice_items
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20),
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2),
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoice_items_stock_form_chk'
    ) THEN
        ALTER TABLE invoice_items
        ADD CONSTRAINT invoice_items_stock_form_chk CHECK (
            stock_form IS NULL OR stock_form IN ('bulk', 'package')
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoice_items_package_chk'
    ) THEN
        ALTER TABLE invoice_items
        ADD CONSTRAINT invoice_items_package_chk CHECK (
            (stock_form IS NULL AND package_size IS NULL AND package_unit IS NULL)
            OR (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
            OR (stock_form = 'package' AND package_size IS NOT NULL AND package_unit IS NOT NULL)
        );
    END IF;
END $$;
