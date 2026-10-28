import { Router } from 'express';
import { z } from 'zod';
import { userSupabase } from '../supabase.js';

export const notifications = Router();

notifications.get('/notifications', async (req, res, next) => {
  try {
    const client = userSupabase(req.accessToken);
    const [list, unread] = await Promise.all([
      client.from('notifications').select('id,kind,title,body,entity_id,read_at,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(30),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).is('read_at', null),
    ]);
    if (list.error || unread.error) throw list.error || unread.error;
    res.json({ notifications: list.data, unread: unread.count || 0 });
  } catch (error) { next(error); }
});

notifications.post('/notifications/read', async (req, res, next) => {
  try {
    const parsed = z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please provide valid notification identifiers.' });
    const client = userSupabase(req.accessToken);
    let query = client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', req.user.id).is('read_at', null);
    if (parsed.data.ids?.length) query = query.in('id', parsed.data.ids);
    const { error } = await query;
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { next(error); }
});
