--
-- PostgreSQL database dump
--

\restrict 9CPgX2svrZ0OeNg4ATyZPCQW4o2gU7nX6dtfkNXmsAmkOXjNBkfCpcDlyFz6Zce

-- Dumped from database version 18.3 (Debian 18.3-1.pgdg12+1)
-- Dumped by pg_dump version 18.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: kivu_agro_bio_db_user
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO kivu_agro_bio_db_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    account_number character varying(20) NOT NULL,
    account_name character varying(200) NOT NULL,
    account_class character varying(5) NOT NULL,
    account_type character varying(30) NOT NULL,
    parent_account_id integer,
    is_postable boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    ohada_category character varying(50),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_account_type CHECK (((account_type)::text = ANY ((ARRAY['asset'::character varying, 'liability'::character varying, 'equity'::character varying, 'income'::character varying, 'expense'::character varying, 'off_balance'::character varying])::text[])))
);


ALTER TABLE public.accounts OWNER TO kivu_agro_bio_db_user;

--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.accounts_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: business_rules; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.business_rules (
    id integer NOT NULL,
    rule_key character varying(100) NOT NULL,
    rule_value jsonb NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.business_rules OWNER TO kivu_agro_bio_db_user;

--
-- Name: business_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.business_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.business_rules_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: business_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.business_rules_id_seq OWNED BY public.business_rules.id;


--
-- Name: company_knowledge; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.company_knowledge (
    id integer NOT NULL,
    knowledge_key character varying(150) NOT NULL,
    title character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    content text NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    source_type character varying(50) DEFAULT 'manual'::character varying,
    source_reference text,
    priority_level character varying(20) DEFAULT 'normal'::character varying,
    is_active boolean DEFAULT true,
    created_by integer,
    updated_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.company_knowledge OWNER TO kivu_agro_bio_db_user;

--
-- Name: company_knowledge_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.company_knowledge_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.company_knowledge_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: company_knowledge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.company_knowledge_id_seq OWNED BY public.company_knowledge.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    customer_type character varying(50) DEFAULT 'retail'::character varying NOT NULL,
    business_name character varying(200) NOT NULL,
    contact_name character varying(150),
    phone character varying(50),
    email character varying(150),
    city character varying(120),
    address text,
    payment_terms_days integer DEFAULT 0 NOT NULL,
    credit_limit numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    receivable_account_id integer,
    warehouse_id integer
);


ALTER TABLE public.customers OWNER TO kivu_agro_bio_db_user;

--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    expense_date date NOT NULL,
    category character varying(100) NOT NULL,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying NOT NULL,
    supplier character varying(150),
    reference character varying(100),
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    accounting_status character varying(20),
    accounting_entry_id integer,
    accounting_message text,
    CONSTRAINT chk_expense_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_expense_payment_method CHECK (((payment_method)::text = ANY ((ARRAY['cash'::character varying, 'mobile_money'::character varying, 'bank_transfer'::character varying, 'card'::character varying])::text[])))
);


ALTER TABLE public.expenses OWNER TO kivu_agro_bio_db_user;

