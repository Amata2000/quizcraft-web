'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";

// ── UTILS ─────────────────────────────────────────────────────────────────────
const uid      = () => Math.random().toString(36).slice(2, 11);
const mkCode   = () => Array.from({length:6}, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const hashPw   = s => btoa(unescape(encodeURIComponent(s + "__qc_salt_v3__")));
const pad2     = n => String(n).padStart(2, "0");
const fmtDT    = d => new Date(d).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
const gradeLabel = p => p >= 90 ? "A" : p >= 75 ? "B" : p >= 60 ? "C" : "D";
const gradeColor = g => ({ A:"#2d7a4f", B:"#c8871a", C:"#856404", D:"#c0392b" }[g]);
const shuffle  = arr => [...arr].sort(() => Math.random() - 0.5);
const optLetter = i => String.fromCharCode(65 + i);

// ── SUPABASE STORAGE LAYER ────────────────────────────────────────────────────
// Replaces the old window.storage calls (sg / ss / sdel).
// Each function maps to a Supabase table operation.

// ── Admin ─────────────────────────────────────────────────
async function getAdmin() {
  const { data } = await supabase.from('admin').select('*').eq('id','admin').single();
  if (!data) return null;
  return { id:data.id, username:data.username, passwordHash:data.password_hash, role:data.role, createdAt:data.created_at };
}
async function saveAdmin(admin) {
  await supabase.from('admin').upsert({
    id: 'admin', username: admin.username,
    password_hash: admin.passwordHash, role: 'admin',
    created_at: admin.createdAt,
  });
}

// ── Teachers ──────────────────────────────────────────────
async function getTeachers() {
  const { data } = await supabase.from('teachers').select('*').order('created_at');
  return (data || []).map(t => ({
    id:t.id, name:t.name, username:t.username,
    passwordHash:t.password_hash, role:'teacher', createdAt:t.created_at,
  }));
}
async function upsertTeacher(t) {
  await supabase.from('teachers').upsert({
    id:t.id, name:t.name, username:t.username,
    password_hash:t.passwordHash, role:'teacher', created_at:t.createdAt,
  });
}
async function deleteTeacherById(id) {
  await supabase.from('teachers').delete().eq('id', id);
}

// ── Quizzes ───────────────────────────────────────────────
// We store the full questions array as JSONB in the `questions` column.
function quizToRow(q) {
  return {
    id:             q.id,
    code:           q.code,
    title:          q.title,
    subject:        q.subject || '',
    description:    q.description || '',
    time_limit:     q.timeLimit || 0,
    available_from: q.availableFrom || null,
    available_to:   q.availableTo   || null,
    shuffle_q:      q.shuffleQ    || false,
    shuffle_opts:   q.shuffleOpts || false,
    max_attempts:   q.maxAttempts || 0,
    show_results:   q.showResults !== false,
    password:       q.password || null,
    active:         q.active !== false,
    questions:      q.questions || [],
    created_by:     q.createdBy     || null,
    created_by_role:q.createdByRole || null,
    created_by_name:q.createdByName || null,
    created_at:     q.createdAt || new Date().toISOString(),
  };
}
function rowToQuiz(r) {
  return {
    id:           r.id,
    code:         r.code,
    title:        r.title,
    subject:      r.subject,
    description:  r.description,
    timeLimit:    r.time_limit,
    availableFrom:r.available_from,
    availableTo:  r.available_to,
    shuffleQ:     r.shuffle_q,
    shuffleOpts:  r.shuffle_opts,
    maxAttempts:  r.max_attempts,
    showResults:  r.show_results,
    password:     r.password,
    active:       r.active,
    questions:    r.questions || [],
    createdBy:    r.created_by,
    createdByRole:r.created_by_role,
    createdByName:r.created_by_name,
    createdAt:    r.created_at,
  };
}
async function getQuizzes() {
  const { data } = await supabase.from('quizzes').select('*').order('created_at');
  return (data || []).map(rowToQuiz);
}
async function upsertQuiz(quiz) {
  await supabase.from('quizzes').upsert(quizToRow(quiz));
}
async function deleteQuizById(id) {
  await supabase.from('quizzes').delete().eq('id', id);
}
async function toggleQuizActive(id, currentActive) {
  await supabase.from('quizzes').update({ active: !currentActive }).eq('id', id);
}

// ── Submissions ───────────────────────────────────────────
function subToRow(s) {
  return {
    id:            s.id,
    quiz_id:       s.quizId,
    student_name:  s.studentName,
    student_email: s.studentEmail || null,
    answers:       s.answers || {},
    score:         s.score   || {},
    submitted_at:  s.submittedAt || new Date().toISOString(),
  };
}
function rowToSub(r) {
  return {
    id:           r.id,
    quizId:       r.quiz_id,
    studentName:  r.student_name,
    studentEmail: r.student_email,
    answers:      r.answers || {},
    score:        r.score   || {},
    submittedAt:  r.submitted_at,
  };
}
async function getSubmissions() {
  const { data } = await supabase.from('submissions').select('*').order('submitted_at', { ascending:false });
  return (data || []).map(rowToSub);
}
async function insertSubmission(sub) {
  await supabase.from('submissions').insert(subToRow(sub));
}

// ── Quiz attempt autosave ─────────────────────────────────
async function saveAttempt(quizId, data) {
  await supabase.from('quiz_attempts').upsert({
    quiz_id:        quizId,
    student_name:   data.studentName  || '',
    student_email:  data.studentEmail || null,
    answers:        data.answers      || {},
    question_order: data.questionOrder || [],
    saved_at:       new Date().toISOString(),
  });
}
async function loadAttempt(quizId) {
  // We can't key by student name before they've entered it,
  // so we load the most recent attempt for this quiz from this browser.
  // We store the student name in session storage as a lightweight hint.
  const name = (typeof window !== 'undefined' && sessionStorage.getItem(`qc-attempt-name-${quizId}`)) || '';
  if (!name) return null;
  const { data } = await supabase.from('quiz_attempts')
    .select('*').eq('quiz_id', quizId).eq('student_name', name).single();
  if (!data) return null;
  return { studentName:data.student_name, studentEmail:data.student_email, answers:data.answers, questionOrder:data.question_order };
}
async function clearAttempt(quizId) {
  const name = (typeof window !== 'undefined' && sessionStorage.getItem(`qc-attempt-name-${quizId}`)) || '';
  if (name) {
    await supabase.from('quiz_attempts').delete().eq('quiz_id', quizId).eq('student_name', name);
    sessionStorage.removeItem(`qc-attempt-name-${quizId}`);
  }
}
function markAttemptName(quizId, name) {
  if (typeof window !== 'undefined') sessionStorage.setItem(`qc-attempt-name-${quizId}`, name);
}

// ── Session (browser only, sessionStorage) ────────────────
function getSession() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(sessionStorage.getItem('qc-session') || 'null'); } catch { return null; }
}
function saveSession(sess) {
  if (typeof window !== 'undefined') sessionStorage.setItem('qc-session', JSON.stringify(sess));
}
function clearSession() {
  if (typeof window !== 'undefined') sessionStorage.removeItem('qc-session');
}

// ── SCORING ───────────────────────────────────────────────────────────────────
function scoreQuiz(questions, answers) {
  let earned = 0, total = 0;
  const details = questions.map(q => {
    const pts = q.points || 1; total += pts;
    const ua = answers[q.id]; let ok = false;
    if (q.type === "mc")      ok = ua === q.correctAnswer;
    else if (q.type === "tf") ok = String(ua) === String(q.correctAnswer);
    else ok = String(ua||"").toLowerCase().trim() === String(q.correctAnswer||"").toLowerCase().trim();
    if (ok) earned += pts;
    return { qid:q.id, ok, ua, ca:q.correctAnswer, pts };
  });
  return { earned, total, pct: total ? Math.round(earned/total*100) : 0, details };
}

// ── EXCEL PARSER ──────────────────────────────────────────────────────────────
let _xl = null;
const getXL = () => new Promise((res, rej) => {
  if (_xl) return res(_xl);
  if (typeof window !== 'undefined' && window.XLSX) { _xl = window.XLSX; return res(_xl); }
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  s.onload = () => { _xl = window.XLSX; res(_xl); };
  s.onerror = () => rej(new Error("Failed to load SheetJS."));
  document.head.appendChild(s);
});

