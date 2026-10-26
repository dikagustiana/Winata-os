-- 0007_recon.sql
-- Rekonsiliasi Accurate dan ekspor BS 04A (M5).

create index if not exists accurate_sales_line_date_idx on accurate_sales_line (date);
create index if not exists accurate_sales_line_item_idx on accurate_sales_line (item_code);
create index if not exists accurate_stock_line_item_idx on accurate_stock_line (item_code);
create index if not exists reconciliation_item_status_idx on reconciliation_item (status, period) where deleted_at is null;
create index if not exists item_map_grade_idx on item_map (grade_id) where deleted_at is null;

alter table item_map drop constraint if exists item_map_factor_check;
alter table item_map add constraint item_map_factor_check check (factor_to_kg > 0);
