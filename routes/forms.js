const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../database');
const { utmChannel } = require('../channel');

const router = express.Router();   // mounted at /api/forms  (dashboard API)
const hook   = express.Router();   // mounted at /hook       (public receiver)

// ── Extraction helpers (payloads vary by software, so best-effort) ──────────
const isEmail = s => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const humanize = k => String(k).replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();

// Deep search: prefer a key literally named like "email", else any email-looking value.
function findEmail(o) {
  let byKey = '', anyEmail = '';
  const walk = (v, key) => {
    if (byKey) return;
    if (v && typeof v === 'object') { for (const k in v) walk(v[k], k); return; }
    if (isEmail(v)) { if (/e[\-_]?mail/i.test(key || '')) byKey = v.trim(); else if (!anyEmail) anyEmail = v.trim(); }
  };
  walk(o, '');
  return byKey || anyEmail;
}
// Name: full name keys, else first + last.
function findName(o) {
  const flat = {};
  const walk = v => { if (v && typeof v === 'object') for (const k in v) { if (typeof v[k] !== 'object') { if (!(k in flat)) flat[k] = v[k]; } else walk(v[k]); } };
  walk(o);
  const get = re => { for (const k in flat) if (re.test(k) && flat[k] != null && String(flat[k]).trim()) return String(flat[k]).trim(); return ''; };
  const full = get(/^full[_\s]?name$/i) || get(/^name$/i) || get(/contact[_\s]?name/i) || get(/^your[_\s]?name$/i);
  if (full) return full;
  const first = get(/first[_\s]?name/i) || get(/^fname$/i), last = get(/last[_\s]?name/i) || get(/^lname$/i);
  return [first, last].filter(Boolean).join(' ').trim();
}
// Form identifier for grouping — a form id/name in the payload, else the webhook's name.
function findFormKey(o, fallback) {
  const flat = {};
  const walk = v => { if (v && typeof v === 'object') for (const k in v) { if (typeof v[k] !== 'object') { if (!(k in flat)) flat[k] = v[k]; } else walk(v[k]); } };
  walk(o);
  for (const k in flat) if (/form[_\s]?(name|title|id|key)/i.test(k) && flat[k] != null && String(flat[k]).trim()) return String(flat[k]).trim();
  return fallback;
}
// Flatten the payload into a readable [{q, a}] list (nested keys → "Parent › Child").
function flattenFields(obj) {
  const out = [];
  const walk = (v, path) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path ? `${path} [${i + 1}]` : `[${i + 1}]`)); return; }
    if (typeof v === 'object') { for (const k in v) walk(v[k], path ? `${path} › ${humanize(k)}` : humanize(k)); return; }
    const a = String(v); if (a !== '') out.push({ q: path, a });
    if (out.length > 1000) throw { __stop: true };   // generous cap; raw payload keeps everything anyway
  };
  try { walk(obj, ''); } catch (e) { if (!e.__stop) throw e; }
  return out;
}

// Channel/source of a submission — parse the UTM the form captured (usually in
// payload.utm_params), else any payload string carrying utm_*; map to a channel.
const getp = (s, k) => { const m = String(s).match(new RegExp('[?&]' + k + '=([^&#]*)', 'i')); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''; };
function submissionSource(payload) {
  if (!payload || typeof payload !== 'object') return 'Direct / Unknown';
  let utm = typeof payload.utm_params === 'string' ? payload.utm_params : '';
  if (!utm) for (const k in payload) if (typeof payload[k] === 'string' && /utm_[a-z]+=/i.test(payload[k])) { utm = payload[k]; break; }
  if (!utm) return 'Direct / Unknown';
  const c = getp(utm, 'utm_content'), s = getp(utm, 'utm_source'), m = getp(utm, 'utm_medium');
  if (!c && !s && !m) return 'Direct / Unknown';
  return utmChannel(c, s, m) || 'Direct / Unknown';
}

