-- フローの並び順（フローの order）。トリアージの一覧をこの順に並べ、本体のフローを文字ごとのサブフローより前に出す。
-- 列名は SQL の予約語 order を避ける（0006 の documents と同じ）。NULL（番号のないフロー）はタイトル順で後ろに並ぶ。
ALTER TABLE triage_flows ADD COLUMN sort_order INTEGER;