--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expenses_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: fiscal_periods; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.fiscal_periods (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    label character varying(120) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_fiscal_period_dates CHECK ((end_date >= start_date)),
    CONSTRAINT chk_fiscal_period_status CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.fiscal_periods OWNER TO kivu_agro_bio_db_user;

--
-- Name: fiscal_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.fiscal_periods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fiscal_periods_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: fiscal_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.fiscal_periods_id_seq OWNED BY public.fiscal_periods.id;


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    product_id integer NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    line_total numeric(12,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    stock_form character varying(20),
    package_size numeric(14,2),
    package_unit character varying(20),
    CONSTRAINT invoice_items_package_chk CHECK ((((stock_form IS NULL) AND (package_size IS NULL) AND (package_unit IS NULL)) OR (((stock_form)::text = 'bulk'::text) AND (package_size IS NULL) AND (package_unit IS NULL)) OR (((stock_form)::text = 'package'::text) AND (package_size IS NOT NULL) AND (package_unit IS NOT NULL)))),
    CONSTRAINT invoice_items_stock_form_chk CHECK (((stock_form IS NULL) OR ((stock_form)::text = ANY ((ARRAY['bulk'::character varying, 'package'::character varying])::text[]))))
);


ALTER TABLE public.invoice_items OWNER TO kivu_agro_bio_db_user;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_items_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_number character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    warehouse_id integer NOT NULL,
    invoice_date date NOT NULL,
    due_date date,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    balance_due numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    accounting_status character varying(20),
    accounting_entry_id integer,
    accounting_message text,
    CONSTRAINT chk_invoice_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'issued'::character varying, 'partial'::character varying, 'paid'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.invoices OWNER TO kivu_agro_bio_db_user;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.journal_entries (
    id integer NOT NULL,
    entry_number character varying(50) NOT NULL,
    entry_date date NOT NULL,
    journal_code character varying(20) NOT NULL,
    description text NOT NULL,
    reference_type character varying(50),
    reference_id integer,
    source_module character varying(50),
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    fiscal_period_id integer,
    created_by integer,
    validated_by integer,
    validated_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_journal_entry_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'posted'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.journal_entries OWNER TO kivu_agro_bio_db_user;

--
-- Name: journal_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.journal_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.journal_entries_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: journal_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.journal_entries_id_seq OWNED BY public.journal_entries.id;


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.journal_entry_lines (
    id integer NOT NULL,
    journal_entry_id integer NOT NULL,
    account_id integer NOT NULL,
    line_number integer NOT NULL,
    description text,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    partner_type character varying(50),
    partner_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_journal_line_not_both_sides CHECK ((NOT ((debit > (0)::numeric) AND (credit > (0)::numeric)))),
    CONSTRAINT chk_journal_line_not_both_zero CHECK (((debit > (0)::numeric) OR (credit > (0)::numeric))),
    CONSTRAINT chk_journal_line_positive_values CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric)))
);


ALTER TABLE public.journal_entry_lines OWNER TO kivu_agro_bio_db_user;

--
-- Name: journal_entry_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.journal_entry_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.journal_entry_lines_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: journal_entry_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.journal_entry_lines_id_seq OWNED BY public.journal_entry_lines.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    payment_date date NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying NOT NULL,
    reference character varying(100),
    notes text,
    received_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    accounting_status character varying(20),
    accounting_entry_id integer,
    accounting_message text
);


ALTER TABLE public.payments OWNER TO kivu_agro_bio_db_user;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: product_recipes; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.product_recipes (
    id integer NOT NULL,
    finished_product_id integer NOT NULL,
    component_product_id integer NOT NULL,
    quantity_required numeric(14,2) NOT NULL,
    unit character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_recipes_qty_chk CHECK ((quantity_required > (0)::numeric))
);


ALTER TABLE public.product_recipes OWNER TO kivu_agro_bio_db_user;

--
-- Name: product_recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.product_recipes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.product_recipes_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: product_recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.product_recipes_id_seq OWNED BY public.product_recipes.id;


--
-- Name: production_batch_items; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.production_batch_items (
    id integer NOT NULL,
    batch_id integer NOT NULL,
    component_product_id integer NOT NULL,
    quantity_consumed numeric(14,2) NOT NULL,
    quantity_unit character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_batch_items_qty_chk CHECK ((quantity_consumed > (0)::numeric))
);


ALTER TABLE public.production_batch_items OWNER TO kivu_agro_bio_db_user;

--
-- Name: production_batch_items_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.production_batch_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.production_batch_items_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: production_batch_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.production_batch_items_id_seq OWNED BY public.production_batch_items.id;


--
-- Name: production_batches; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.production_batches (
    id integer NOT NULL,
    batch_number character varying(50) NOT NULL,
    warehouse_id integer NOT NULL,
    finished_product_id integer NOT NULL,
    quantity_planned numeric(14,2) NOT NULL,
    quantity_produced numeric(14,2) NOT NULL,
    production_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_batches_qty_planned_chk CHECK ((quantity_planned > (0)::numeric)),
    CONSTRAINT production_batches_qty_produced_chk CHECK ((quantity_produced >= (0)::numeric))
);