// ── Webhooks (create / list / delete) ───────────────────────────────────────
router.get('/webhooks', async (req, res) => {
  try {
    const { data: hooks, error } = await supabase.from('webhooks').select('id, token, name, created_at, last_fired_at').order('created_at', { ascending: false });
    if (error) throw error;   // surface "table missing" so the UI prompts to run the schema
    // submission counts per webhook (lightweight)
    const { data: subs } = await supabase.from('form_submissions').select('webhook_id').limit(20000);
    const counts = {};
    for (const s of (subs || [])) counts[s.webhook_id] = (counts[s.webhook_id] || 0) + 1;
    res.json((hooks || []).map(h => ({ ...h, count: counts[h.id] || 0 })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/webhooks', async (req, res) => {
  try {
    const name = (req.body.name || '').toString().trim().slice(0, 120) || 'Untitled webhook';
    const token = crypto.randomBytes(12).toString('hex');
    const { data, error } = await supabase.from('webhooks').insert({ token, name }).select('id, token, name, created_at').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/webhooks/:id', async (req, res) => {
  try { const { error } = await supabase.from('webhooks').delete().eq('id', req.params.id); if (error) throw error; res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Forms (grouped) + rename ────────────────────────────────────────────────
router.get('/list', async (req, res) => {
  try {
    const { data: subs, error } = await supabase.from('form_submissions').select('form_key, created_at').order('created_at', { ascending: false }).limit(20000);
    if (error) throw error;
    const { data: names } = await supabase.from('forms').select('form_key, name');
    const nameMap = Object.fromEntries((names || []).map(r => [r.form_key, r.name]));
    const g = {};
    for (const s of (subs || [])) {
      const k = s.form_key || '(unknown)';
      if (!g[k]) g[k] = { form_key: k, name: nameMap[k] || k, count: 0, lastAt: s.created_at };
      g[k].count++;
      if (s.created_at > g[k].lastAt) g[k].lastAt = s.created_at;
    }
    res.json(Object.values(g).sort((a, b) => (b.lastAt > a.lastAt ? 1 : -1)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/rename', async (req, res) => {
  try {
    const form_key = (req.body.form_key || '').toString();
    const name = (req.body.name || '').toString().trim().slice(0, 160);
    if (!form_key) return res.status(400).json({ error: 'form_key required' });
    const { error } = await supabase.from('forms').upsert({ form_key, name, updated_at: new Date().toISOString() }, { onConflict: 'form_key' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Submissions (search / list / detail) ────────────────────────────────────
router.get('/submissions', async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim().slice(0, 100);
    const form = (req.query.form || '').toString();
    let q = supabase.from('form_submissions').select('id, form_key, contact_name, contact_email, created_at, payload').order('created_at', { ascending: false }).limit(300);
    if (form) q = q.eq('form_key', form);
    if (search) q = q.or(`contact_name.ilike.*${search}*,contact_email.ilike.*${search}*`);
    const { data, error } = await q;
    if (error) throw error;
    // attach the channel/source (from the payload UTM); don't ship the full payload to the list
    res.json((data || []).map(({ payload, ...row }) => ({ ...row, source: submissionSource(payload) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Channel/source breakdown across a form's submissions (which channel drove the most).
router.get('/source-summary', async (req, res) => {
  try {
    const form = (req.query.form || '').toString();
    const search = (req.query.search || '').toString().trim().slice(0, 100);
    const all = [], PAGE = 1000;
    for (let from = 0; from < 200000; from += PAGE) {
      let q = supabase.from('form_submissions').select('payload').order('created_at', { ascending: false });
      if (form) q = q.eq('form_key', form);
      if (search) q = q.or(`contact_name.ilike.*${search}*,contact_email.ilike.*${search}*`);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    const counts = {};
    for (const s of all) { const src = submissionSource(s.payload); counts[src] = (counts[src] || 0) + 1; }
    const total = all.length;
    const sources = Object.entries(counts).map(([source, count]) => ({ source, count, pct: total ? Math.round(count / total * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count);
    res.json({ total, sources });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/submissions/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('form_submissions').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Delete one submission, or all submissions for a form.
router.delete('/submissions/:id', async (req, res) => {
  try { const { error } = await supabase.from('form_submissions').delete().eq('id', req.params.id); if (error) throw error; res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/form/:key', async (req, res) => {
  try {
    const { error } = await supabase.from('form_submissions').delete().eq('form_key', req.params.key);
    if (error) throw error;
    await supabase.from('forms').delete().eq('form_key', req.params.key);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CSV export — all, by form, or by search. Columns = Form/Name/Email/Received +
// a column per distinct question across the exported set.
function toCsv(subs) {
  const cols = [], seen = new Set();
  for (const s of subs) for (const f of (s.fields || [])) if (!seen.has(f.q)) { seen.add(f.q); cols.push(f.q); }
  const esc = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [['Form', 'Name', 'Email', 'Received', ...cols].map(esc).join(',')];
  for (const s of subs) {
    const fm = {}; for (const f of (s.fields || [])) fm[f.q] = f.a;
    out.push([s.form_key || '', s.contact_name || '', s.contact_email || '', s.created_at || '', ...cols.map(q => fm[q] || '')].map(esc).join(','));
  }
  return out.join('\r\n');
}
router.get('/export', async (req, res) => {
  try {
    const form = (req.query.form || '').toString();
    const search = (req.query.search || '').toString().trim().slice(0, 100);
    let q = supabase.from('form_submissions').select('form_key, contact_name, contact_email, created_at, fields').order('created_at', { ascending: false }).limit(10000);
    if (form) q = q.eq('form_key', form);
    if (search) q = q.or(`contact_name.ilike.*${search}*,contact_email.ilike.*${search}*`);
    const { data, error } = await q;
    if (error) throw error;
    const fname = (form ? form.replace(/[^a-z0-9]+/gi, '-').slice(0, 50) : 'form-submissions') + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send('﻿' + toCsv(data || []));   // BOM for Excel
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Data Analysis: column picker + value breakdown ──────────────────────────
// Supabase caps responses at 1000 rows, so page through to get every submission.
async function fetchAllSubs(form, select) {
  const all = [], PAGE = 1000;
  for (let from = 0; from < 200000; from += PAGE) {
    let q = supabase.from('form_submissions').select(select).order('created_at', { ascending: false }).order('id', { ascending: false });
    if (form) q = q.eq('form_key', form);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Columns (questions) available for a form, with how many submissions answered each.
router.get('/columns', async (req, res) => {
  try {
    const form = (req.query.form || '').toString();
    if (!form) return res.status(400).json({ error: 'form required' });
    const subs = await fetchAllSubs(form, 'fields');
    const counts = new Map();
    for (const s of subs) {
      const seen = new Set();
      for (const f of (s.fields || [])) {
        if (!f || !f.q || seen.has(f.q)) continue;        // count one per submission
        if (f.a == null || String(f.a).trim() === '') continue;
        seen.add(f.q);
        counts.set(f.q, (counts.get(f.q) || 0) + 1);
      }
    }
    const columns = [...counts.entries()].map(([q, count]) => ({ q, count })).sort((a, b) => b.count - a.count || a.q.localeCompare(b.q));
    res.json({ columns, submissions: subs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Value distribution for one column across a form's submissions.
router.get('/breakdown', async (req, res) => {
  try {
    const form = (req.query.form || '').toString();
    const column = (req.query.column || '').toString();
    if (!form || !column) return res.status(400).json({ error: 'form and column required' });
    const subs = await fetchAllSubs(form, 'fields');
    const tally = new Map();
    let answered = 0;
    for (const s of subs) {
      let val = null;                                   // first non-empty answer → one value per person (pct never exceeds 100)
      for (const f of (s.fields || [])) if (f && f.q === column && f.a != null && String(f.a).trim() !== '') { val = String(f.a).trim(); break; }
      if (val == null) continue;
      answered++;
      tally.set(val, (tally.get(val) || 0) + 1);
    }
    const values = [...tally.entries()]
      .map(([value, count]) => ({ value, count, pct: answered ? Math.round(count / answered * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    res.json({ column, submissions: subs.length, answered, distinct: values.length, values });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Recent submissions with full payload — the "test / inspect a new webhook" view.
router.get('/recent', async (req, res) => {
  try {
    const { data, error } = await supabase.from('form_submissions').select('id, webhook_id, form_key, contact_name, contact_email, payload, fields, created_at').order('created_at', { ascending: false }).limit(25);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Public receiver: external software POSTs form data here ──────────────────
hook.get('/:token', (req, res) => res.json({ ok: true, message: 'Webhook is live. Send a POST with the form submission (JSON) to this URL.' }));
hook.post('/:token', async (req, res) => {
  try {
    const { data: wh } = await supabase.from('webhooks').select('id, name, token').eq('token', req.params.token).single();
    if (!wh) return res.status(404).json({ error: 'Unknown webhook' });

    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = { value: payload }; } }
    if (!payload || typeof payload !== 'object') payload = {};
    if (!Object.keys(payload).length && req.query && Object.keys(req.query).length) payload = { ...req.query };

    const formKey = findFormKey(payload, wh.name || `webhook-${wh.token.slice(0, 6)}`);
    const row = {
      webhook_id: wh.id,
      form_key: formKey,
      contact_name: findName(payload) || null,
      contact_email: (findEmail(payload) || '').toLowerCase() || null,
      payload,
      fields: flattenFields(payload),
    };
    const { error } = await supabase.from('form_submissions').insert(row);
    if (error) throw error;
    await supabase.from('webhooks').update({ last_fired_at: new Date().toISOString() }).eq('id', wh.id);
    res.json({ ok: true });
  } catch (err) { console.error('Webhook capture error:', err.message); res.status(500).json({ error: err.message }); }
});

module.exports = { router, hook, _test: { findEmail, findName, findFormKey, flattenFields } };