function parseExcel(rows) {
  const errors = [], questions = [];
  if (!rows || rows.length < 2) return { questions:[], errors:["File appears empty or has no data rows."] };
  const header = (rows[0] || []).map(h => String(h||"").toLowerCase().trim());
  const REQUIRED = ["question","option a","option b","option c","option d","correct answer"];
  const missingCols = REQUIRED.filter(c => !header.some(h => h.includes(c.split(" ")[0])));
  if (missingCols.length) return { questions:[], errors:[`Missing columns: ${missingCols.join(", ")}.`] };
  const colQ   = header.findIndex(h => h.includes("question"));
  const colOA  = header.findIndex(h => h.includes("option") && h.includes("a"));
  const colOB  = header.findIndex(h => h.includes("option") && h.includes("b"));
  const colOC  = header.findIndex(h => h.includes("option") && h.includes("c"));
  const colOD  = header.findIndex(h => h.includes("option") && h.includes("d"));
  const colAns = header.findIndex(h => h.includes("correct"));
  rows.slice(1).forEach((row, i) => {
    const rn = i+2;
    const text = String(row[colQ]??row[0]??"").trim();
    if (!text) return;
    const opts = [String(row[colOA]??row[1]??"").trim(),String(row[colOB]??row[2]??"").trim(),String(row[colOC]??row[3]??"").trim(),String(row[colOD]??row[4]??"").trim()];
    const ans  = String(row[colAns]??row[5]??"").trim().toUpperCase();
    const rowErrs = [];
    opts.forEach((o,j) => { if (!o) rowErrs.push(`Row ${rn}: Option ${optLetter(j)} is empty`); });
    if (!ans||ans.length!==1||!"ABCD".includes(ans)) rowErrs.push(`Row ${rn}: Correct answer "${ans}" is invalid`);
    rowErrs.forEach(e => errors.push(e));
    questions.push({ id:uid(), type:"mc", text, image:null, options:opts, correctAnswer:"ABCD".indexOf(ans)>=0?"ABCD".indexOf(ans):0, points:1, _hasErr:rowErrs.length>0 });
  });
  if (!questions.length) errors.push("No valid questions found.");
  return { questions, errors };
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,500;0,700;1,300&family=Outfit:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f4f1ec;--bg2:#ece8e1;--sur:#fff;--bdr:#d9d4cc;--txt:#1a1814;--txt2:#6a6560;
  --amb:#c8871a;--amb-l:#fdf2e0;--amb-d:#a06a0e;
  --nvy:#1c2b3a;--nvy2:#253547;
  --grn:#2a7a4a;--grn-l:#e6f5ec;
  --red:#c0392b;--red-l:#fde8e6;
  --pur:#6c3fbb;--pur-l:#f0ebff;
  --rad:10px;--shd:0 2px 12px rgba(0,0,0,.08);--shd-lg:0 8px 32px rgba(0,0,0,.13);
  --fnt:'Outfit',sans-serif;--fnt-s:'Fraunces',serif;
}
body{font-family:var(--fnt);background:var(--bg);color:var(--txt);min-height:100vh;font-size:15px}
h1,h2,h3{font-family:var(--fnt-s);font-weight:500;letter-spacing:-0.03em}
input,select,textarea,button{font-family:var(--fnt)}
.topnav{background:var(--nvy);height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;position:sticky;top:0;z-index:200;box-shadow:0 2px 16px rgba(0,0,0,.25)}
.brand{font-family:var(--fnt-s);font-size:1.25rem;color:#fff}.brand span{color:var(--amb)}
.nav-tabs{display:flex;gap:4px}
.ntab{padding:6px 16px;border-radius:6px;border:none;cursor:pointer;font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:6px;transition:.15s;background:transparent;color:rgba(255,255,255,.55)}
.ntab:hover{background:rgba(255,255,255,.08);color:#fff}
.ntab.on{background:var(--amb);color:#fff}
.page{max-width:960px;margin:0 auto;padding:2rem 1.25rem}
.page-wide{max-width:1160px;margin:0 auto;padding:2rem 1.25rem}
.ph{margin-bottom:1.75rem}.ph h1{font-size:1.8rem;line-height:1.2}.ph p{color:var(--txt2);margin-top:5px;font-size:.9rem}
.row{display:flex;gap:1rem}.row>*{flex:1}
.col2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.col3{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
.col4{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}
@media(max-width:680px){.col2,.col3,.col4{grid-template-columns:1fr}.row{flex-direction:column}}
.card{background:var(--sur);border:1px solid var(--bdr);border-radius:var(--rad);box-shadow:var(--shd)}
.card-hd{padding:1rem 1.25rem;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
.card-hd h3{font-size:.95rem;font-weight:600;font-family:var(--fnt)}
.card-bd{padding:1.25rem}
.stat-card{background:var(--sur);border:1px solid var(--bdr);border-radius:var(--rad);padding:1.25rem 1.4rem;box-shadow:var(--shd)}
.stat-val{font-family:var(--fnt-s);font-size:2.2rem;font-weight:700;line-height:1;margin-top:.3rem}
.stat-lbl{font-size:.82rem;color:var(--txt2);margin-top:4px}
.stat-icon{font-size:1.4rem}
.fg{margin-bottom:1.1rem}
.lbl{display:block;font-size:.83rem;font-weight:600;margin-bottom:5px;color:var(--txt)}
.inp,.sel,.ta{width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:7px;font-size:.88rem;background:var(--sur);color:var(--txt);outline:none;transition:.15s}
.inp:focus,.sel:focus,.ta:focus{border-color:var(--amb);box-shadow:0 0 0 3px rgba(200,135,26,.1)}
.ta{resize:vertical;min-height:72px}
.hint{font-size:.77rem;color:var(--txt2);margin-top:4px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:.85rem;font-weight:600;transition:.15s;white-space:nowrap;text-decoration:none}
.btn-pri{background:var(--amb);color:#fff}.btn-pri:hover{background:var(--amb-d)}
.btn-nvy{background:var(--nvy);color:#fff}.btn-nvy:hover{background:var(--nvy2)}
.btn-sec{background:var(--bg2);color:var(--txt);border:1px solid var(--bdr)}.btn-sec:hover{background:var(--bdr)}
.btn-grn{background:var(--grn);color:#fff}.btn-grn:hover{background:#235f3b}
.btn-red{background:var(--red-l);color:var(--red);border:1px solid #f5c6c2}.btn-red:hover{background:var(--red);color:#fff}
.btn-ghost{background:transparent;color:var(--txt2)}.btn-ghost:hover{background:var(--bg2);color:var(--txt)}
.btn-sm{padding:5px 12px;font-size:.8rem}
.btn-ico{padding:7px;border-radius:6px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:20px;font-size:.75rem;font-weight:600}
.badge-grn{background:var(--grn-l);color:var(--grn)}
.badge-red{background:var(--red-l);color:var(--red)}
.badge-nvy{background:#e8ecf0;color:var(--nvy)}
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt2);padding:10px 12px;border-bottom:2px solid var(--bdr);background:var(--bg)}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--bdr);font-size:.88rem;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:var(--bg)}
.admin-layout{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 56px)}
@media(max-width:720px){.admin-layout{grid-template-columns:1fr;grid-template-rows:auto 1fr}}
.sidebar{background:var(--nvy);padding:1rem 0;position:sticky;top:56px;height:calc(100vh - 56px);overflow-y:auto}
@media(max-width:720px){.sidebar{position:relative;height:auto;display:flex;flex-wrap:wrap;gap:2px;padding:.5rem}}
.sidebar-item{display:flex;align-items:center;gap:10px;padding:10px 20px;cursor:pointer;color:rgba(255,255,255,.55);font-size:.88rem;font-weight:500;transition:.15s;border-left:3px solid transparent}
.sidebar-item:hover{color:#fff;background:rgba(255,255,255,.06)}
.sidebar-item.on{color:#fff;background:rgba(200,135,26,.18);border-left-color:var(--amb)}
@media(max-width:720px){.sidebar-item{padding:7px 12px;border-left:none;border-radius:6px;font-size:.82rem}}
.sidebar-section{padding:14px 20px 5px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.28)}
@media(max-width:720px){.sidebar-section{display:none}}
.admin-content{overflow-y:auto;min-height:0}
.q-item{display:flex;gap:.75rem;align-items:flex-start;padding:1rem;border:1.5px solid var(--bdr);border-radius:9px;margin-bottom:.65rem;background:var(--bg);transition:.15s}
.q-item:hover{border-color:var(--amb)}
.q-num{width:28px;height:28px;border-radius:50%;background:var(--nvy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.78rem;font-weight:700;flex-shrink:0;margin-top:1px}
.q-body{flex:1}
.q-text{font-weight:500;font-size:.9rem;line-height:1.4;margin-bottom:5px}
.q-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.type-pill{font-size:.72rem;padding:2px 8px;border-radius:4px;background:var(--bg2);color:var(--txt2);font-weight:600}
.opt-row{display:flex;gap:7px;align-items:center;margin-bottom:7px}
.opt-ltr{width:30px;height:30px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0;cursor:pointer;transition:.15s;color:var(--txt2);border:none}
.opt-ltr.sel{background:var(--amb);color:#fff}
.quiz-shell{display:grid;grid-template-columns:1fr 220px;gap:1.5rem;align-items:start}
@media(max-width:700px){.quiz-shell{grid-template-columns:1fr}}
.q-card{background:var(--sur);border:1.5px solid var(--bdr);border-radius:12px;padding:1.5rem;margin-bottom:1rem;box-shadow:var(--shd);transition:.2s}
.q-card.answered{border-color:#b8dbc8}
.q-card-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
.q-num-circle{width:30px;height:30px;border-radius:50%;background:var(--nvy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700;flex-shrink:0}
.q-card.answered .q-num-circle{background:var(--grn)}
.q-card-text{font-family:var(--fnt-s);font-size:1.15rem;line-height:1.45;margin-bottom:1.25rem}
.mc-opt{display:flex;align-items:center;gap:10px;padding:12px 14px;border:2px solid var(--bdr);border-radius:9px;cursor:pointer;transition:.15s;background:var(--sur);margin-bottom:8px;user-select:none}
.mc-opt:hover{border-color:var(--amb);background:var(--amb-l)}
.mc-opt.sel{border-color:var(--amb);background:var(--amb-l)}
.mc-opt-l{width:30px;height:30px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700;flex-shrink:0;transition:.15s}
.mc-opt.sel .mc-opt-l{background:var(--amb);color:#fff}
.tf-opts{display:flex;gap:10px}
.tf-opt{flex:1;padding:14px;border:2px solid var(--bdr);border-radius:9px;cursor:pointer;text-align:center;font-weight:700;font-size:.95rem;transition:.15s;background:var(--sur);user-select:none}
.tf-opt:hover{border-color:var(--amb);background:var(--amb-l)}
.tf-opt.sel{border-color:var(--amb);background:var(--amb-l);color:var(--amb-d)}
.mc-opt.r-ok{border-color:var(--grn);background:var(--grn-l);cursor:default}
.mc-opt.r-ok .mc-opt-l{background:var(--grn);color:#fff}
.mc-opt.r-no{border-color:var(--red);background:var(--red-l);cursor:default}
.mc-opt.r-no .mc-opt-l{background:var(--red);color:#fff}
.tf-opt.r-ok{border-color:var(--grn);background:var(--grn-l);color:var(--grn);cursor:default}
.tf-opt.r-no{border-color:var(--red);background:var(--red-l);color:var(--red);cursor:default}
.r-note{display:flex;align-items:center;gap:6px;font-size:.82rem;font-weight:600;padding:8px 12px;border-radius:6px;margin-top:8px}
.r-note.ok{background:var(--grn-l);color:var(--grn)}
.r-note.no{background:var(--red-l);color:var(--red)}
.status-sidebar{background:var(--sur);border:1px solid var(--bdr);border-radius:12px;padding:1rem;box-shadow:var(--shd);position:sticky;top:80px}
.status-sidebar h4{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--txt2);margin-bottom:.75rem}
.q-dots{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:.75rem}
.qdot{width:30px;height:30px;border-radius:6px;border:1.5px solid var(--bdr);background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;cursor:pointer;transition:.15s;color:var(--txt2)}
.qdot:hover{border-color:var(--amb)}
.qdot.done{background:var(--grn);border-color:var(--grn);color:#fff}
.timer-wrap{background:var(--nvy);color:#fff;text-align:center;padding:9px 1rem;position:sticky;top:56px;z-index:100;display:flex;align-items:center;justify-content:center;gap:10px;font-size:.9rem;font-weight:600}
.timer-wrap.warn{background:#b83c10;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.8}}
.timer-dig{font-family:var(--fnt-s);font-size:1.2rem;letter-spacing:.1em;min-width:58px;text-align:center}
.autosave-bar{background:var(--grn-l);color:var(--grn);text-align:center;font-size:.78rem;font-weight:600;padding:4px;display:flex;align-items:center;justify-content:center;gap:5px}
.score-hero{text-align:center;padding:2.5rem 1.5rem 2rem}
.score-gauge-wrap{position:relative;display:inline-flex;align-items:center;justify-content:center;margin-bottom:1.25rem}
.score-gauge-svg{transform:rotate(-90deg)}
.score-gauge-track{fill:none;stroke:var(--bg2);stroke-width:10}
.score-gauge-fill{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)}
.score-gauge-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.score-pct-big{font-family:var(--fnt-s);font-size:2.6rem;font-weight:700;line-height:1}
.score-raw{font-size:.85rem;color:var(--txt2);font-weight:600}
.score-grade-badge{display:inline-flex;align-items:center;gap:8px;padding:7px 20px;border-radius:30px;font-family:var(--fnt-s);font-size:1.1rem;font-weight:600;margin-bottom:.75rem}
.score-message{color:var(--txt2);font-size:.9rem;line-height:1.5;max-width:300px;margin:0 auto}
.score-stats-row{display:flex;gap:1rem;justify-content:center;margin-top:1.5rem;flex-wrap:wrap}
.score-stat-chip{background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:.6rem 1.1rem;text-align:center;min-width:90px}
.score-stat-chip .val{font-family:var(--fnt-s);font-size:1.3rem;font-weight:700;line-height:1}
.score-stat-chip .lbl{font-size:.72rem;color:var(--txt2);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.bar-row{display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem;font-size:.85rem}
.bar-label{width:200px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--txt2)}
.bar-track{flex:1;background:var(--bg2);border-radius:4px;height:10px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;background:var(--amb);transition:width .5s}
.bar-fill.low{background:var(--red)}
.bar-pct{width:38px;text-align:right;font-weight:600;flex-shrink:0}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:1rem}
.modal{background:var(--sur);border-radius:14px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.2);animation:mIn .2s ease}
@keyframes mIn{from{opacity:0;transform:scale(.96) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
.mhd{padding:1.1rem 1.4rem;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between}
.mhd h3{font-size:1.1rem;font-weight:500;font-family:var(--fnt-s)}
.mbd{padding:1.4rem}
.mft{padding:.9rem 1.4rem;border-top:1px solid var(--bdr);display:flex;justify-content:flex-end;gap:8px}
.code-entry{max-width:440px;margin:0 auto;padding:3rem 1.5rem;text-align:center}
.code-input{font-family:var(--fnt-s);font-size:1.4rem;text-align:center;letter-spacing:.25em;border:2.5px solid var(--bdr);border-radius:12px;padding:1rem;width:100%;outline:none;transition:.2s;background:var(--sur);text-transform:uppercase}
.code-input:focus{border-color:var(--amb);box-shadow:0 0 0 4px rgba(200,135,26,.12)}
.quiz-lp{max-width:580px;margin:0 auto;padding:2rem 1.25rem}
.ql-header{background:var(--nvy);color:#fff;border-radius:14px;padding:2rem;margin-bottom:1.5rem}
.ql-header h1{color:#fff;font-size:1.8rem}
.ql-subj{color:rgba(255,255,255,.6);font-size:.9rem;margin-top:4px}
.meta-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:1rem}
.meta-chip{background:rgba(255,255,255,.12);border-radius:20px;padding:4px 12px;font-size:.8rem;font-weight:500;display:flex;align-items:center;gap:5px}
.auth-wrap{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 56px);padding:1rem;background:var(--bg)}
.auth-box{background:var(--sur);border:1px solid var(--bdr);border-radius:16px;padding:2.5rem;width:100%;max-width:400px;box-shadow:var(--shd-lg)}
.auth-logo{text-align:center;margin-bottom:1.75rem}
.auth-logo h2{font-size:1.6rem;color:var(--nvy)}
.auth-logo p{color:var(--txt2);font-size:.88rem;margin-top:5px}
.role-pill{display:flex;gap:4px;background:var(--bg2);border-radius:8px;padding:4px;margin-bottom:1.25rem}
.role-btn{flex:1;padding:8px;border:none;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:600;transition:.15s;background:transparent;color:var(--txt2)}
.role-btn.on{background:var(--sur);color:var(--txt);box-shadow:0 1px 4px rgba(0,0,0,.1)}
.admin-role-btn.on{color:var(--red)}
.teacher-role-btn.on{color:var(--pur)}
.err-box{background:var(--red-l);color:var(--red);padding:10px 14px;border-radius:8px;font-size:.85rem;font-weight:600;margin-bottom:1rem}
.ok-box{background:var(--grn-l);color:var(--grn);padding:10px 14px;border-radius:8px;font-size:.85rem;font-weight:600;margin-bottom:1rem}
.empty{text-align:center;padding:3.5rem 1.5rem;color:var(--txt2)}
.empty .ei{font-size:2.5rem;opacity:.35;margin-bottom:.75rem}
.empty h3{color:var(--txt);font-size:1.1rem;margin-bottom:.4rem}
.img-prev{max-width:100%;max-height:180px;border-radius:8px;object-fit:contain;margin-top:8px;border:1px solid var(--bdr)}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bdr)}
.toggle-row:last-child{border-bottom:none}
.toggle{width:44px;height:24px;border-radius:12px;background:var(--bdr);cursor:pointer;position:relative;transition:.2s;flex-shrink:0;border:none;outline:none}
.toggle.on{background:var(--amb)}
.toggle::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s}
.toggle.on::after{left:23px}
.excel-drop{border:2.5px dashed var(--bdr);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:.2s;background:var(--bg)}
.excel-drop:hover{border-color:var(--amb);background:var(--amb-l)}
.excel-drop input{display:none}
.err-list{background:var(--red-l);border:1px solid #f5c6c2;border-radius:8px;padding:.75rem 1rem;margin-top:.75rem}
.err-list li{font-size:.82rem;color:var(--red);margin-bottom:3px;font-weight:600}
.preview-tbl{width:100%;border-collapse:collapse;font-size:.82rem}
.preview-tbl th{background:var(--bg);padding:6px 10px;text-align:left;font-weight:700;border:1px solid var(--bdr)}
.preview-tbl td{padding:6px 10px;border:1px solid var(--bdr)}
.preview-tbl tr.has-err td{background:#fff0ee}
.confirm-wrap{max-width:480px;margin:3rem auto;text-align:center;padding:0 1.25rem}
.confirm-icon{font-size:4rem;margin-bottom:1rem}
.resume-banner{background:var(--amb-l);border:1.5px solid var(--amb);border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
.readonly-notice{background:var(--pur-l);border:1.5px solid #d3c2f5;border-radius:8px;padding:.75rem 1rem;font-size:.85rem;color:var(--pur);font-weight:600;display:flex;align-items:center;gap:8px;margin-bottom:1rem}
.share-chip{display:inline-flex;align-items:center;gap:8px;background:var(--amb-l);border:1.5px solid var(--amb);border-radius:8px;padding:5px 10px 5px 12px;font-family:monospace;font-size:.95rem;font-weight:700;letter-spacing:.18em;color:var(--amb-d);cursor:pointer;transition:.15s;user-select:none}
.share-chip:hover{background:var(--amb);color:#fff}
.share-chip .copy-btn{background:rgba(0,0,0,.08);border:none;border-radius:5px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.15s;color:inherit;flex-shrink:0}
.copy-toast{position:fixed;bottom:1.5rem;right:1.5rem;background:var(--nvy);color:#fff;padding:9px 16px;border-radius:9px;font-size:.85rem;font-weight:600;z-index:9999;animation:toastIn .2s ease,toastOut .3s ease 1.7s forwards;display:flex;align-items:center;gap:7px}
@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes toastOut{to{opacity:0;transform:translateY(8px)}}
.active-toggle-wrap{display:flex;align-items:center;gap:8px}
.active-toggle{width:40px;height:22px;border-radius:11px;background:var(--bdr);cursor:pointer;position:relative;transition:.2s;flex-shrink:0;border:none;outline:none}
.active-toggle.on{background:var(--grn)}
.active-toggle::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s}
.active-toggle.on::after{left:21px}
.active-lbl{font-size:.78rem;font-weight:700;color:var(--txt2)}
.active-lbl.on{color:var(--grn)}
.duration-row{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.duration-row .inp{width:72px;text-align:center}
.duration-sep{font-weight:600;color:var(--txt2);font-size:.88rem}
`;

// ── ICONS ─────────────────────────────────────────────────────────────────────
const I = {
  Home:   () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Quiz:   () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Chart:  () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Users:  () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Plus:   () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Trash:  () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
  Edit:   () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Back:   () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>,
  X:      () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check:  () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  Copy:   () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Upload: () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>,
  Dl:     () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>,
  Clock:  () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Logout: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Img:    () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Key:    () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  Save:   () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  Shield: () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Person: () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Lock:   () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
};

// ── SMALL SHARED COMPONENTS ───────────────────────────────────────────────────
function CopyToast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t); }, []);
  return <div className="copy-toast"><I.Check /> {msg}</div>;
}

function ScoreGauge({ pct, earned, total, size = 160 }) {
  const g = gradeLabel(pct);
  const color = gradeColor(g);
  const r = (size/2) - 14;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct/100) * circ;
  const msg = pct>=90?"Outstanding! 🎉":pct>=75?"Well done! Keep it up.":pct>=60?"Good effort. Review the missed questions.":"Keep practising — you'll get there!";
  return (
    <div className="score-hero">
      <div className="score-gauge-wrap" style={{ width:size, height:size }}>
        <svg className="score-gauge-svg" width={size} height={size}>
          <circle className="score-gauge-track" cx={size/2} cy={size/2} r={r} />
          <circle className="score-gauge-fill" cx={size/2} cy={size/2} r={r} stroke={color} strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} />
        </svg>
        <div className="score-gauge-inner">
          <div className="score-pct-big" style={{ color }}>{pct}%</div>
          <div className="score-raw">{earned}/{total} pts</div>
        </div>
      </div>
      <div className="score-grade-badge" style={{ background:color+"1a", color }}>Grade {g}</div>
      <div className="score-message">{msg}</div>
      <div className="score-stats-row">
        <div className="score-stat-chip"><div className="val" style={{ color }}>{pct}%</div><div className="lbl">Score</div></div>
        <div className="score-stat-chip"><div className="val">{earned}</div><div className="lbl">Earned</div></div>
        <div className="score-stat-chip"><div className="val">{total}</div><div className="lbl">Total</div></div>
        <div className="score-stat-chip"><div className="val" style={{ color }}>{g}</div><div className="lbl">Grade</div></div>
      </div>
    </div>
  );
}

function ShareCodeChip({ code, onCopy }) {
  return (
    <div className="share-chip" onClick={() => onCopy(code)}>
      {code}<span className="copy-btn"><I.Copy /></span>
    </div>
  );
}

function ActiveToggle({ active, onChange }) {
  return (
    <div className="active-toggle-wrap">
      <button className={`active-toggle${active?" on":""}`} onClick={() => onChange(!active)} />
      <span className={`active-lbl${active?" on":""}`}>{active?"Active":"Inactive"}</span>
    </div>
  );
}

const toHM = m => ({ h:Math.floor(m/60), m:m%60 });
const fromHM = (h,m) => (parseInt(h)||0)*60+(parseInt(m)||0);
function DurationInput({ value, onChange, disabled }) {
  const { h, m } = toHM(value||0);
  return (
    <div className="duration-row">
      <input type="number" className="inp" min={0} max={23} value={h} onChange={e=>onChange(fromHM(e.target.value,m))} disabled={disabled} placeholder="0" />
      <span className="duration-sep">hr</span>
      <input type="number" className="inp" min={0} max={59} value={m} onChange={e=>onChange(fromHM(h,e.target.value))} disabled={disabled} placeholder="0" />
      <span className="duration-sep">min</span>
      {value>0&&<span style={{ fontSize:".78rem",color:"var(--txt2)",fontStyle:"italic" }}>({value} min total)</span>}
      {value===0&&<span style={{ fontSize:".78rem",color:"var(--txt2)",fontStyle:"italic" }}>No limit</span>}
    </div>
  );
}

// ── QuestionModal ─────────────────────────────────────────────────────────────
function QuestionModal({ question, onSave, onClose }) {
  const blank = { id:uid(), type:"mc", text:"", image:null, options:["","","",""], correctAnswer:0, points:1 };
  const [q, setQ] = useState(question||blank);
  const up = (k,v) => setQ(p=>({...p,[k]:v}));
  const upOpt = (i,v) => { const o=[...(q.options||[])]; o[i]=v; up("options",o); };
  const setType = t => {
    const b={...q,type:t};
    if(t==="mc"){b.options=q.options||["","","",""];b.correctAnswer=0;}
    else if(t==="tf")b.correctAnswer="true";
    else b.correctAnswer="";
    setQ(b);
  };
  const handleImg = e => {
    const file=e.target.files[0];if(!file)return;
    const r=new FileReader();r.onload=ev=>up("image",ev.target.result);r.readAsDataURL(file);
  };
  const valid = q.text.trim()&&(q.type!=="mc"||(q.options||[]).every(o=>o.trim()))&&(q.type!=="short"||String(q.correctAnswer).trim());
  return (
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mhd"><h3>{question?"Edit Question":"Add Question"}</h3><button className="btn btn-ghost btn-ico" onClick={onClose}><I.X /></button></div>
        <div className="mbd">
          <div className="fg"><label className="lbl">Type</label>
            <select className="sel" value={q.type} onChange={e=>setType(e.target.value)}>
              <option value="mc">Multiple Choice</option><option value="tf">True / False</option><option value="short">Short Answer</option>
            </select>
          </div>
          <div className="fg"><label className="lbl">Question Text</label><textarea className="ta" placeholder="Enter question…" value={q.text} onChange={e=>up("text",e.target.value)} /></div>
          <div className="fg">
            <label className="lbl">Image (optional)</label>
            <label style={{ display:"flex",alignItems:"center",gap:8,cursor:"pointer" }}>
              <span className="btn btn-sec btn-sm"><I.Img /> Upload Image</span>
              <input type="file" accept="image/*" onChange={handleImg} style={{ display:"none" }} />
              {q.image&&<button className="btn btn-red btn-sm btn-ico" onClick={e=>{e.preventDefault();up("image",null);}}><I.Trash /></button>}
            </label>
            {q.image&&<img src={q.image} alt="" className="img-prev" />}
          </div>
          {q.type==="mc"&&(
            <div className="fg"><label className="lbl">Options — click letter to mark correct</label>
              {(q.options||["","","",""]).map((opt,i)=>(
                <div key={i} className="opt-row">
                  <button className={`opt-ltr${q.correctAnswer===i?" sel":""}`} onClick={()=>up("correctAnswer",i)}>{optLetter(i)}</button>
                  <input className="inp" placeholder={`Option ${optLetter(i)}`} value={opt} onChange={e=>upOpt(i,e.target.value)} />
                </div>
              ))}
            </div>
          )}
          {q.type==="tf"&&(
            <div className="fg"><label className="lbl">Correct Answer</label>
              <div className="tf-opts">
                {["true","false"].map(v=><div key={v} className={`tf-opt${q.correctAnswer===v?" sel":""}`} onClick={()=>up("correctAnswer",v)}>{v==="true"?"✓ True":"✗ False"}</div>)}
              </div>
            </div>
          )}
          {q.type==="short"&&(
            <div className="fg"><label className="lbl">Correct Answer</label>
              <input className="inp" placeholder="Accepted answer (case-insensitive)" value={q.correctAnswer} onChange={e=>up("correctAnswer",e.target.value)} />
              <p className="hint">Students must match this exactly (case-insensitive).</p>
            </div>
          )}
          <div className="fg" style={{ marginBottom:0 }}><label className="lbl">Points</label>
            <input type="number" className="inp" style={{ width:90 }} min={1} max={100} value={q.points} onChange={e=>up("points",Math.max(1,+e.target.value))} />
          </div>
        </div>
        <div className="mft">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={!valid} onClick={()=>valid&&onSave(q)}>{question?"Save":"Add Question"}</button>
        </div>
      </div>
    </div>
  );
}

// ── ExcelUploadModal ──────────────────────────────────────────────────────────
function ExcelUploadModal({ onImport, onClose }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const handleFile = async e => {
    const file=e.target.files[0];if(!file)return;
    setLoading(true);setLoadErr("");setResult(null);
    try {
      const XLSX=await getXL();const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];
      setResult(parseExcel(XLSX.utils.sheet_to_json(ws,{header:1,defval:""})));
    } catch(err){setLoadErr("Could not read file: "+err.message);}
    setLoading(false);
  };
  const valid=result&&result.questions.length>0&&result.errors.length===0;
  const warnOnly=result&&result.questions.length>0&&result.errors.length>0;
  const validOnly=result?result.questions.filter(q=>!q._hasErr):[];
  return (
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:680 }}>
        <div className="mhd"><h3>Import from Excel / CSV</h3><button className="btn btn-ghost btn-ico" onClick={onClose}><I.X /></button></div>
        <div className="mbd">
          <div style={{ background:"var(--bg)",border:"1px solid var(--bdr)",borderRadius:8,padding:".85rem 1rem",marginBottom:"1rem",fontSize:".83rem",lineHeight:1.7 }}>
            <strong>Required columns:</strong> Question | Option A | Option B | Option C | Option D | Correct Answer<br />
            <span style={{ color:"var(--txt2)" }}>Correct Answer must be A, B, C, or D.</span>
          </div>
          <label className="excel-drop"><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
            <div style={{ pointerEvents:"none" }}><div style={{ fontSize:"1.5rem",marginBottom:6 }}>📊</div><strong>Click to upload</strong><div style={{ color:"var(--txt2)",fontSize:".82rem",marginTop:4 }}>.xlsx · .xls · .csv</div></div>
          </label>
          {loading&&<p style={{ textAlign:"center",marginTop:12,color:"var(--txt2)" }}>⏳ Parsing…</p>}
          {loadErr&&<div className="err-box" style={{ marginTop:".75rem" }}>{loadErr}</div>}
          {result?.errors.length>0&&<ul className="err-list" style={{ marginTop:".75rem" }}>{result.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
          {result?.questions.length>0&&(
            <div style={{ marginTop:"1rem" }}>
              <p style={{ fontSize:".85rem",color:"var(--txt2)",marginBottom:".5rem" }}><strong>{result.questions.length}</strong> questions found</p>
              <div style={{ maxHeight:240,overflowY:"auto",border:"1px solid var(--bdr)",borderRadius:8 }}>
                <table className="preview-tbl"><thead><tr><th>#</th><th>Question</th><th>Correct</th></tr></thead>
                  <tbody>{result.questions.slice(0,12).map((q,i)=><tr key={i} className={q._hasErr?"has-err":""}><td>{i+1}</td><td>{q.text.slice(0,60)}{q.text.length>60?"…":""}</td><td><strong>{optLetter(q.correctAnswer)}</strong></td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="mft">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          {warnOnly&&validOnly.length>0&&<button className="btn btn-pri" onClick={()=>onImport(validOnly)}>Import {validOnly.length} valid</button>}
          {valid&&<button className="btn btn-grn" onClick={()=>onImport(result.questions)}>Import all {result.questions.length}</button>}
        </div>
      </div>
    </div>
  );
}

// ── QuizBuilderView ───────────────────────────────────────────────────────────
function QuizBuilderView({ quiz, currentUser, onSave, onBack, readOnly=false }) {
  const [meta, setMeta] = useState({
    title:quiz?.title||"",subject:quiz?.subject||"",description:quiz?.description||"",
    timeLimit:quiz?.timeLimit??0,availableFrom:quiz?.availableFrom||"",availableTo:quiz?.availableTo||"",
    shuffleQ:quiz?.shuffleQ??false,shuffleOpts:quiz?.shuffleOpts??false,
    maxAttempts:quiz?.maxAttempts??0,showResults:quiz?.showResults??true,
    password:quiz?.password||"",active:quiz?.active!==false,
  });
  const [questions,setQuestions]=useState(quiz?.questions||[]);
  const [qModal,setQModal]=useState(null);
  const [xlModal,setXlModal]=useState(false);
  const upM=(k,v)=>{if(readOnly)return;setMeta(p=>({...p,[k]:v}));};
  const saveQ=q=>{setQuestions(p=>qModal==="new"?[...p,q]:p.map(x=>x.id===q.id?q:x));setQModal(null);};
  const deleteQ=id=>{if(readOnly)return;if(window.confirm("Delete this question?"))setQuestions(p=>p.filter(q=>q.id!==id));};
  const moveQ=(i,d)=>{if(readOnly)return;const a=[...questions],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setQuestions(a);};
  const totalPts=questions.reduce((s,q)=>s+(q.points||1),0);
  const canSave=!readOnly&&meta.title.trim()&&questions.length>0;
  const typeLabel={mc:"MCQ",tf:"T/F",short:"Short"};
  return (
    <>
      <div className="page">
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:"1.5rem" }}>
          <button className="btn btn-ghost btn-ico" onClick={onBack}><I.Back /></button>
          <div>
            <h1 style={{ fontSize:"1.5rem" }}>{readOnly?"View Quiz":quiz?"Edit Quiz":"New Quiz"}</h1>
            <p style={{ color:"var(--txt2)",fontSize:".85rem" }}>{readOnly?<span style={{ color:"var(--pur)",fontWeight:600 }}>Read-only</span>:<>Creating as <strong>{currentUser.username}</strong></>}</p>
          </div>
        </div>
        {readOnly&&<div className="readonly-notice"><I.Lock /> This quiz is locked. Only admins can edit.</div>}
        <div className="col2" style={{ marginBottom:"1.25rem" }}>
          <div className="card">
            <div className="card-hd"><h3>Quiz Details</h3></div>
            <div className="card-bd">
              <div className="fg"><label className="lbl">Title</label><input className="inp" value={meta.title} onChange={e=>upM("title",e.target.value)} disabled={readOnly} /></div>
              <div className="fg"><label className="lbl">Subject</label><input className="inp" value={meta.subject} onChange={e=>upM("subject",e.target.value)} disabled={readOnly} /></div>
              <div className="fg" style={{ marginBottom:0 }}><label className="lbl">Description</label><textarea className="ta" value={meta.description} onChange={e=>upM("description",e.target.value)} disabled={readOnly} /></div>
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>Settings</h3></div>
            <div className="card-bd">
              <div className="fg"><label className="lbl"><I.Clock /> Time Limit</label><DurationInput value={meta.timeLimit} onChange={v=>upM("timeLimit",v)} disabled={readOnly} /></div>
              <div className="fg"><label className="lbl">Available From</label><input type="datetime-local" className="inp" value={meta.availableFrom} onChange={e=>upM("availableFrom",e.target.value)} disabled={readOnly} /></div>
              <div className="fg"><label className="lbl">Available Until</label><input type="datetime-local" className="inp" value={meta.availableTo} onChange={e=>upM("availableTo",e.target.value)} disabled={readOnly} /></div>
              <div className="fg"><label className="lbl">Max Attempts (0=unlimited)</label><input type="number" className="inp" style={{ width:100 }} min={0} value={meta.maxAttempts} onChange={e=>upM("maxAttempts",Math.max(0,+e.target.value))} disabled={readOnly} /></div>
              <div className="fg" style={{ marginBottom:0 }}><label className="lbl"><I.Key /> Password (optional)</label><input className="inp" value={meta.password} onChange={e=>upM("password",e.target.value)} disabled={readOnly} placeholder="Leave blank for open access" /></div>
              <div style={{ marginTop:"1rem" }}>
                {[{k:"shuffleQ",l:"Shuffle question order"},{k:"shuffleOpts",l:"Shuffle answer options"},{k:"showResults",l:"Show results after submission"},{k:"active",l:"Quiz is active (visible to students)"}].map(({k,l})=>(
                  <div key={k} className="toggle-row">
                    <span style={{ fontSize:".88rem" }}>{l}</span>
                    <button className={`toggle${meta[k]?" on":""}`} onClick={()=>upM(k,!meta[k])} disabled={readOnly} style={k==="active"&&meta[k]?{background:"var(--grn)"}:{}} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <h3>Questions {questions.length>0&&<span style={{ fontFamily:"var(--fnt)",fontSize:".8rem",fontWeight:400,color:"var(--txt2)" }}>· {questions.length} · {totalPts} pts</span>}</h3>
            {!readOnly&&<div style={{ display:"flex",gap:8 }}><button className="btn btn-sec btn-sm" onClick={()=>setXlModal(true)}><I.Upload /> Excel</button><button className="btn btn-pri btn-sm" onClick={()=>setQModal("new")}><I.Plus /> Add</button></div>}
          </div>
          <div className="card-bd">
            {questions.length===0?<div className="empty" style={{ padding:"2rem" }}><div className="ei">📝</div><h3>No questions yet</h3>{!readOnly&&<button className="btn btn-pri" style={{ marginTop:"1rem" }} onClick={()=>setQModal("new")}><I.Plus /> Add Question</button>}</div>
            :questions.map((q,i)=>(
              <div key={q.id} className="q-item">
                <div className="q-num">{i+1}</div>
                <div className="q-body">
                  {q.image&&<img src={q.image} alt="" style={{ maxHeight:50,borderRadius:5,marginBottom:5,objectFit:"contain" }} />}
                  <div className="q-text">{q.text}</div>
                  <div className="q-meta"><span className="type-pill">{typeLabel[q.type]}</span><span style={{ fontSize:".75rem",color:"var(--txt2)" }}>{q.points} pt{q.points!==1?"s":""}</span></div>
                </div>
                {!readOnly&&<div style={{ display:"flex",gap:4,flexShrink:0 }}>
                  <button className="btn btn-ghost btn-ico btn-sm" onClick={()=>moveQ(i,-1)} disabled={i===0}>↑</button>
                  <button className="btn btn-ghost btn-ico btn-sm" onClick={()=>moveQ(i,1)} disabled={i===questions.length-1}>↓</button>
                  <button className="btn btn-ghost btn-ico btn-sm" onClick={()=>setQModal(q)}><I.Edit /></button>
                  <button className="btn btn-red btn-ico btn-sm" onClick={()=>deleteQ(q.id)}><I.Trash /></button>
                </div>}
              </div>
            ))}
          </div>
        </div>
        {!readOnly&&<div style={{ display:"flex",justifyContent:"flex-end",gap:10,marginTop:"1.25rem" }}>
          <button className="btn btn-sec" onClick={onBack}>Cancel</button>
          <button className="btn btn-nvy" disabled={!canSave} onClick={()=>canSave&&onSave({id:quiz?.id||uid(),code:quiz?.code||mkCode(),...meta,questions,createdBy:quiz?.createdBy||currentUser.id,createdByRole:quiz?.createdByRole||currentUser.role,createdByName:quiz?.createdByName||currentUser.username,createdAt:quiz?.createdAt||new Date().toISOString()})}>
            {quiz?"Save Changes":"Create Quiz"}
          </button>
        </div>}
        {readOnly&&<div style={{ display:"flex",justifyContent:"flex-end",marginTop:"1.25rem" }}><button className="btn btn-sec" onClick={onBack}>← Back</button></div>}
      </div>
      {!readOnly&&qModal!==null&&<QuestionModal question={qModal==="new"?null:qModal} onSave={saveQ} onClose={()=>setQModal(null)} />}
      {!readOnly&&xlModal&&<ExcelUploadModal onImport={qs=>{setQuestions(p=>[...p,...qs]);setXlModal(false);}} onClose={()=>setXlModal(false)} />}
    </>
  );
}

// ── ResultsView ───────────────────────────────────────────────────────────────
function ResultsView({ quiz, submissions, onBack }) {
  const [detail,setDetail]=useState(null);
  const subs=submissions.filter(s=>s.quizId===quiz.id).sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));
  const exportExcel=async()=>{
    try {
      const XLSX=await getXL();
      const ws=XLSX.utils.json_to_sheet(subs.map(s=>({ Student:s.studentName,Email:s.studentEmail||"",Score:`${s.score.earned}/${s.score.total}`,Percentage:`${s.score.pct}%`,Grade:gradeLabel(s.score.pct),Submitted:fmtDT(s.submittedAt) })));
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Results");
      XLSX.writeFile(wb,`${quiz.title}-results.xlsx`);
    } catch{alert("Export failed.");}
  };
  if(detail){
    return (
      <div className="page">
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:"1.5rem" }}>
          <button className="btn btn-ghost btn-ico" onClick={()=>setDetail(null)}><I.Back /></button>
          <div><h1 style={{ fontSize:"1.4rem" }}>{detail.studentName}'s Result</h1><p style={{ color:"var(--txt2)",fontSize:".85rem" }}>{quiz.title}</p></div>
        </div>
        <div className="card" style={{ marginBottom:"1rem" }}>
          <ScoreGauge pct={detail.score.pct} earned={detail.score.earned} total={detail.score.total} size={150} />
          <div style={{ textAlign:"center",paddingBottom:"1rem",color:"var(--txt2)",fontSize:".83rem" }}>Submitted: {fmtDT(detail.submittedAt)}</div>
        </div>
        {quiz.questions.map((q,i)=>{
          const d=detail.score.details.find(x=>x.qid===q.id);
          return (
            <div key={q.id} style={{ background:"var(--sur)",border:`1.5px solid ${d?.ok?"#a8d5bc":"#f5b8b3"}`,borderRadius:10,padding:"1rem 1.25rem",marginBottom:".6rem" }}>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                <span style={{ fontWeight:600,fontSize:".9rem" }}>Q{i+1}. {q.text}</span>
                <span style={{ color:d?.ok?"var(--grn)":"var(--red)",fontWeight:700,fontSize:".83rem",flexShrink:0,marginLeft:12 }}>{d?.ok?"✓ Correct":"✗ Wrong"}</span>
              </div>
              <div style={{ fontSize:".82rem",color:"var(--txt2)" }}>
                <div>Answer: <strong>{q.type==="mc"?`${optLetter(d?.ua)}. ${q.options?.[d?.ua]??""}`:(d?.ua??"")||"—"}</strong></div>
                {!d?.ok&&<div style={{ color:"var(--grn)",fontWeight:600,marginTop:3 }}>Correct: <strong>{q.type==="mc"?`${optLetter(q.correctAnswer)}. ${q.options?.[q.correctAnswer]}`:String(q.correctAnswer)}</strong></div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="page">
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:"1.5rem" }}>
        <button className="btn btn-ghost btn-ico" onClick={onBack}><I.Back /></button>
        <div style={{ flex:1 }}><h1 style={{ fontSize:"1.4rem" }}>Results — {quiz.title}</h1><p style={{ color:"var(--txt2)",fontSize:".85rem" }}>{subs.length} submission{subs.length!==1?"s":""}</p></div>
        <button className="btn btn-grn btn-sm" onClick={exportExcel}><I.Dl /> Export</button>
      </div>
      <div className="card">
        {subs.length===0?<div className="empty" style={{ padding:"3rem" }}><div className="ei">📬</div><h3>No submissions yet</h3><p>Share code: <strong style={{ fontFamily:"monospace",fontSize:"1.1rem",letterSpacing:".15em",color:"var(--amb-d)" }}>{quiz.code}</strong></p></div>:
          <div style={{ overflowX:"auto" }}><table className="tbl">
            <thead><tr><th>Student</th><th>Score</th><th>%</th><th>Grade</th><th>Submitted</th><th></th></tr></thead>
            <tbody>{subs.map(s=>{const g=gradeLabel(s.score.pct);return(
              <tr key={s.id}>
                <td style={{ fontWeight:600 }}>{s.studentName}</td>
                <td>{s.score.earned}/{s.score.total}</td>
                <td style={{ fontWeight:700,color:gradeColor(g) }}>{s.score.pct}%</td>
                <td><span className="badge" style={{ background:gradeColor(g)+"22",color:gradeColor(g) }}>Grade {g}</span></td>
                <td style={{ color:"var(--txt2)",fontSize:".8rem" }}>{fmtDT(s.submittedAt)}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={()=>setDetail(s)}>View</button></td>
              </tr>
            );})}</tbody>
          </table></div>}
      </div>
    </div>
  );
}

// ── AnalyticsView ─────────────────────────────────────────────────────────────
function AnalyticsView({ quiz, submissions, onBack }) {
  const subs=submissions.filter(s=>s.quizId===quiz.id);
  const scores=subs.map(s=>s.score.pct);
  const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  const high=scores.length?Math.max(...scores):0;
  const low=scores.length?Math.min(...scores):0;
  const qStats=quiz.questions.map(q=>{
    const correct=subs.filter(s=>s.score.details.find(d=>d.qid===q.id)?.ok).length;
    return{q,pct:subs.length?Math.round(correct/subs.length*100):0};
  }).sort((a,b)=>a.pct-b.pct);
  return (
    <div className="page">
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:"1.5rem" }}>
        <button className="btn btn-ghost btn-ico" onClick={onBack}><I.Back /></button>
        <div><h1 style={{ fontSize:"1.4rem" }}>Analytics — {quiz.title}</h1><p style={{ color:"var(--txt2)",fontSize:".85rem" }}>{subs.length} attempts</p></div>
      </div>
      {subs.length===0?<div className="empty card" style={{ padding:"3rem" }}><div className="ei">📊</div><h3>No data yet</h3></div>:(
        <>
          <div className="col3" style={{ marginBottom:"1.5rem" }}>
            <div className="stat-card"><div className="stat-icon">📈</div><div className="stat-val" style={{ color:"var(--amb)" }}>{avg}%</div><div className="stat-lbl">Average</div></div>
            <div className="stat-card"><div className="stat-icon">🏆</div><div className="stat-val" style={{ color:"var(--grn)" }}>{high}%</div><div className="stat-lbl">Highest</div></div>
            <div className="stat-card"><div className="stat-icon">📉</div><div className="stat-val" style={{ color:"var(--red)" }}>{low}%</div><div className="stat-lbl">Lowest</div></div>
          </div>
          <div className="card"><div className="card-hd"><h3>Question Performance</h3></div>
            <div className="card-bd">{qStats.map(s=>(
              <div key={s.q.id} className="bar-row">
                <div className="bar-label">Q{quiz.questions.indexOf(s.q)+1}. {s.q.text.slice(0,45)}{s.q.text.length>45?"…":""}</div>
                <div className="bar-track"><div className={`bar-fill${s.pct<50?" low":""}`} style={{ width:`${s.pct}%` }} /></div>
                <div className="bar-pct" style={{ color:s.pct<50?"var(--red)":"var(--grn)" }}>{s.pct}%</div>
              </div>
            ))}</div>
          </div>
        </>
      )}
    </div>
  );
}

// ── AUTH SCREENS ──────────────────────────────────────────────────────────────
function SetupAdminScreen({ onDone }) {
  const [username,setUsername]=useState("");const[pw,setPw]=useState("");const[pw2,setPw2]=useState("");const[err,setErr]=useState("");
  const submit=async()=>{
    setErr("");
    if(!username.trim())return setErr("Username is required.");
    if(pw.length<6)return setErr("Password must be at least 6 characters.");
    if(pw!==pw2)return setErr("Passwords do not match.");
    const admin={id:"admin",username:username.trim().toLowerCase(),passwordHash:hashPw(pw),role:"admin",createdAt:new Date().toISOString()};
    await saveAdmin(admin);
    onDone(admin);
  };
  return (
    <div className="auth-wrap"><div className="auth-box">
      <div className="auth-logo"><h2>🛡 Initial Setup</h2><p>Create the administrator account.</p></div>
      {err&&<div className="err-box">{err}</div>}
      <div className="fg"><label className="lbl">Admin Username</label><input className="inp" value={username} onChange={e=>setUsername(e.target.value)} /></div>
      <div className="fg"><label className="lbl">Password</label><input className="inp" type="password" value={pw} onChange={e=>setPw(e.target.value)} /></div>
      <div className="fg"><label className="lbl">Confirm Password</label><input className="inp" type="password" value={pw2} onChange={e=>setPw2(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} /></div>
      <button className="btn btn-nvy" style={{ width:"100%",justifyContent:"center",padding:"11px" }} onClick={submit}>Create Admin Account</button>
    </div></div>
  );
}

function LoginScreen({ admin, teachers, onLogin }) {
  const [role,setRole]=useState("teacher");const[username,setUsername]=useState("");const[pw,setPw]=useState("");const[err,setErr]=useState("");
  const submit=()=>{
    setErr("");
    if(!username.trim()||!pw.trim())return setErr("Please enter username and password.");
    if(role==="admin"){
      if(!admin)return setErr("No admin account found.");
      if(admin.username!==username.trim().toLowerCase()||admin.passwordHash!==hashPw(pw))return setErr("Incorrect credentials.");
      onLogin(admin);
    } else {
      const teacher=(teachers||[]).find(t=>t.username===username.trim().toLowerCase());
      if(!teacher)return setErr("Teacher account not found.");
      if(teacher.passwordHash!==hashPw(pw))return setErr("Incorrect password.");
      onLogin(teacher);
    }
  };
  return (
    <div className="auth-wrap"><div className="auth-box">
      <div className="auth-logo"><h2 style={{ fontFamily:"var(--fnt-s)" }}>Sign In</h2><p>Access your QuizCraft account.</p></div>
      <div className="role-pill">
        <button className={`role-btn teacher-role-btn${role==="teacher"?" on":""}`} onClick={()=>{setRole("teacher");setErr("");}}><I.Person /> Teacher</button>
        <button className={`role-btn admin-role-btn${role==="admin"?" on":""}`} onClick={()=>{setRole("admin");setErr("");}}><I.Shield /> Admin</button>
      </div>
      {err&&<div className="err-box">{err}</div>}
      <div className="fg"><label className="lbl">Username</label><input className="inp" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} /></div>
      <div className="fg" style={{ marginBottom:"1.25rem" }}><label className="lbl">Password</label><input className="inp" type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} /></div>
      <button className="btn btn-nvy" style={{ width:"100%",justifyContent:"center",padding:"11px" }} onClick={submit}>Sign In as {role==="admin"?"Admin":"Teacher"}</button>
      <p style={{ textAlign:"center",fontSize:".78rem",color:"var(--txt2)",marginTop:"1rem",opacity:.7 }}>Students join using a quiz code — no account needed.</p>
    </div></div>
  );
}

// ── TEACHER MANAGER ───────────────────────────────────────────────────────────
function TeacherManagerView({ teachers, onSave, onDelete }) {
  const [modal,setModal]=useState(null);const[form,setForm]=useState({name:"",username:"",pw:"",pw2:""});const[err,setErr]=useState("");const[ok,setOk]=useState("");
  const openNew=()=>{setForm({name:"",username:"",pw:"",pw2:""});setErr("");setOk("");setModal("new");};
  const openEdit=t=>{setForm({name:t.name,username:t.username,pw:"",pw2:""});setErr("");setOk("");setModal(t);};
  const handleSave=()=>{
    setErr("");setOk("");
    if(!form.username.trim())return setErr("Username is required.");
    if(modal==="new"&&form.pw.length<6)return setErr("Password must be at least 6 characters.");
    if(form.pw&&form.pw!==form.pw2)return setErr("Passwords do not match.");
    const dup=teachers.find(t=>t.username===form.username.trim().toLowerCase()&&(modal==="new"||t.id!==modal.id));
    if(dup)return setErr("Username already taken.");
    if(modal==="new"){onSave({id:uid(),name:form.name.trim()||form.username.trim(),username:form.username.trim().toLowerCase(),passwordHash:hashPw(form.pw),role:"teacher",createdAt:new Date().toISOString()});}
    else{onSave({...modal,name:form.name.trim()||modal.name,username:form.username.trim().toLowerCase(),...(form.pw?{passwordHash:hashPw(form.pw)}:{})});}
    setOk(modal==="new"?"Teacher created.":"Teacher updated.");setModal(null);
  };
  return (
    <div className="page">
      <div className="ph" style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
        <div><h1>Teacher Accounts</h1><p>Create and manage teacher logins.</p></div>
        <button className="btn btn-pri" onClick={openNew}><I.Plus /> New Teacher</button>
      </div>
      {ok&&<div className="ok-box" style={{ marginBottom:"1rem" }}>{ok}</div>}
      <div className="card">
        {teachers.length===0?<div className="empty" style={{ padding:"3rem" }}><div className="ei">👩‍🏫</div><h3>No teachers yet</h3><button className="btn btn-pri" style={{ marginTop:"1rem" }} onClick={openNew}><I.Plus /> Add Teacher</button></div>:
          <table className="tbl"><thead><tr><th>Name</th><th>Username</th><th>Created</th><th></th></tr></thead>
            <tbody>{teachers.map(t=>(
              <tr key={t.id}>
                <td style={{ fontWeight:600 }}>{t.name}</td><td style={{ fontFamily:"monospace",color:"var(--txt2)" }}>{t.username}</td>
                <td style={{ color:"var(--txt2)",fontSize:".82rem" }}>{fmtDT(t.createdAt)}</td>
                <td><div style={{ display:"flex",gap:6 }}><button className="btn btn-sec btn-sm" onClick={()=>openEdit(t)}><I.Edit /> Edit</button><button className="btn btn-red btn-ico btn-sm" onClick={()=>{if(window.confirm(`Delete ${t.username}?`))onDelete(t.id);}}><I.Trash /></button></div></td>
              </tr>
            ))}</tbody>
          </table>}
      </div>
      {modal!==null&&<div className="ov" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal" style={{ maxWidth:400 }}>
          <div className="mhd"><h3>{modal==="new"?"New Teacher":"Edit Teacher"}</h3><button className="btn btn-ghost btn-ico" onClick={()=>setModal(null)}><I.X /></button></div>
          <div className="mbd">
            {err&&<div className="err-box">{err}</div>}
            <div className="fg"><label className="lbl">Display Name</label><input className="inp" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} /></div>
            <div className="fg"><label className="lbl">Username *</label><input className="inp" value={form.username} onChange={e=>setForm(p=>({...p,username:e.target.value}))} /></div>
            <div className="fg"><label className="lbl">{modal==="new"?"Password *":"New Password (blank to keep)"}</label><input className="inp" type="password" value={form.pw} onChange={e=>setForm(p=>({...p,pw:e.target.value}))} /></div>
            {form.pw&&<div className="fg" style={{ marginBottom:0 }}><label className="lbl">Confirm</label><input className="inp" type="password" value={form.pw2} onChange={e=>setForm(p=>({...p,pw2:e.target.value}))} /></div>}
          </div>
          <div className="mft"><button className="btn btn-sec" onClick={()=>setModal(null)}>Cancel</button><button className="btn btn-nvy" onClick={handleSave}>{modal==="new"?"Create":"Save"}</button></div>
        </div>
      </div>}
    </div>
  );
}

// ── Quiz List (shared, with share chip + active toggle) ────────────────────────
function QuizListPane({ quizzes, submissions, view, onNew, onEdit, onResults, onAnalytics, onDeleteQuiz, onToggleActive, onCopy }) {
  return (
    <div className="page">
      <div className="ph" style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"1rem" }}>
        <div><h1>{view==="results"?"Select Quiz — Results":view==="analytics"?"Select Quiz — Analytics":"All Quizzes"}</h1></div>
        {view==="quizlist"&&<button className="btn btn-pri" onClick={onNew}><I.Plus /> New Quiz</button>}
      </div>
      {quizzes.length===0?<div className="empty card" style={{ padding:"3rem" }}><div className="ei">📋</div><h3>No quizzes yet</h3>{view==="quizlist"&&<button className="btn btn-pri" style={{ marginTop:".75rem" }} onClick={onNew}><I.Plus /> Create</button>}</div>:
        <div className="card" style={{ padding:0 }}>
          {quizzes.map(q=>{
            const qSubs=submissions.filter(s=>s.quizId===q.id);
            const avg=qSubs.length?Math.round(qSubs.reduce((s,x)=>s+x.score.pct,0)/qSubs.length):null;
            const active=q.active!==false;
            return (
              <div key={q.id} style={{ padding:"12px 16px",borderBottom:"1px solid var(--bdr)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap" }}>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                    <span style={{ fontWeight:600 }}>{q.title}</span>
                    {!active&&<span className="badge badge-red">Inactive</span>}
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                    <ShareCodeChip code={q.code} onCopy={onCopy} />
                    <span style={{ color:"var(--txt2)",fontSize:".77rem" }}>{q.questions.length} Qs · {qSubs.length} attempts{avg!==null?` · avg ${avg}%`:""}</span>
                  </div>
                </div>
                <div style={{ display:"flex",gap:8,alignItems:"center",flexShrink:0,flexWrap:"wrap" }}>
                  {view==="quizlist"&&onToggleActive&&<ActiveToggle active={active} onChange={()=>onToggleActive(q.id,active)} />}
                  {view==="quizlist"&&<>
                    <button className="btn btn-sec btn-sm" onClick={()=>onEdit(q)}><I.Edit /> Edit</button>
                    <button className="btn btn-sec btn-sm" onClick={()=>onResults(q)}><I.Users /> Results</button>
                    <button className="btn btn-red btn-ico btn-sm" onClick={()=>{if(window.confirm("Delete quiz?"))onDeleteQuiz(q.id);}}><I.Trash /></button>
                  </>}
                  {(view==="results"||view==="analytics")&&<button className="btn btn-nvy btn-sm" onClick={()=>view==="results"?onResults(q):onAnalytics(q)}>View →</button>}
                </div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ── AdminDashboard ────────────────────────────────────────────────────────────
function AdminDashboard({ quizzes, submissions, teachers, onNewQuiz, onManage }) {
  const totalStudents=useMemo(()=>new Set(submissions.map(s=>s.studentName+s.studentEmail)).size,[submissions]);
  const avgScore=useMemo(()=>submissions.length?Math.round(submissions.reduce((s,x)=>s+x.score.pct,0)/submissions.length):0,[submissions]);
  const recent=[...submissions].sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt)).slice(0,6);
  const qMap=Object.fromEntries(quizzes.map(q=>[q.id,q]));
  return (
    <div className="page">
      <div className="ph"><h1>Admin Dashboard</h1><p>Full system overview.</p></div>
      <div className="col4" style={{ marginBottom:"1.5rem" }}>
        <div className="stat-card"><div className="stat-icon">📋</div><div className="stat-val">{quizzes.length}</div><div className="stat-lbl">Total Quizzes</div></div>
        <div className="stat-card"><div className="stat-icon">👩‍🏫</div><div className="stat-val">{teachers.length}</div><div className="stat-lbl">Teachers</div></div>
        <div className="stat-card"><div className="stat-icon">👥</div><div className="stat-val">{totalStudents}</div><div className="stat-lbl">Students</div></div>
        <div className="stat-card"><div className="stat-icon">📊</div><div className="stat-val">{avgScore}%</div><div className="stat-lbl">Avg Score</div></div>
      </div>
      <div className="col2">
        <div className="card">
          <div className="card-hd"><h3>All Quizzes</h3><button className="btn btn-pri btn-sm" onClick={onNewQuiz}><I.Plus /> New</button></div>
          <div className="card-bd" style={{ padding:0 }}>
            {quizzes.length===0?<div className="empty" style={{ padding:"2rem" }}><div className="ei">📋</div><h3>No quizzes yet</h3></div>:
              quizzes.slice(0,8).map(q=>(
                <div key={q.id} style={{ padding:"10px 14px",borderBottom:"1px solid var(--bdr)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div><div style={{ fontWeight:600,fontSize:".88rem" }}>{q.title}{!q.active&&<span className="badge badge-red" style={{ marginLeft:8,fontSize:".7rem" }}>Inactive</span>}</div><div style={{ color:"var(--txt2)",fontSize:".77rem" }}>by {q.createdByName} · {q.questions.length} Qs</div></div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>onManage(q)}>Manage →</button>
                </div>
              ))}
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><h3>Recent Submissions</h3></div>
          <div className="card-bd" style={{ padding:0 }}>
            {recent.length===0?<div className="empty" style={{ padding:"2rem" }}><div className="ei">📬</div><h3>No submissions yet</h3></div>:
              recent.map(s=>{const g=gradeLabel(s.score.pct);return(
                <div key={s.id} style={{ padding:"10px 14px",borderBottom:"1px solid var(--bdr)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:".85rem" }}>
                  <div><div style={{ fontWeight:600 }}>{s.studentName}</div><div style={{ color:"var(--txt2)",fontSize:".77rem" }}>{qMap[s.quizId]?.title||"Unknown"}</div></div>
                  <div style={{ fontFamily:"var(--fnt-s)",fontWeight:700,color:gradeColor(g) }}>{s.score.pct}%</div>
                </div>
              );})}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AdminApp ──────────────────────────────────────────────────────────────────
function AdminApp({ user, onLogout, quizzes, teachers, submissions, onSaveQuiz, onDeleteQuiz, onSaveTeacher, onDeleteTeacher, onToggleActive }) {
  const [view,setView]=useState("dashboard");const[sel,setSel]=useState(null);const[toast,setToast]=useState(null);
  const nav=v=>{setView(v);if(!["results","analytics","builder"].includes(v))setSel(null);};
  const handleCopy=code=>{navigator.clipboard.writeText(code).catch(()=>{});setToast(`Code ${code} copied!`);};
  const SIDEBAR=[
    {icon:<I.Home />,label:"Dashboard",v:"dashboard"},{sep:true,label:"Quizzes"},
    {icon:<I.Quiz />,label:"All Quizzes",v:"quizlist"},{icon:<I.Plus />,label:"New Quiz",v:"builder"},
    {sep:true,label:"People"},{icon:<I.Users />,label:"Teachers",v:"teachers"},
    {sep:true,label:"Reports"},{icon:<I.Chart />,label:"Results",v:"results"},{icon:<I.Chart />,label:"Analytics",v:"analytics"},
  ];
  const renderMain=()=>{
    if(view==="builder")return <QuizBuilderView quiz={sel} currentUser={user} onSave={q=>{onSaveQuiz(q);nav("quizlist");}} onBack={()=>nav(sel?"quizlist":"dashboard")} />;
    if(view==="teachers")return <TeacherManagerView teachers={teachers} onSave={onSaveTeacher} onDelete={onDeleteTeacher} />;
    if(view==="results"&&sel)return <ResultsView quiz={sel} submissions={submissions} onBack={()=>setSel(null)} />;
    if(view==="analytics"&&sel)return <AnalyticsView quiz={sel} submissions={submissions} onBack={()=>setSel(null)} />;
    if(view==="quizlist"||(view==="results"||view==="analytics")&&!sel)return <QuizListPane quizzes={quizzes} submissions={submissions} view={view} onNew={()=>{setSel(null);nav("builder");}} onEdit={q=>{setSel(q);nav("builder");}} onResults={q=>{setSel(q);nav("results");}} onAnalytics={q=>{setSel(q);nav("analytics");}} onDeleteQuiz={onDeleteQuiz} onToggleActive={onToggleActive} onCopy={handleCopy} />;
    return <AdminDashboard quizzes={quizzes} submissions={submissions} teachers={teachers} onNewQuiz={()=>{setSel(null);nav("builder");}} onManage={q=>{setSel(q);nav("quizlist");}} />;
  };
  return (
    <div className="admin-layout">
      <div className="sidebar">
        {SIDEBAR.map((item,i)=>item.sep?<div key={i} className="sidebar-section">{item.label}</div>:<div key={i} className={`sidebar-item${view===item.v?" on":""}`} onClick={()=>nav(item.v)}>{item.icon} {item.label}</div>)}
        <div style={{ marginTop:"2rem",borderTop:"1px solid rgba(255,255,255,.1)" }}>
          <div className="sidebar-item" onClick={onLogout}><I.Logout /> Sign Out ({user.username})</div>
        </div>
      </div>
      <div className="admin-content">{renderMain()}</div>
      {toast&&<CopyToast msg={toast} onDone={()=>setToast(null)} />}
    </div>
  );
}

// ── TeacherApp ────────────────────────────────────────────────────────────────
function TeacherApp({ user, onLogout, quizzes, submissions, onSaveQuiz }) {
  const [view,setView]=useState("dashboard");const[sel,setSel]=useState(null);const[toast,setToast]=useState(null);
  const myQuizzes=quizzes.filter(q=>q.createdBy===user.id);
  const mySubs=submissions.filter(s=>myQuizzes.some(q=>q.id===s.quizId));
  const nav=v=>{setView(v);if(!["results","analytics","builder","view"].includes(v))setSel(null);};
  const handleCopy=code=>{navigator.clipboard.writeText(code).catch(()=>{});setToast(`Code ${code} copied!`);};
  const SIDEBAR=[
    {icon:<I.Home />,label:"Dashboard",v:"dashboard"},{icon:<I.Quiz />,label:"My Quizzes",v:"quizlist"},
    {icon:<I.Plus />,label:"New Quiz",v:"builder"},{icon:<I.Users />,label:"Results",v:"results"},{icon:<I.Chart />,label:"Analytics",v:"analytics"},
  ];
  const TeacherDash=()=>{
    const avg=mySubs.length?Math.round(mySubs.reduce((s,x)=>s+x.score.pct,0)/mySubs.length):0;
    const recent=[...mySubs].sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt)).slice(0,6);
    const qMap=Object.fromEntries(myQuizzes.map(q=>[q.id,q]));
    return (
      <div className="page">
        <div className="ph"><h1>Teacher Dashboard</h1><p>Welcome back, <strong>{user.name||user.username}</strong>.</p></div>
        <div className="col3" style={{ marginBottom:"1.5rem" }}>
          <div className="stat-card"><div className="stat-icon">📋</div><div className="stat-val">{myQuizzes.length}</div><div className="stat-lbl">My Quizzes</div></div>
          <div className="stat-card"><div className="stat-icon">👥</div><div className="stat-val">{mySubs.length}</div><div className="stat-lbl">Submissions</div></div>
          <div className="stat-card"><div className="stat-icon">📊</div><div className="stat-val">{avg}%</div><div className="stat-lbl">Avg Score</div></div>
        </div>
        <div className="card"><div className="card-hd"><h3>Recent Submissions</h3></div>
          <div className="card-bd" style={{ padding:0 }}>
            {recent.length===0?<div className="empty" style={{ padding:"2rem" }}><div className="ei">📬</div><h3>No submissions yet</h3></div>:
              recent.map(s=>{const g=gradeLabel(s.score.pct);return(
                <div key={s.id} style={{ padding:"10px 14px",borderBottom:"1px solid var(--bdr)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:".85rem" }}>
                  <div><div style={{ fontWeight:600 }}>{s.studentName}</div><div style={{ color:"var(--txt2)",fontSize:".77rem" }}>{qMap[s.quizId]?.title}</div></div>
                  <div style={{ fontFamily:"var(--fnt-s)",fontWeight:700,color:gradeColor(g) }}>{s.score.pct}%</div>
                </div>
              );})}
          </div>
        </div>
      </div>
    );
  };
  const renderMain=()=>{
    if(view==="builder")return <QuizBuilderView quiz={null} currentUser={user} onSave={q=>{onSaveQuiz(q);nav("quizlist");}} onBack={()=>nav("dashboard")} readOnly={false} />;
    if(view==="view"&&sel)return <QuizBuilderView quiz={sel} currentUser={user} onSave={null} onBack={()=>{setSel(null);nav("quizlist");}} readOnly={true} />;
    if(view==="results"&&sel)return <ResultsView quiz={sel} submissions={submissions} onBack={()=>setSel(null)} />;
    if(view==="analytics"&&sel)return <AnalyticsView quiz={sel} submissions={submissions} onBack={()=>setSel(null)} />;
    if(view==="quizlist"||(view==="results"||view==="analytics")&&!sel)return <QuizListPane quizzes={myQuizzes} submissions={mySubs} view={view} onNew={()=>{setSel(null);nav("builder");}} onEdit={q=>{setSel(q);nav("view");}} onResults={q=>{setSel(q);nav("results");}} onAnalytics={q=>{setSel(q);nav("analytics");}} onDeleteQuiz={()=>{}} onToggleActive={null} onCopy={handleCopy} />;
    return <TeacherDash />;
  };
  return (
    <div className="admin-layout">
      <div className="sidebar">
        {SIDEBAR.map((item,i)=><div key={i} className={`sidebar-item${view===item.v?" on":""}`} onClick={()=>nav(item.v)}>{item.icon} {item.label}</div>)}
        <div style={{ marginTop:"2rem",borderTop:"1px solid rgba(255,255,255,.1)" }}><div className="sidebar-item" onClick={onLogout}><I.Logout /> Sign Out</div></div>
      </div>
      <div className="admin-content">{renderMain()}</div>
      {toast&&<CopyToast msg={toast} onDone={()=>setToast(null)} />}
    </div>
  );
}

// ── STUDENT PORTAL ────────────────────────────────────────────────────────────
function QuizTimer({ seconds, onExpire }) {
  const [left,setLeft]=useState(seconds);const ref=useRef(null);
  useEffect(()=>{
    ref.current=setInterval(()=>{setLeft(t=>{if(t<=1){clearInterval(ref.current);onExpire();return 0;}return t-1;});},1000);
    return()=>clearInterval(ref.current);
  },[]);
  const hrs=Math.floor(left/3600);const mins=pad2(Math.floor((left%3600)/60));const secs=pad2(left%60);
  return (
    <div className={`timer-wrap${left<60?" warn":""}`}>
      <I.Clock /><span>Time Remaining:</span>
      <span className="timer-dig">{hrs>0?`${pad2(hrs)}:${mins}:${secs}`:`${mins}:${secs}`}</span>
      {left<60&&<span>— Hurry!</span>}
    </div>
  );
}

function useAutosave(quizId, data, studentName, delay=800) {
  const [saved,setSaved]=useState(false);const timer=useRef(null);
  useEffect(()=>{
    setSaved(false);clearTimeout(timer.current);
    timer.current=setTimeout(async()=>{
      if(studentName){markAttemptName(quizId,studentName);await saveAttempt(quizId,data);}
      setSaved(true);setTimeout(()=>setSaved(false),2000);
    },delay);
    return()=>clearTimeout(timer.current);
  },[JSON.stringify(data)]);
  return saved;
}

function QuizAttempt({ quiz, questions, initialAnswers, student, onSubmit, onBack }) {
  const [answers,setAnswers]=useState(initialAnswers||{});const[confirm,setConfirm]=useState(false);const qRefs=useRef({});
  const onAnswer=(qid,val)=>setAnswers(p=>({...p,[qid]:val}));
  const answered=Object.keys(answers).length;
  const autosaved=useAutosave(quiz.id,{studentName:student.name,studentEmail:student.email,answers,questionOrder:questions.map(q=>q.id)},student.name);
  const doSubmit=useCallback(async()=>{
    await clearAttempt(quiz.id);
    const score=scoreQuiz(questions,answers);
    onSubmit({id:uid(),quizId:quiz.id,studentName:student.name,studentEmail:student.email,answers,score,submittedAt:new Date().toISOString()},score);
  },[answers,questions]);
  const scrollTo=id=>qRefs.current[id]?.scrollIntoView({behavior:"smooth",block:"center"});
  return (
    <>
      {quiz.timeLimit>0&&<QuizTimer seconds={quiz.timeLimit*60} onExpire={doSubmit} />}
      <div style={{ position:"sticky",top:quiz.timeLimit>0?80:56,zIndex:90 }}>
        <div className="autosave-bar"><I.Save /> {autosaved?"Progress saved ✓":"Autosaving…"}</div>
      </div>
      <div className="page-wide">
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:"1.25rem" }}>
          <button className="btn btn-ghost btn-ico" onClick={onBack}><I.Back /></button>
          <div style={{ flex:1 }}><div style={{ fontFamily:"var(--fnt-s)",fontSize:"1.1rem",fontWeight:500 }}>{quiz.title}</div><div style={{ color:"var(--txt2)",fontSize:".82rem" }}>{answered}/{questions.length} answered</div></div>
        </div>
        <div className="quiz-shell">
          <div>
            {questions.map((q,i)=>{
              const ans=answers[q.id];const done=ans!==undefined;
              return (
                <div key={q.id} className={`q-card${done?" answered":""}`} ref={el=>qRefs.current[q.id]=el}>
                  <div className="q-card-hd"><div className="q-num-circle">{i+1}</div><span style={{ fontSize:".8rem",color:"var(--txt2)",fontWeight:600 }}>{q.points} pt{q.points!==1?"s":""}</span></div>
                  {q.image&&<img src={q.image} alt="" style={{ maxWidth:"100%",maxHeight:220,borderRadius:8,objectFit:"contain",marginBottom:"1rem" }} />}
                  <div className="q-card-text">{q.text}</div>
                  {q.type==="mc"&&q.options.map((opt,oi)=>(
                    <div key={oi} className={`mc-opt${ans===oi?" sel":""}`} onClick={()=>onAnswer(q.id,oi)}>
                      <div className="mc-opt-l">{optLetter(oi)}</div><span>{opt}</span>
                    </div>
                  ))}
                  {q.type==="tf"&&<div className="tf-opts">{["true","false"].map(v=><div key={v} className={`tf-opt${ans===v?" sel":""}`} onClick={()=>onAnswer(q.id,v)}>{v==="true"?"✓ True":"✗ False"}</div>)}</div>}
                  {q.type==="short"&&<input className="inp" style={{ width:"100%" }} placeholder="Type your answer…" value={ans||""} onChange={e=>onAnswer(q.id,e.target.value)} />}
                </div>
              );
            })}
            <div style={{ textAlign:"center",marginTop:"1.5rem",paddingBottom:"2rem" }}>
              {answered<questions.length&&<p style={{ color:"var(--txt2)",fontSize:".85rem",marginBottom:".75rem" }}>{questions.length-answered} unanswered</p>}
              <button className="btn btn-grn" style={{ padding:"12px 32px",fontSize:".95rem" }} onClick={()=>setConfirm(true)}>Submit Quiz ✓</button>
            </div>
          </div>
          <div className="status-sidebar">
            <h4>Questions</h4>
            <div className="q-dots">{questions.map((q,i)=><div key={q.id} className={`qdot${answers[q.id]!==undefined?" done":""}`} onClick={()=>scrollTo(q.id)}>{i+1}</div>)}</div>
            <div style={{ fontSize:".78rem",color:"var(--txt2)" }}>
              <div style={{ display:"flex",gap:6,alignItems:"center",marginBottom:4 }}><div style={{ width:12,height:12,borderRadius:3,background:"var(--grn)" }} /> Answered ({answered})</div>
              <div style={{ display:"flex",gap:6,alignItems:"center" }}><div style={{ width:12,height:12,borderRadius:3,background:"var(--bg2)",border:"1px solid var(--bdr)" }} /> Unanswered ({questions.length-answered})</div>
            </div>
          </div>
        </div>
      </div>
      {confirm&&<div className="ov"><div className="modal" style={{ maxWidth:400,textAlign:"center" }}>
        <div className="mhd"><h3>Submit Quiz?</h3></div>
        <div className="mbd"><p style={{ marginBottom:".75rem" }}>Are you sure you want to submit?</p>{answered<questions.length&&<p style={{ color:"var(--red)",fontWeight:600,fontSize:".88rem" }}>⚠️ {questions.length-answered} question{questions.length-answered!==1?"s":""} unanswered.</p>}</div>
        <div className="mft"><button className="btn btn-sec" onClick={()=>setConfirm(false)}>Keep Going</button><button className="btn btn-grn" onClick={doSubmit}>Yes, Submit</button></div>
      </div></div>}
    </>
  );
}

function StudentResultView({ quiz, questions, answers, score, student, onBack }) {
  return (
    <div className="page" style={{ maxWidth:640,margin:"0 auto" }}>
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:"1.5rem" }}>
        <button className="btn btn-ghost btn-ico" onClick={onBack}><I.Back /></button>
        <div><h1 style={{ fontSize:"1.4rem" }}>Your Results</h1><p style={{ color:"var(--txt2)",fontSize:".85rem" }}>{quiz.title} · {student.name}</p></div>
      </div>
      <div className="card" style={{ marginBottom:"1.5rem" }}><ScoreGauge pct={score.pct} earned={score.earned} total={score.total} size={164} /></div>
      {questions.map((q,i)=>{
        const d=score.details.find(x=>x.qid===q.id);const ua=answers[q.id];
        return (
          <div key={q.id} className="q-card" style={{ borderColor:d?.ok?"#a8d5bc":"#f5b8b3" }}>
            <div className="q-card-hd"><div className="q-num-circle" style={{ background:d?.ok?"var(--grn)":"var(--red)" }}>{i+1}</div><span style={{ fontWeight:700,fontSize:".85rem",color:d?.ok?"var(--grn)":"var(--red)" }}>{d?.ok?"✓ Correct":"✗ Incorrect"} ({d?.ok?"+"+d.pts:"0"} pts)</span></div>
            {q.image&&<img src={q.image} alt="" style={{ maxWidth:"100%",maxHeight:180,borderRadius:8,objectFit:"contain",marginBottom:".75rem" }} />}
            <div className="q-card-text" style={{ fontSize:"1rem" }}>{q.text}</div>
            {q.type==="mc"&&q.options.map((opt,oi)=>{let cls="mc-opt";if(oi===q.correctAnswer)cls+=" r-ok";else if(oi===ua&&!d?.ok)cls+=" r-no";return<div key={oi} className={cls} style={{ cursor:"default" }}><div className="mc-opt-l">{optLetter(oi)}</div><span>{opt}</span></div>;})}
            {q.type==="tf"&&["true","false"].map(v=>{let cls="tf-opt";if(v===String(q.correctAnswer))cls+=" r-ok";else if(v===String(ua)&&!d?.ok)cls+=" r-no";return<div key={v} className={cls} style={{ cursor:"default" }}>{v==="true"?"✓ True":"✗ False"}</div>;})}
            {q.type==="short"&&<><div className={`r-note${d?.ok?" ok":" no"}`}>{d?.ok?<><I.Check /> Your answer: <strong>{ua}</strong> — Correct!</>:<><I.X /> Your answer: <strong>{ua||"—"}</strong></>}</div>{!d?.ok&&<div className="r-note ok"><I.Check /> Correct: <strong>{q.correctAnswer}</strong></div>}</>}
          </div>
        );
      })}
    </div>
  );
}

function StudentApp({ quizzes, onSubmit }) {
  const [view,setView]=useState("code");const[quiz,setQuiz]=useState(null);const[dispQs,setDispQs]=useState([]);
  const [student,setStudent]=useState({name:"",email:""});const[lastSub,setLastSub]=useState(null);
  const [codeIn,setCodeIn]=useState("");const[pwIn,setPwIn]=useState("");
  const [codeErr,setCodeErr]=useState("");const[pwErr,setPwErr]=useState("");
  const [resume,setResume]=useState(null);const[initAns,setInitAns]=useState({});
  const reset=()=>{setView("code");setQuiz(null);setDispQs([]);setStudent({name:"",email:""});setLastSub(null);setCodeIn("");setPwIn("");setResume(null);setInitAns({});};
  const joinQuiz=()=>{
    setCodeErr("");
    const found=quizzes.find(q=>q.code.toUpperCase()===codeIn.trim().toUpperCase());
    if(!found)return setCodeErr("Quiz not found. Check the code and try again.");
    if(found.active===false)return setCodeErr("This quiz is currently unavailable. Contact your teacher.");
    const now=new Date();
    if(found.availableFrom&&new Date(found.availableFrom)>now)return setCodeErr("This quiz hasn't opened yet.");
    if(found.availableTo&&new Date(found.availableTo)<now)return setCodeErr("This quiz has closed.");
    setQuiz(found);setView("landing");
  };
  useEffect(()=>{
    if(view==="landing"&&quiz){loadAttempt(quiz.id).then(saved=>{if(saved&&saved.studentName)setResume(saved);});}
  },[view,quiz]);
  const startQuiz=async(resumeSaved=false)=>{
    setPwErr("");
    if(quiz.password&&quiz.password!==pwIn)return setPwErr("Incorrect password.");
    let qs=[...quiz.questions];let initAnswers={};
    if(resumeSaved&&resume){
      const order=resume.questionOrder||qs.map(q=>q.id);
      qs=order.map(id=>quiz.questions.find(q=>q.id===id)).filter(Boolean);
      initAnswers=resume.answers||{};
    } else {
      if(quiz.shuffleQ)qs=shuffle(qs);
      if(quiz.shuffleOpts)qs=qs.map(q=>{if(q.type!=="mc")return q;const idxs=shuffle([0,1,2,3]);return{...q,options:idxs.map(i=>q.options[i]),correctAnswer:idxs.indexOf(q.correctAnswer)};});
      await clearAttempt(quiz.id);
    }
    markAttemptName(quiz.id,student.name||resume?.studentName||"");
    setDispQs(qs);setInitAns(initAnswers);setResume(null);setView("attempt");
  };
  const handleSubmit=(sub,score)=>{onSubmit(sub);setLastSub({sub,score});setView("confirm");};

  if(view==="code")return(
    <div className="code-entry">
      <div style={{ marginBottom:"2rem" }}><div style={{ fontFamily:"var(--fnt-s)",fontSize:"2rem",marginBottom:8 }}>Enter Quiz Code</div><p style={{ color:"var(--txt2)" }}>Type the 6-character code from your teacher.</p></div>
      <input className="code-input" placeholder="ABC123" value={codeIn} onChange={e=>{setCodeIn(e.target.value.toUpperCase().slice(0,6));setCodeErr("");}} onKeyDown={e=>e.key==="Enter"&&joinQuiz()} maxLength={6} />
      {codeErr&&<p style={{ color:"var(--red)",fontSize:".85rem",marginTop:10,fontWeight:600 }}>{codeErr}</p>}
      <button className="btn btn-nvy" style={{ marginTop:"1.25rem",width:"100%",justifyContent:"center",padding:"11px" }} onClick={joinQuiz} disabled={codeIn.length<6}>Find Quiz →</button>
    </div>
  );

  if(view==="landing")return(
    <div className="quiz-lp">
      <div className="ql-header">
        <h1>{quiz.title}</h1>{quiz.subject&&<div className="ql-subj">{quiz.subject}</div>}
        <div className="meta-row">
          <span className="meta-chip">📝 {quiz.questions.length} Questions</span>
          {quiz.timeLimit>0&&<span className="meta-chip"><I.Clock /> {quiz.timeLimit>=60?`${Math.floor(quiz.timeLimit/60)}h${quiz.timeLimit%60>0?` ${quiz.timeLimit%60}m`:""}`:quiz.timeLimit+" min"}</span>}
          <span className="meta-chip">📊 {quiz.questions.reduce((s,q)=>s+(q.points||1),0)} pts</span>
        </div>
      </div>
      {quiz.description&&<div className="card" style={{ marginBottom:"1.25rem",padding:"1rem 1.25rem",fontSize:".9rem",lineHeight:1.6 }}>{quiz.description}</div>}
      {resume&&<div className="resume-banner">
        <div><div style={{ fontWeight:700,fontSize:".9rem" }}>📂 Saved progress found</div><div style={{ fontSize:".82rem",color:"var(--txt2)",marginTop:2 }}>Started as <strong>{resume.studentName}</strong> · {Object.keys(resume.answers||{}).length} answers saved.</div></div>
        <div style={{ display:"flex",gap:8 }}><button className="btn btn-pri btn-sm" onClick={()=>{setStudent({name:resume.studentName,email:resume.studentEmail||""});startQuiz(true);}}>Resume</button><button className="btn btn-sec btn-sm" onClick={()=>setResume(null)}>Start Fresh</button></div>
      </div>}
      <div className="card"><div className="card-hd"><h3>Your Details</h3></div><div className="card-bd">
        <div className="fg"><label className="lbl">Full Name *</label><input className="inp" value={student.name} onChange={e=>setStudent(p=>({...p,name:e.target.value}))} placeholder="Enter your full name" /></div>
        <div className="fg" style={{ marginBottom:quiz.password?"1rem":0 }}><label className="lbl">Email (optional)</label><input className="inp" type="email" value={student.email} onChange={e=>setStudent(p=>({...p,email:e.target.value}))} placeholder="student@school.com" /></div>
        {quiz.password&&<><div className="fg" style={{ marginBottom:0 }}><label className="lbl"><I.Key /> Quiz Password</label><input className="inp" type="password" value={pwIn} onChange={e=>{setPwIn(e.target.value);setPwErr("");}} /></div>{pwErr&&<p style={{ color:"var(--red)",fontSize:".83rem",marginTop:6,fontWeight:600 }}>{pwErr}</p>}</>}
      </div></div>
      <button className="btn btn-grn" style={{ marginTop:"1.25rem",width:"100%",justifyContent:"center",padding:"12px" }} disabled={!student.name.trim()} onClick={()=>startQuiz(false)}>Start Quiz →</button>
      <button className="btn btn-ghost btn-sm" style={{ width:"100%",justifyContent:"center",marginTop:8 }} onClick={reset}>← Back</button>
    </div>
  );

  if(view==="attempt")return<QuizAttempt quiz={quiz} questions={dispQs} initialAnswers={initAns} student={student} onSubmit={handleSubmit} onBack={reset} />;

  if(view==="confirm")return(
    <div className="confirm-wrap">
      <div className="confirm-icon">🎉</div><h1>Submitted!</h1>
      <p style={{ color:"var(--txt2)",marginBottom:"1.5rem" }}>Your quiz has been submitted, <strong>{student.name}</strong>.</p>
      {quiz.showResults&&lastSub&&<div className="card" style={{ marginBottom:"1.25rem" }}>
        <ScoreGauge pct={lastSub.score.pct} earned={lastSub.score.earned} total={lastSub.score.total} size={148} />
        <div style={{ textAlign:"center",paddingBottom:"1.25rem" }}><button className="btn btn-nvy btn-sm" onClick={()=>setView("result")}>View Full Results →</button></div>
      </div>}
      <button className="btn btn-sec" style={{ width:"100%",justifyContent:"center" }} onClick={reset}>Take Another Quiz</button>
    </div>
  );

  if(view==="result"&&lastSub)return<StudentResultView quiz={quiz} questions={dispQs} answers={lastSub.sub.answers} score={lastSub.score} student={student} onBack={()=>setView("confirm")} />;
  return null;
}

// ── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]=useState("student");
  const [admin,setAdmin]=useState(null);const[teachers,setTeachers]=useState([]);
  const [quizzes,setQuizzes]=useState([]);const[subs,setSubs]=useState([]);
  const [session,setSession]=useState(null);const[loading,setLoading]=useState(true);

  useEffect(()=>{
    (async()=>{
      const [adm,tchs,qzs,ss_]=await Promise.all([getAdmin(),getTeachers(),getQuizzes(),getSubmissions()]);
      setAdmin(adm);setTeachers(tchs||[]);setQuizzes(qzs||[]);setSubs(ss_||[]);
      const sess=getSession();if(sess)setSession(sess);
      setLoading(false);
    })();
  },[]);

  const login=useCallback(async user=>{const sess={role:user.role,user};setSession(sess);saveSession(sess);},[]);
  const logout=useCallback(async()=>{setSession(null);clearSession();},[]);

  const saveQuiz=useCallback(async quiz=>{
    await upsertQuiz(quiz);
    setQuizzes(prev=>prev.find(q=>q.id===quiz.id)?prev.map(q=>q.id===quiz.id?quiz:q):[...prev,quiz]);
  },[]);

  const deleteQuiz=useCallback(async id=>{
    await deleteQuizById(id);setQuizzes(prev=>prev.filter(q=>q.id!==id));
  },[]);

  const handleToggleActive=useCallback(async(id,currentActive)=>{
    await toggleQuizActive(id,currentActive);
    setQuizzes(prev=>prev.map(q=>q.id===id?{...q,active:!currentActive}:q));
  },[]);

  const handleSaveTeacher=useCallback(async t=>{
    await upsertTeacher(t);setTeachers(prev=>prev.find(x=>x.id===t.id)?prev.map(x=>x.id===t.id?t:x):[...prev,t]);
  },[]);

  const handleDeleteTeacher=useCallback(async id=>{
    await deleteTeacherById(id);setTeachers(prev=>prev.filter(t=>t.id!==id));
  },[]);

  const handleAdminSetup=useCallback(async adm=>{setAdmin(adm);login(adm);},[login]);

  const submitQuiz=useCallback(async sub=>{
    await insertSubmission(sub);setSubs(prev=>[sub,...prev]);
  },[]);

  if(loading)return(
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"var(--fnt-s)",color:"var(--txt2)",fontSize:"1.1rem" }}>
      Loading QuizCraft…
    </div>
  );

  if(!admin&&tab==="admin"&&!session)return(
    <><style>{CSS}</style>
      <nav className="topnav"><div className="brand">Quiz<span>Craft</span></div>
        <div className="nav-tabs">
          <button className={`ntab${tab==="student"?" on":""}`} onClick={()=>setTab("student")}><I.Quiz /> Student Portal</button>
          <button className={`ntab${tab==="admin"?" on":""}`} onClick={()=>setTab("admin")}><I.Shield /> Staff Login</button>
        </div>
      </nav>
      <SetupAdminScreen onDone={handleAdminSetup} />
    </>
  );

  const staffLoggedIn=session&&(session.role==="admin"||session.role==="teacher");
  return (
    <><style>{CSS}</style>
      <nav className="topnav"><div className="brand">Quiz<span>Craft</span></div>
        <div className="nav-tabs">
          <button className={`ntab${tab==="student"?" on":""}`} onClick={()=>setTab("student")}><I.Quiz /> Student Portal</button>
          <button className={`ntab${tab==="admin"?" on":""}`} onClick={()=>setTab("admin")}><I.Shield /> {staffLoggedIn?(session.role==="admin"?"Admin Panel":"Teacher Panel"):"Staff Login"}</button>
        </div>
      </nav>
      {tab==="student"&&<StudentApp quizzes={quizzes} onSubmit={submitQuiz} />}
      {tab==="admin"&&!staffLoggedIn&&<LoginScreen admin={admin} teachers={teachers} onLogin={login} />}
      {tab==="admin"&&staffLoggedIn&&session.role==="admin"&&<AdminApp user={session.user} onLogout={logout} quizzes={quizzes} teachers={teachers} submissions={subs} onSaveQuiz={saveQuiz} onDeleteQuiz={deleteQuiz} onSaveTeacher={handleSaveTeacher} onDeleteTeacher={handleDeleteTeacher} onToggleActive={handleToggleActive} />}
      {tab==="admin"&&staffLoggedIn&&session.role==="teacher"&&<TeacherApp user={session.user} onLogout={logout} quizzes={quizzes} submissions={subs} onSaveQuiz={saveQuiz} />}
    </>
  );
}