ALTER TABLE public.production_batches OWNER TO kivu_agro_bio_db_user;

--
-- Name: production_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.production_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.production_batches_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: production_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.production_batches_id_seq OWNED BY public.production_batches.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    category character varying(120),
    sku character varying(100) NOT NULL,
    barcode character varying(100),
    unit character varying(50) DEFAULT 'piece'::character varying NOT NULL,
    cost_price numeric(12,2) DEFAULT 0 NOT NULL,
    selling_price numeric(12,2) DEFAULT 0 NOT NULL,
    alert_threshold integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    sales_account_id integer,
    product_type character varying(30) DEFAULT 'finished_product'::character varying NOT NULL,
    stock_unit character varying(20) DEFAULT 'unit'::character varying NOT NULL,
    pack_size numeric(14,2),
    pack_unit character varying(20),
    raw_material_id integer,
    product_role character varying(30) DEFAULT 'finished_product'::character varying NOT NULL,
    CONSTRAINT products_alert_threshold_chk CHECK ((alert_threshold >= 0)),
    CONSTRAINT products_cost_price_chk CHECK ((cost_price >= (0)::numeric)),
    CONSTRAINT products_pack_size_chk CHECK (((pack_size IS NULL) OR (pack_size > (0)::numeric))),
    CONSTRAINT products_pack_unit_chk CHECK (((pack_unit IS NULL) OR ((pack_unit)::text = ANY ((ARRAY['g'::character varying, 'kg'::character varying, 'ml'::character varying, 'l'::character varying, 'unit'::character varying])::text[])))),
    CONSTRAINT products_product_type_chk CHECK (((product_type)::text = ANY ((ARRAY['raw_material'::character varying, 'finished_product'::character varying, 'packaging_material'::character varying])::text[]))),
    CONSTRAINT products_role_chk CHECK (((product_role)::text = ANY ((ARRAY['finished_product'::character varying, 'raw_material'::character varying, 'packaging_material'::character varying])::text[]))),
    CONSTRAINT products_selling_price_chk CHECK ((selling_price >= (0)::numeric)),
    CONSTRAINT products_stock_unit_chk CHECK (((stock_unit)::text = ANY ((ARRAY['g'::character varying, 'kg'::character varying, 'ml'::character varying, 'l'::character varying, 'unit'::character varying])::text[])))
);


ALTER TABLE public.products OWNER TO kivu_agro_bio_db_user;

--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.products_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: stock_conversions; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.stock_conversions (
    id integer NOT NULL,
    conversion_number character varying(50) NOT NULL,
    warehouse_id integer NOT NULL,
    raw_material_id integer NOT NULL,
    finished_product_id integer NOT NULL,
    raw_quantity_used numeric(14,2) NOT NULL,
    finished_quantity_created numeric(14,2) NOT NULL,
    conversion_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_conversions_finished_qty_chk CHECK ((finished_quantity_created > (0)::numeric)),
    CONSTRAINT stock_conversions_raw_qty_chk CHECK ((raw_quantity_used > (0)::numeric))
);


ALTER TABLE public.stock_conversions OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_conversions_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.stock_conversions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_conversions_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_conversions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.stock_conversions_id_seq OWNED BY public.stock_conversions.id;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.stock_movements (
    id integer NOT NULL,
    product_id integer NOT NULL,
    warehouse_id integer NOT NULL,
    movement_type character varying(30) NOT NULL,
    quantity numeric(14,2) NOT NULL,
    unit_cost numeric(12,2) DEFAULT 0,
    reference_type character varying(50),
    reference_id integer,
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    stock_form character varying(20) DEFAULT 'bulk'::character varying NOT NULL,
    package_size numeric(14,2),
    package_unit character varying(20),
    CONSTRAINT chk_movement_type CHECK (((movement_type)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying, 'TRANSFER_IN'::character varying, 'TRANSFER_OUT'::character varying, 'ADJUSTMENT'::character varying, 'PRODUCTION_CONSUME'::character varying, 'PRODUCTION_OUTPUT'::character varying, 'TRANSFORM_IN'::character varying, 'TRANSFORM_OUT'::character varying, 'MIXTURE_IN'::character varying, 'MIXTURE_OUT'::character varying])::text[]))),
    CONSTRAINT stock_movements_movement_type_chk CHECK (((movement_type)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying, 'ADJUSTMENT'::character varying, 'PRODUCTION_CONSUME'::character varying, 'PRODUCTION_OUTPUT'::character varying])::text[]))),
    CONSTRAINT stock_movements_package_chk CHECK (((((stock_form)::text = 'bulk'::text) AND (package_size IS NULL) AND (package_unit IS NULL)) OR (((stock_form)::text = 'package'::text) AND (package_size > (0)::numeric) AND ((package_unit)::text = ANY ((ARRAY['g'::character varying, 'kg'::character varying, 'ml'::character varying, 'l'::character varying, 'unit'::character varying, 'piece'::character varying])::text[]))))),
    CONSTRAINT stock_movements_quantity_chk CHECK ((quantity > (0)::numeric)),
    CONSTRAINT stock_movements_stock_form_chk CHECK (((stock_form)::text = ANY ((ARRAY['bulk'::character varying, 'package'::character varying])::text[])))
);


