-- 【任意】毎日17:30(日本時間)に、終了し忘れの作業を自動で中断する。
-- 先に Database > Extensions で「pg_cron」を有効にしてから実行してください。
-- 17:30 JST = 08:30 UTC。月〜金のみ。時刻を変える場合は '30 8' を変更します。
select cron.schedule('auto-pause-1730', '30 8 * * 1-5', $$select public.auto_pause_running()$$);
-- 解除する場合: select cron.unschedule('auto-pause-1730');
