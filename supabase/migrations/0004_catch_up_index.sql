-- Catching up after a dropped connection asks for one board's rows changed since a point in time,
-- deleted ones included. Without this index that question scans the whole table.
create index if not exists board_items_board_updated_idx on public.board_items (board_id, updated_at);