ALTER TABLE public.stock_movements OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_movements_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.stock_movements_id_seq OWNED BY public.stock_movements.id;


--
-- Name: stock_transfer_items; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.stock_transfer_items (
    id integer NOT NULL,
    transfer_id integer NOT NULL,
    product_id integer NOT NULL,
    quantity numeric(14,2) NOT NULL,
    unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    stock_form character varying(20) DEFAULT 'bulk'::character varying NOT NULL,
    package_size numeric(14,2),
    package_unit character varying(20),
    CONSTRAINT stock_transfer_items_quantity_chk CHECK ((quantity > (0)::numeric))
);


ALTER TABLE public.stock_transfer_items OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transfer_items_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.stock_transfer_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfer_items_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transfer_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.stock_transfer_items_id_seq OWNED BY public.stock_transfer_items.id;


--
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.stock_transfers (
    id integer NOT NULL,
    transfer_number character varying(50) NOT NULL,
    source_warehouse_id integer NOT NULL,
    destination_warehouse_id integer NOT NULL,
    transfer_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_transfers_different_warehouses_chk CHECK ((source_warehouse_id <> destination_warehouse_id)),
    CONSTRAINT stock_transfers_status_chk CHECK (((status)::text = ANY ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.stock_transfers OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.stock_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfers_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.stock_transfers_id_seq OWNED BY public.stock_transfers.id;


--
-- Name: stock_transformation_inputs; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.stock_transformation_inputs (
    id integer NOT NULL,
    transformation_id integer NOT NULL,
    source_product_id integer NOT NULL,
    source_quantity numeric(14,2) NOT NULL,
    source_stock_form character varying(20) DEFAULT 'bulk'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_transformation_inputs_quantity_chk CHECK ((source_quantity > (0)::numeric)),
    CONSTRAINT stock_transformation_inputs_stock_form_chk CHECK (((source_stock_form)::text = 'bulk'::text))
);


ALTER TABLE public.stock_transformation_inputs OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transformation_inputs_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.stock_transformation_inputs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transformation_inputs_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transformation_inputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.stock_transformation_inputs_id_seq OWNED BY public.stock_transformation_inputs.id;


--
-- Name: stock_transformations; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.stock_transformations (
    id integer NOT NULL,
    warehouse_id integer NOT NULL,
    transformation_type character varying(30) NOT NULL,
    target_product_id integer NOT NULL,
    target_quantity numeric(14,2) NOT NULL,
    target_stock_form character varying(20) DEFAULT 'bulk'::character varying NOT NULL,
    target_package_size numeric(14,2),
    target_package_unit character varying(20),
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_transformations_package_chk CHECK (((((target_stock_form)::text = 'bulk'::text) AND (target_package_size IS NULL) AND (target_package_unit IS NULL)) OR (((target_stock_form)::text = 'package'::text) AND (target_package_size > (0)::numeric) AND ((target_package_unit)::text = ANY ((ARRAY['g'::character varying, 'kg'::character varying, 'ml'::character varying, 'l'::character varying, 'unit'::character varying, 'piece'::character varying])::text[]))))),
    CONSTRAINT stock_transformations_quantity_chk CHECK ((target_quantity > (0)::numeric)),
    CONSTRAINT stock_transformations_stock_form_chk CHECK (((target_stock_form)::text = ANY ((ARRAY['bulk'::character varying, 'package'::character varying])::text[]))),
    CONSTRAINT stock_transformations_type_chk CHECK (((transformation_type)::text = ANY ((ARRAY['bulk_to_package'::character varying, 'bulk_mix'::character varying])::text[])))
);


ALTER TABLE public.stock_transformations OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transformations_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.stock_transformations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transformations_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: stock_transformations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.stock_transformations_id_seq OWNED BY public.stock_transformations.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.users (
    id integer NOT NULL,
    full_name character varying(150) NOT NULL,
    email character varying(150) NOT NULL,
    password_hash text NOT NULL,
    role character varying(50) DEFAULT 'staff'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO kivu_agro_bio_db_user;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: warehouse_stock; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.warehouse_stock (
    id integer NOT NULL,
    warehouse_id integer NOT NULL,
    product_id integer NOT NULL,
    quantity numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    stock_form character varying(20) DEFAULT 'bulk'::character varying NOT NULL,
    package_size numeric(14,2),
    package_unit character varying(20),
    CONSTRAINT warehouse_stock_package_chk CHECK (((((stock_form)::text = 'bulk'::text) AND (package_size IS NULL) AND (package_unit IS NULL)) OR (((stock_form)::text = 'package'::text) AND (package_size > (0)::numeric) AND ((package_unit)::text = ANY ((ARRAY['g'::character varying, 'kg'::character varying, 'ml'::character varying, 'l'::character varying, 'unit'::character varying, 'piece'::character varying])::text[]))))),
    CONSTRAINT warehouse_stock_quantity_chk CHECK ((quantity >= (0)::numeric)),
    CONSTRAINT warehouse_stock_stock_form_chk CHECK (((stock_form)::text = ANY ((ARRAY['bulk'::character varying, 'package'::character varying])::text[])))
);


ALTER TABLE public.warehouse_stock OWNER TO kivu_agro_bio_db_user;

--
-- Name: warehouse_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.warehouse_stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.warehouse_stock_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: warehouse_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.warehouse_stock_id_seq OWNED BY public.warehouse_stock.id;


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE TABLE public.warehouses (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    city character varying(120) NOT NULL,
    address text,
    manager_name character varying(150),
    phone character varying(50),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.warehouses OWNER TO kivu_agro_bio_db_user;

--
-- Name: warehouses_id_seq; Type: SEQUENCE; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE SEQUENCE public.warehouses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.warehouses_id_seq OWNER TO kivu_agro_bio_db_user;

--
-- Name: warehouses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER SEQUENCE public.warehouses_id_seq OWNED BY public.warehouses.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: business_rules id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.business_rules ALTER COLUMN id SET DEFAULT nextval('public.business_rules_id_seq'::regclass);


--
-- Name: company_knowledge id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.company_knowledge ALTER COLUMN id SET DEFAULT nextval('public.company_knowledge_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: fiscal_periods id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.fiscal_periods ALTER COLUMN id SET DEFAULT nextval('public.fiscal_periods_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: journal_entries id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entries ALTER COLUMN id SET DEFAULT nextval('public.journal_entries_id_seq'::regclass);


--
-- Name: journal_entry_lines id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entry_lines ALTER COLUMN id SET DEFAULT nextval('public.journal_entry_lines_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: product_recipes id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.product_recipes ALTER COLUMN id SET DEFAULT nextval('public.product_recipes_id_seq'::regclass);


--
-- Name: production_batch_items id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batch_items ALTER COLUMN id SET DEFAULT nextval('public.production_batch_items_id_seq'::regclass);


--
-- Name: production_batches id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batches ALTER COLUMN id SET DEFAULT nextval('public.production_batches_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: stock_conversions id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_conversions ALTER COLUMN id SET DEFAULT nextval('public.stock_conversions_id_seq'::regclass);


--
-- Name: stock_movements id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_movements ALTER COLUMN id SET DEFAULT nextval('public.stock_movements_id_seq'::regclass);


--
-- Name: stock_transfer_items id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfer_items ALTER COLUMN id SET DEFAULT nextval('public.stock_transfer_items_id_seq'::regclass);


--
-- Name: stock_transfers id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfers ALTER COLUMN id SET DEFAULT nextval('public.stock_transfers_id_seq'::regclass);


--
-- Name: stock_transformation_inputs id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformation_inputs ALTER COLUMN id SET DEFAULT nextval('public.stock_transformation_inputs_id_seq'::regclass);


--
-- Name: stock_transformations id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformations ALTER COLUMN id SET DEFAULT nextval('public.stock_transformations_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: warehouse_stock id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.warehouse_stock ALTER COLUMN id SET DEFAULT nextval('public.warehouse_stock_id_seq'::regclass);


--
-- Name: warehouses id; Type: DEFAULT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.warehouses ALTER COLUMN id SET DEFAULT nextval('public.warehouses_id_seq'::regclass);


--
-- Name: accounts accounts_account_number_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_account_number_key UNIQUE (account_number);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: business_rules business_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.business_rules
    ADD CONSTRAINT business_rules_pkey PRIMARY KEY (id);


--
-- Name: business_rules business_rules_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.business_rules
    ADD CONSTRAINT business_rules_rule_key_key UNIQUE (rule_key);


--
-- Name: company_knowledge company_knowledge_knowledge_key_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.company_knowledge
    ADD CONSTRAINT company_knowledge_knowledge_key_key UNIQUE (knowledge_key);


--
-- Name: company_knowledge company_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.company_knowledge
    ADD CONSTRAINT company_knowledge_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: fiscal_periods fiscal_periods_code_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_code_key UNIQUE (code);


--
-- Name: fiscal_periods fiscal_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_entry_number_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_entry_number_key UNIQUE (entry_number);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: product_recipes product_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.product_recipes
    ADD CONSTRAINT product_recipes_pkey PRIMARY KEY (id);


--
-- Name: production_batch_items production_batch_items_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batch_items
    ADD CONSTRAINT production_batch_items_pkey PRIMARY KEY (id);


--
-- Name: production_batches production_batches_batch_number_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_batch_number_key UNIQUE (batch_number);


--
-- Name: production_batches production_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: products products_sku_unique; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_unique UNIQUE (sku);


--
-- Name: stock_conversions stock_conversions_conversion_number_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_conversions
    ADD CONSTRAINT stock_conversions_conversion_number_key UNIQUE (conversion_number);


--
-- Name: stock_conversions stock_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_conversions
    ADD CONSTRAINT stock_conversions_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer_items stock_transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id);


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: stock_transfers stock_transfers_transfer_number_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_transfer_number_key UNIQUE (transfer_number);


--
-- Name: stock_transformation_inputs stock_transformation_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformation_inputs
    ADD CONSTRAINT stock_transformation_inputs_pkey PRIMARY KEY (id);


--
-- Name: stock_transformations stock_transformations_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformations
    ADD CONSTRAINT stock_transformations_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines unique_journal_entry_line; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT unique_journal_entry_line UNIQUE (journal_entry_id, line_number);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: warehouse_stock warehouse_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_pkey PRIMARY KEY (id);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- Name: idx_accounts_account_class; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_accounts_account_class ON public.accounts USING btree (account_class);


--
-- Name: idx_accounts_account_type; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_accounts_account_type ON public.accounts USING btree (account_type);


--
-- Name: idx_customers_business_name; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_customers_business_name ON public.customers USING btree (business_name);


--
-- Name: idx_expenses_category; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_expenses_category ON public.expenses USING btree (category);


--
-- Name: idx_expenses_expense_date; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_expenses_expense_date ON public.expenses USING btree (expense_date);


--
-- Name: idx_fiscal_periods_dates; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_fiscal_periods_dates ON public.fiscal_periods USING btree (start_date, end_date);


--
-- Name: idx_invoices_customer_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_invoices_customer_id ON public.invoices USING btree (customer_id);


--
-- Name: idx_invoices_invoice_date; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_invoices_invoice_date ON public.invoices USING btree (invoice_date);


--
-- Name: idx_journal_entries_entry_date; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_journal_entries_entry_date ON public.journal_entries USING btree (entry_date);


--
-- Name: idx_journal_entries_fiscal_period_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_journal_entries_fiscal_period_id ON public.journal_entries USING btree (fiscal_period_id);


--
-- Name: idx_journal_entries_journal_code; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_journal_entries_journal_code ON public.journal_entries USING btree (journal_code);


--
-- Name: idx_journal_entry_lines_account_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_journal_entry_lines_account_id ON public.journal_entry_lines USING btree (account_id);


--
-- Name: idx_journal_entry_lines_journal_entry_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_journal_entry_lines_journal_entry_id ON public.journal_entry_lines USING btree (journal_entry_id);


--
-- Name: idx_payments_invoice_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_payments_invoice_id ON public.payments USING btree (invoice_id);


--
-- Name: idx_product_recipes_component_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_product_recipes_component_product_id ON public.product_recipes USING btree (component_product_id);


--
-- Name: idx_product_recipes_finished_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_product_recipes_finished_product_id ON public.product_recipes USING btree (finished_product_id);


--
-- Name: idx_production_batches_finished_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_production_batches_finished_product_id ON public.production_batches USING btree (finished_product_id);


--
-- Name: idx_production_batches_warehouse_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_production_batches_warehouse_id ON public.production_batches USING btree (warehouse_id);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_products_category ON public.products USING btree (category);


--
-- Name: idx_products_is_active; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_products_is_active ON public.products USING btree (is_active);


--
-- Name: idx_products_name; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_products_name ON public.products USING btree (name);


--
-- Name: idx_products_product_type; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_products_product_type ON public.products USING btree (product_type);


--
-- Name: idx_products_sku; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_products_sku ON public.products USING btree (sku);


--
-- Name: idx_stock_movements_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_movements_product_id ON public.stock_movements USING btree (product_id);


--
-- Name: idx_stock_movements_warehouse_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_movements_warehouse_id ON public.stock_movements USING btree (warehouse_id);


--
-- Name: idx_stock_transfer_items_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transfer_items_product_id ON public.stock_transfer_items USING btree (product_id);


--
-- Name: idx_stock_transfer_items_transfer_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transfer_items_transfer_id ON public.stock_transfer_items USING btree (transfer_id);


--
-- Name: idx_stock_transfers_destination_warehouse; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transfers_destination_warehouse ON public.stock_transfers USING btree (destination_warehouse_id);


--
-- Name: idx_stock_transfers_source_warehouse; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transfers_source_warehouse ON public.stock_transfers USING btree (source_warehouse_id);


--
-- Name: idx_stock_transformation_inputs_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transformation_inputs_product_id ON public.stock_transformation_inputs USING btree (source_product_id);


--
-- Name: idx_stock_transformation_inputs_transformation_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transformation_inputs_transformation_id ON public.stock_transformation_inputs USING btree (transformation_id);


--
-- Name: idx_stock_transformations_target_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transformations_target_product_id ON public.stock_transformations USING btree (target_product_id);


--
-- Name: idx_stock_transformations_warehouse_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_stock_transformations_warehouse_id ON public.stock_transformations USING btree (warehouse_id);


--
-- Name: idx_warehouse_stock_product_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_warehouse_stock_product_id ON public.warehouse_stock USING btree (product_id);


--
-- Name: idx_warehouse_stock_warehouse_id; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE INDEX idx_warehouse_stock_warehouse_id ON public.warehouse_stock USING btree (warehouse_id);


--
-- Name: uq_product_recipes_finished_component; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE UNIQUE INDEX uq_product_recipes_finished_component ON public.product_recipes USING btree (finished_product_id, component_product_id);


--
-- Name: uq_warehouse_stock_variant; Type: INDEX; Schema: public; Owner: kivu_agro_bio_db_user
--

CREATE UNIQUE INDEX uq_warehouse_stock_variant ON public.warehouse_stock USING btree (warehouse_id, product_id, stock_form, COALESCE(package_size, (0)::numeric), COALESCE(package_unit, ''::character varying));


--
-- Name: accounts accounts_parent_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: customers customers_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customers fk_customers_receivable_account; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT fk_customers_receivable_account FOREIGN KEY (receivable_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: customers fk_customers_warehouse; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT fk_customers_warehouse FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- Name: expenses fk_expenses_accounting_entry; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT fk_expenses_accounting_entry FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;


--
-- Name: invoices fk_invoices_accounting_entry; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT fk_invoices_accounting_entry FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;


--
-- Name: payments fk_payments_accounting_entry; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT fk_payments_accounting_entry FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;


--
-- Name: products fk_products_sales_account; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_products_sales_account FOREIGN KEY (sales_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: journal_entries journal_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_fiscal_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_fiscal_period_id_fkey FOREIGN KEY (fiscal_period_id) REFERENCES public.fiscal_periods(id) ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_validated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: journal_entry_lines journal_entry_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: journal_entry_lines journal_entry_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: payments payments_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: product_recipes product_recipes_component_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.product_recipes
    ADD CONSTRAINT product_recipes_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: product_recipes product_recipes_finished_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.product_recipes
    ADD CONSTRAINT product_recipes_finished_product_id_fkey FOREIGN KEY (finished_product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: production_batch_items production_batch_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batch_items
    ADD CONSTRAINT production_batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.production_batches(id) ON DELETE CASCADE;


--
-- Name: production_batch_items production_batch_items_component_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batch_items
    ADD CONSTRAINT production_batch_items_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: production_batches production_batches_finished_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_finished_product_id_fkey FOREIGN KEY (finished_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: production_batches production_batches_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: products products_raw_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_raw_material_id_fkey FOREIGN KEY (raw_material_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: products products_sales_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sales_account_id_fkey FOREIGN KEY (sales_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: stock_conversions stock_conversions_finished_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_conversions
    ADD CONSTRAINT stock_conversions_finished_product_id_fkey FOREIGN KEY (finished_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: stock_conversions stock_conversions_raw_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_conversions
    ADD CONSTRAINT stock_conversions_raw_material_id_fkey FOREIGN KEY (raw_material_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: stock_conversions stock_conversions_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_conversions
    ADD CONSTRAINT stock_conversions_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: stock_transfer_items stock_transfer_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: stock_transfer_items stock_transfer_items_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE CASCADE;


--
-- Name: stock_transfers stock_transfers_destination_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_destination_warehouse_id_fkey FOREIGN KEY (destination_warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: stock_transfers stock_transfers_source_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_source_warehouse_id_fkey FOREIGN KEY (source_warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: stock_transformation_inputs stock_transformation_inputs_source_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformation_inputs
    ADD CONSTRAINT stock_transformation_inputs_source_product_id_fkey FOREIGN KEY (source_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: stock_transformation_inputs stock_transformation_inputs_transformation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformation_inputs
    ADD CONSTRAINT stock_transformation_inputs_transformation_id_fkey FOREIGN KEY (transformation_id) REFERENCES public.stock_transformations(id) ON DELETE CASCADE;


--
-- Name: stock_transformations stock_transformations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformations
    ADD CONSTRAINT stock_transformations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: stock_transformations stock_transformations_target_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformations
    ADD CONSTRAINT stock_transformations_target_product_id_fkey FOREIGN KEY (target_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: stock_transformations stock_transformations_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.stock_transformations
    ADD CONSTRAINT stock_transformations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT;


--
-- Name: warehouse_stock warehouse_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: warehouse_stock warehouse_stock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: kivu_agro_bio_db_user
--

ALTER TABLE ONLY public.warehouse_stock
    ADD CONSTRAINT warehouse_stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON SEQUENCES TO kivu_agro_bio_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TYPES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TYPES TO kivu_agro_bio_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON FUNCTIONS TO kivu_agro_bio_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TABLES TO kivu_agro_bio_db_user;


--
-- PostgreSQL database dump complete
--

\unrestrict 9CPgX2svrZ0OeNg4ATyZPCQW4o2gU7nX6dtfkNXmsAmkOXjNBkfCpcDlyFz6Zce

