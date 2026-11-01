/* RepRoom: gym + calorie tracker. Plain JavaScript, no build step.
   All data is saved in this browser's localStorage under the key below. */
'use strict';

const KEY = 'reproom.v2';
const LB = 2.20462;

// ---------- Data ----------
const defaults = () => ({
  unit: 'kg',
  goal: 2200,              // daily calorie goal
  proteinGoal: 120,        // grams
  profile: null,           // filled by the calculator in Settings
  workouts: [],            // {id, date, name, notes, exercises:[{name, sets:[{reps, kg}]}]}
  foods: [],               // {id, date, name, kcal, protein, meal}
  draft: null              // the workout you're building but haven't saved yet
});

let db = load();
function load() {
  try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY)) || {}); }
  catch { return defaults(); }
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

// ---------- Helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmt = n => Math.round(n).toLocaleString();
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date, not UTC
const today = () => dstr(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const niceDate = s => s === today() ? 'Today' : s === addDays(today(), -1) ? 'Yesterday'
  : parseD(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const toUnit = kg => db.unit === 'lb' ? kg * LB : kg;
const fromUnit = v => db.unit === 'lb' ? num(v) / LB : num(v);
const showW = kg => { const v = toUnit(kg); return (Math.round(v * 10) / 10).toString(); };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2000);
}
const ICON = {
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

// ---------- Calculations ----------
const foodsOn = d => db.foods.filter(f => f.date === d);
const workoutsOn = d => db.workouts.filter(w => w.date === d);
const kcalOn = d => foodsOn(d).reduce((a, f) => a + num(f.kcal), 0);
const proteinOn = d => foodsOn(d).reduce((a, f) => a + num(f.protein), 0);
const setsOf = w => w.exercises.reduce((a, e) => a + e.sets.length, 0);
const volumeOf = w => w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + num(s.reps) * num(s.kg), 0), 0);

// Mifflin-St Jeor with gentle goals and a teen safety floor (same rules as RepRoom v1).
const ACTIVITY = { sedentary: [1.2, 'Mostly sitting'], light: [1.375, 'Train 1–3 days/week'],
  moderate: [1.55, 'Train 3–5 days/week'], very: [1.725, 'Train 6–7 days/week'] };
function calcTarget(p) {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * ACTIVITY[p.activity][0];
  let target = tdee, notes = [];
  if (p.goal === 'gain') { target = tdee + 250; notes.push('Gentle surplus: +250 kcal a day.'); }
  if (p.goal === 'lose') {
    const cut = Math.min(300, tdee * 0.10); target = tdee - cut;
    notes.push(`Gentle deficit: −${Math.round(cut)} kcal (never more than 300 kcal or 10%).`);
  }
  const floor = Math.max(bmr, p.age < 18 ? 1800 : 0);
  if (target < floor) {
    target = floor;
    notes.push(p.age < 18 ? "Because you're under 18, the target won't go below 1,800 kcal or your resting burn."
      : 'Raised so it never goes below your resting burn.');
  }
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), target: Math.round(target / 10) * 10, notes };
}

// ---------- Common lists (edit these to add your own) ----------
const EXERCISES = ['Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Push-ups', 'Dips', 'Chest Fly',
  'Squat', 'Leg Press', 'Romanian Deadlift', 'Deadlift', 'Lunges', 'Leg Curl', 'Leg Extension', 'Calf Raise',
  'Pull-ups', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row', 'Face Pull', 'Bicep Curl', 'Hammer Curl',
  'Tricep Pushdown', 'Skull Crushers', 'Lateral Raise', 'Plank', 'Hanging Leg Raise', 'Hip Thrust'];
const QUICK_FOODS = [
  ['Eggs (2)', 156, 12], ['Chicken breast (150 g)', 248, 46], ['Rice (1 cup)', 205, 4], ['Banana', 105, 1],
  ['Oatmeal (1 cup)', 158, 6], ['Milk (1 cup)', 122, 8], ['Greek yogurt', 130, 17], ['Protein shake', 120, 24],
  ['Peanut butter (2 tbsp)', 190, 7], ['Apple', 95, 0], ['Bread slice', 80, 3], ['Roti', 120, 3],
  ['Daal (1 cup)', 230, 12], ['Pasta (1 cup)', 220, 8]];

// ---------- Router ----------
const routes = { today: viewToday, workout: viewWorkout, food: viewFood, summary: viewSummary, settings: viewSettings };
let foodDate = today(), sumMode = 'week', sumDate = today();
function render() {
  const tab = (location.hash.slice(1) || 'today').split('?')[0];
  const fn = routes[tab] || viewToday;
  const v = $('#view'); v.onclick = null; v.oninput = null;
  v.innerHTML = fn();
  (bind[tab] || (() => {}))();
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (routes[tab] ? tab : 'today')));
  $$('.unit button').forEach(b => b.classList.toggle('on', b.dataset.unit === db.unit));
}
const bind = {};
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
$$('.unit button').forEach(b => b.onclick = () => { syncDraft(); db.unit = b.dataset.unit; save(); render(); });

// ---------- Today ----------
function ring(eaten, goal) {
  const r = 56, c = 2 * Math.PI * r, pct = goal ? Math.min(eaten / goal, 1) : 0, over = eaten > goal;
  return `<div class="ring"><svg width="130" height="130"><circle cx="65" cy="65" r="${r}" stroke="#eee8dc" stroke-width="12" fill="none"/>
    <circle cx="65" cy="65" r="${r}" stroke="${over ? '#e8893a' : '#2f7d5f'}" stroke-width="12" fill="none" stroke-linecap="round"
    stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>
    <div class="center"><b>${fmt(Math.abs(goal - eaten))}</b><span>${over ? 'kcal over' : 'kcal left'}</span></div></div>`;
}
function viewToday() {
  const d = today(), eaten = kcalOn(d), prot = proteinOn(d), ws = workoutsOn(d);
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const streak = (() => { let n = 0, x = d; if (!workoutsOn(x).length && !foodsOn(x).length) x = addDays(x, -1);
    while (workoutsOn(x).length || foodsOn(x).length) { n++; x = addDays(x, -1); } return n; })();
  return `<div class="page-head"><p class="muted">${parseD(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    <h1>${hi} 💪</h1></div>
    ${installCard()}
    <section class="card"><div class="row between"><h2>Calories</h2><a class="pill" href="#food">+ Add food</a></div>
      <div class="ring-wrap">${ring(eaten, db.goal)}
        <div class="legend"><div><span class="muted">Eaten</span><br><b>${fmt(eaten)}</b> kcal</div>
        <div><span class="muted">Goal</span><br><b>${fmt(db.goal)}</b> kcal</div>
        <div><span class="muted">Protein</span><br><b>${fmt(prot)}</b> / ${fmt(db.proteinGoal)} g</div></div></div>
      <div class="bar ${prot > db.proteinGoal ? '' : ''}" style="margin-top:12px" aria-label="Protein progress"><i style="width:${Math.min(100, prot / (db.proteinGoal || 1) * 100)}%"></i></div>
    </section>
    <section class="card"><div class="row between"><h2>Today's training</h2><a class="pill" href="#workout">+ Log workout</a></div>
      ${ws.length ? `<div class="grid3" style="margin-bottom:10px">
        <div class="stat"><span>Workouts</span><b>${ws.length}</b></div>
        <div class="stat"><span>Sets</span><b>${ws.reduce((a, w) => a + setsOf(w), 0)}</b></div>
        <div class="stat"><span>Volume</span><b>${fmt(toUnit(ws.reduce((a, w) => a + volumeOf(w), 0)))}</b></div></div>
        <ul class="list">${ws.map(w => `<li><div class="grow"><div class="name">${esc(w.name || 'Workout')}</div>
          <div class="muted small">${w.exercises.map(e => esc(e.name)).join(' · ')}</div></div><span class="pill">${setsOf(w)} sets</span></li>`).join('')}</ul>`
      : `<div class="empty">No workout logged yet today.<br>Rest days count too.</div>`}
    </section>
    <section class="card"><div class="grid2">
      <div class="stat"><span>Active streak</span><b>${streak} day${streak === 1 ? '' : 's'}</b></div>
      <div class="stat"><span>This week</span><b>${weekDays(d).reduce((a, x) => a + workoutsOn(x).length, 0)} workouts</b></div></div>
    </section>`;
}
function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || localStorage.getItem('reproom.hideInstall')) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<section class="card install"><div class="row between"><b>Add RepRoom to your home screen</b>
    <button class="icon-btn" id="hideInstall" style="color:#fff" aria-label="Hide">${ICON.x}</button></div>
    <p class="muted small" style="margin-top:6px">${ios ? 'In Safari, tap the Share button, then “Add to Home Screen”.'
      : 'In Chrome, tap the ⋮ menu, then “Add to Home screen” or “Install app”.'} It works offline after that.</p>
    ${deferredPrompt ? '<button class="btn soft sm" id="installBtn" style="margin-top:10px">Install now</button>' : ''}</section>`;
}
bind.today = () => {
  const h = $('#hideInstall'); if (h) h.onclick = () => { localStorage.setItem('reproom.hideInstall', '1'); render(); };
  const i = $('#installBtn'); if (i) i.onclick = async () => { deferredPrompt.prompt(); deferredPrompt = null; render(); };
};
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if ((location.hash || '#today') === '#today') render(); });

// ---------- Workout ----------
const newDraft = () => ({ date: today(), name: '', notes: '', exercises: [] });
function viewWorkout() {
  if (!db.draft) db.draft = newDraft();
  const w = db.draft;
  const past = [...db.workouts].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const u = db.unit;
  return `<div class="page-head"><h1>${w.id ? 'Edit workout' : 'Log workout'}</h1>
    <p class="muted">Add exercises, then sets with reps and weight (${u}). Use 0 for bodyweight.</p></div>
    <section class="card">
      <div class="grid2"><div class="field"><label for="wDate">Date</label><input type="date" id="wDate" value="${w.date}" max="${today()}"></div>
      <div class="field"><label for="wName">Name</label><input id="wName" placeholder="Push day" value="${esc(w.name)}"></div></div>
      <div id="exList">${w.exercises.length ? w.exercises.map((e, i) => exHtml(e, i)).join('')
        : '<div class="empty" style="margin-bottom:12px">No exercises yet. Add your first one below.</div>'}</div>
      <div class="chips" style="margin-bottom:12px">${['Bench Press', 'Squat', 'Deadlift', 'Pull-ups', 'Overhead Press', 'Bicep Curl']
        .map(n => `<button class="chip" data-quick="${n}">+ ${n}</button>`).join('')}</div>
      <button class="btn ghost block" id="addEx">+ Add exercise</button>
      <div class="field" style="margin-top:12px"><label for="wNotes">Notes</label><textarea id="wNotes" placeholder="How did it feel? (optional)">${esc(w.notes)}</textarea></div>
      <div class="grid2"><button class="btn ghost" id="clearW">${w.id ? 'Cancel edit' : 'Clear'}</button><button class="btn" id="saveW">Save workout</button></div>
    </section>
    <section class="card"><h2>History</h2>
      ${past.length ? past.map(p => `<details class="wk"><summary><div class="row between" style="padding:8px 0;border-top:1px solid var(--line)">
        <div class="grow"><div class="name">${esc(p.name || 'Workout')}</div><div class="muted small">${niceDate(p.date)} · ${p.exercises.length} exercises · ${setsOf(p)} sets</div></div>
        <span class="pill">${fmt(toUnit(volumeOf(p)))} ${u}</span></div></summary>
        <div class="wk-body">${p.exercises.map(e => `<div><b>${esc(e.name)}</b>: ${e.sets.map(s => `${num(s.reps)}×${showW(s.kg)}`).join(', ')}</div>`).join('')}
        ${p.notes ? `<div class="muted">${esc(p.notes)}</div>` : ''}
        <div class="row" style="margin:8px 0"><button class="btn soft sm" data-edit="${p.id}">Edit</button>
        <button class="btn soft sm" data-repeat="${p.id}">Repeat today</button><button class="btn danger sm" data-delw="${p.id}">Delete</button></div></div></details>`).join('')
      : '<div class="empty">Saved workouts show up here.</div>'}
    </section>`;
}
function exHtml(e, i) {
  return `<div class="ex" data-ex="${i}"><div class="ex-head"><input list="exercise-list" class="exName" placeholder="Exercise name" value="${esc(e.name)}" aria-label="Exercise name">
    <button class="icon-btn" data-delex="${i}" aria-label="Remove exercise">${ICON.trash}</button></div>
    <div class="sets-head"><span>Set</span><span>Reps</span><span>${db.unit}</span><span></span></div>
    ${e.sets.map((s, j) => `<div class="set" data-set="${j}"><div class="num">${j + 1}</div>
      <input class="reps" type="number" inputmode="numeric" min="0" placeholder="10" value="${s.reps ?? ''}" aria-label="Reps">
      <input class="wt" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${s.kg === '' || s.kg == null ? '' : showW(s.kg)}" aria-label="Weight">
      <button class="icon-btn" data-delset="${i}:${j}" aria-label="Remove set">${ICON.x}</button></div>`).join('')}
    <button class="btn soft sm" data-addset="${i}" style="margin-top:4px">+ Add set</button></div>`;
}
// Copy what's typed in the form into db.draft so nothing is lost on re-render.
function syncDraft() {
  if (!db.draft || !$('#wDate')) return;
  const w = db.draft;
  w.date = $('#wDate').value || today(); w.name = $('#wName').value.trim(); w.notes = $('#wNotes').value;
  $$('.ex').forEach(el => {
    const e = w.exercises[+el.dataset.ex]; if (!e) return;
    e.name = $('.exName', el).value.trim();
    $$('.set', el).forEach(r => { const s = e.sets[+r.dataset.set];
      s.reps = r.querySelector('.reps').value === '' ? '' : num(r.querySelector('.reps').value);
      const wv = r.querySelector('.wt').value; s.kg = wv === '' ? '' : fromUnit(wv); });
  });
  save();
}
bind.workout = () => {
  const v = $('#view'), w = db.draft;
  const rerender = () => { save(); render(); };
  v.oninput = () => syncDraft();
  const addEx = name => { syncDraft(); w.exercises.push({ name, sets: [{ reps: '', kg: '' }] }); rerender();
    const all = $$('.ex'); const last = all[all.length - 1]; if (last) (name ? $('.reps', last) : $('.exName', last)).focus(); };
  $('#addEx').onclick = () => addEx('');
  $$('[data-quick]').forEach(b => b.onclick = () => addEx(b.dataset.quick));
  v.onclick = ev => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.addset != null) { syncDraft(); const e = w.exercises[+t.dataset.addset]; const last = e.sets[e.sets.length - 1] || {};
      e.sets.push({ reps: last.reps ?? '', kg: last.kg ?? '' }); rerender(); }
    else if (t.dataset.delset) { syncDraft(); const [i, j] = t.dataset.delset.split(':').map(Number); w.exercises[i].sets.splice(j, 1);
      if (!w.exercises[i].sets.length) w.exercises.splice(i, 1); rerender(); }
    else if (t.dataset.delex != null) { syncDraft(); w.exercises.splice(+t.dataset.delex, 1); rerender(); }
    else if (t.dataset.delw) { if (confirm('Delete this workout?')) { db.workouts = db.workouts.filter(x => x.id !== t.dataset.delw); rerender(); toast('Workout deleted'); } }
    else if (t.dataset.edit || t.dataset.repeat) {
      const src = db.workouts.find(x => x.id === (t.dataset.edit || t.dataset.repeat)); if (!src) return;
      const copy = JSON.parse(JSON.stringify(src));
      if (t.dataset.repeat) { delete copy.id; copy.date = today(); copy.notes = ''; }
      db.draft = copy; rerender(); window.scrollTo(0, 0); toast(t.dataset.edit ? 'Editing workout' : 'Copied. Adjust and save.');
    }
  };
  $('#clearW').onclick = () => { if (w.exercises.length && !w.id && !confirm('Clear this workout?')) return; db.draft = newDraft(); rerender(); };
  $('#saveW').onclick = () => {
    syncDraft();
    const ex = w.exercises.map(e => ({ name: e.name || 'Exercise', sets: e.sets.filter(s => num(s.reps) > 0).map(s => ({ reps: num(s.reps), kg: num(s.kg) })) }))
      .filter(e => e.sets.length);
    if (!ex.length) { toast('Add at least one set with reps'); return; }
    const rec = { id: w.id || uid(), date: w.date, name: w.name || defaultName(ex), notes: w.notes.trim(), exercises: ex };
    const i = db.workouts.findIndex(x => x.id === rec.id);
    if (i >= 0) db.workouts[i] = rec; else db.workouts.push(rec);
    db.draft = newDraft(); rerender(); toast(`Saved · ${setsOf(rec)} sets`);
  };
};
const defaultName = ex => ex.length === 1 ? ex[0].name : `${ex[0].name} + ${ex.length - 1} more`;

// ---------- Food ----------
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const guessMeal = () => { const h = new Date().getHours(); return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snack'; };
function viewFood() {
  const d = foodDate, eaten = kcalOn(d), pct = db.goal ? eaten / db.goal * 100 : 0, items = foodsOn(d);
  const recent = []; const seen = new Set();
  [...db.foods].reverse().forEach(f => { const k = f.name.toLowerCase(); if (!seen.has(k) && recent.length < 8) { seen.add(k); recent.push([f.name, f.kcal, f.protein]); } });
  return `<div class="page-head"><h1>Food</h1><p class="muted">Log what you eat and track your daily calorie goal.</p></div>
    <div class="row between card" style="padding:8px">
      <button class="icon-btn" id="prevD" aria-label="Previous day"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <b>${niceDate(d)}</b>
      <button class="icon-btn" id="nextD" aria-label="Next day" ${d >= today() ? 'disabled style="opacity:.3"' : ''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
    <section class="card"><div class="row between" style="margin-bottom:8px"><b>${fmt(eaten)} / ${fmt(db.goal)} kcal</b>
      <span class="muted">${eaten > db.goal ? fmt(eaten - db.goal) + ' over' : fmt(db.goal - eaten) + ' left'}</span></div>
      <div class="bar ${eaten > db.goal ? 'over' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>
      <p class="muted small" style="margin-top:8px">Protein: ${fmt(proteinOn(d))} / ${fmt(db.proteinGoal)} g</p></section>
    <section class="card"><h2>Add food</h2>
      <form id="foodForm" autocomplete="off">
        <div class="field"><label for="fName">Food</label><input id="fName" required placeholder="e.g. Chicken wrap"></div>
        <div class="grid2"><div class="field"><label for="fKcal">Calories</label><input id="fKcal" type="number" inputmode="numeric" min="0" required placeholder="kcal"></div>
        <div class="field"><label for="fProt">Protein (g)</label><input id="fProt" type="number" inputmode="decimal" min="0" placeholder="optional"></div></div>
        <div class="field"><label for="fMeal">Meal</label><select id="fMeal">${MEALS.map(m => `<option ${m === guessMeal() ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <button class="btn block" type="submit">Add</button>
      </form>
      ${recent.length ? `<p class="muted small" style="margin:14px 0 8px">Recent: tap to add again</p><div class="chips">${recent.map(chip).join('')}</div>` : ''}
      <p class="muted small" style="margin:14px 0 8px">Quick add (approximate)</p><div class="chips">${QUICK_FOODS.map(chip).join('')}</div>
    </section>
    <section class="card"><h2>${niceDate(d)}'s log</h2>
      ${items.length ? MEALS.filter(m => items.some(f => f.meal === m)).map(m => {
        const list = items.filter(f => f.meal === m);
        return `<div class="row between" style="margin:10px 0 2px"><b>${m}</b><span class="muted small">${fmt(list.reduce((a, f) => a + num(f.kcal), 0))} kcal</span></div>
          <ul class="list">${list.map(f => `<li><div class="grow"><div class="name">${esc(f.name)}</div>${num(f.protein) ? `<div class="muted small">${fmt(f.protein)} g protein</div>` : ''}</div>
          <b>${fmt(f.kcal)}</b><button class="icon-btn" data-delf="${f.id}" aria-label="Delete ${esc(f.name)}">${ICON.trash}</button></li>`).join('')}</ul>`; }).join('')
      : '<div class="empty">Nothing logged for this day yet.</div>'}
    </section>`;
}
const chip = ([n, k, p]) => `<button class="chip" data-n="${esc(n)}" data-k="${k}" data-p="${p || 0}">${esc(n)} · ${fmt(k)}</button>`;
bind.food = () => {
  const add = (name, kcal, protein, meal) => { db.foods.push({ id: uid(), date: foodDate, name, kcal: num(kcal), protein: num(protein), meal: meal || guessMeal() }); save(); render(); toast(`Added ${name}`); };
  $('#foodForm').onsubmit = e => { e.preventDefault(); const n = $('#fName').value.trim(), k = $('#fKcal').value;
    if (!n || k === '') return; add(n, k, $('#fProt').value, $('#fMeal').value); };
  $$('.chip[data-k]').forEach(c => c.onclick = () => add(c.dataset.n, c.dataset.k, c.dataset.p, $('#fMeal').value));
  $$('[data-delf]').forEach(b => b.onclick = () => { db.foods = db.foods.filter(f => f.id !== b.dataset.delf); save(); render(); toast('Removed'); });
  $('#prevD').onclick = () => { foodDate = addDays(foodDate, -1); render(); };
  $('#nextD').onclick = () => { if (foodDate < today()) { foodDate = addDays(foodDate, 1); render(); } };
};

// ---------- Summary ----------
const weekDays = end => Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
function viewSummary() {
  return `<div class="page-head"><h1>Summary</h1><p class="muted">How your training and eating are going.</p></div>
    <div class="seg"><button data-mode="day" class="${sumMode === 'day' ? 'on' : ''}">Day</button><button data-mode="week" class="${sumMode === 'week' ? 'on' : ''}">Last 7 days</button></div>
    ${sumMode === 'day' ? daySummary() : weekSummary()}`;
}
function daySummary() {
  const d = sumDate, ws = workoutsOn(d), eaten = kcalOn(d);
  const exs = {}; ws.forEach(w => w.exercises.forEach(e => { (exs[e.name] = exs[e.name] || []).push(...e.sets); }));
  return `<section class="card"><div class="field"><label for="sDate">Day</label><input type="date" id="sDate" value="${d}" max="${today()}"></div>
    <div class="grid2"><div class="stat"><span>Calories</span><b>${fmt(eaten)}</b><span>of ${fmt(db.goal)}</span></div>
    <div class="stat"><span>Protein</span><b>${fmt(proteinOn(d))} g</b><span>of ${fmt(db.proteinGoal)} g</span></div>
    <div class="stat"><span>Sets</span><b>${ws.reduce((a, w) => a + setsOf(w), 0)}</b></div>
    <div class="stat"><span>Volume (${db.unit})</span><b>${fmt(toUnit(ws.reduce((a, w) => a + volumeOf(w), 0)))}</b></div></div>
    <div class="bar ${eaten > db.goal ? 'over' : ''}" style="margin-top:12px"><i style="width:${Math.min(100, eaten / (db.goal || 1) * 100)}%"></i></div></section>
    <section class="card"><h2>Exercises</h2>${Object.keys(exs).length ? `<ul class="list">${Object.entries(exs).map(([n, s]) => {
      const best = s.reduce((a, b) => num(b.kg) > num(a.kg) ? b : a, s[0]);
      return `<li><div class="grow"><div class="name">${esc(n)}</div><div class="muted small">${s.map(x => `${x.reps}×${showW(x.kg)}`).join(', ')}</div></div>
        <span class="pill">Top ${showW(best.kg)} ${db.unit}</span></li>`; }).join('')}</ul>` : '<div class="empty">No training this day.</div>'}</section>`;
}
function weekSummary() {
  const days = weekDays(today());
  const kc = days.map(kcalOn), max = Math.max(db.goal * 1.2, ...kc, 1);
  const logged = kc.filter(k => k > 0), avg = logged.length ? logged.reduce((a, b) => a + b, 0) / logged.length : 0;
  const onTarget = kc.filter(k => k > 0 && Math.abs(k - db.goal) <= db.goal * 0.1).length;
  const ws = days.flatMap(workoutsOn), sets = ws.reduce((a, w) => a + setsOf(w), 0), vol = ws.reduce((a, w) => a + volumeOf(w), 0);
  const prevWs = weekDays(addDays(today(), -7)).flatMap(workoutsOn), prevVol = prevWs.reduce((a, w) => a + volumeOf(w), 0);
  const change = prevVol ? Math.round((vol - prevVol) / prevVol * 100) : null;
  const count = {}; ws.forEach(w => w.exercises.forEach(e => count[e.name] = (count[e.name] || 0) + e.sets.length));
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `<section class="card"><div class="row between"><h2>Calories</h2><span class="muted small">dashed line = goal</span></div>
    <div class="chart"><div class="goal-line" style="bottom:${20 + db.goal / max * 124}px"><span>${fmt(db.goal)}</span></div>
      ${days.map((d, i) => `<div class="col"><div class="b ${kc[i] === 0 ? 'zero' : kc[i] > db.goal * 1.1 ? 'over' : ''}" style="height:${kc[i] / max * 124}px" title="${fmt(kc[i])} kcal"></div>
      <span class="lbl ${d === today() ? 'today' : ''}">${parseD(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('')}</div>
    <div class="dots">${days.map(d => `<i title="workouts">${workoutsOn(d).length ? '🏋️' : '·'}</i>`).join('')}</div>
    <div class="grid2" style="margin-top:12px"><div class="stat"><span>Avg / logged day</span><b>${fmt(avg)}</b></div>
      <div class="stat"><span>Days on target</span><b>${onTarget} / 7</b></div></div>
    <p class="muted small" style="margin-top:8px">“On target” means within 10% of your ${fmt(db.goal)} kcal goal.</p></section>
    <section class="card"><h2>Training</h2><div class="grid3">
      <div class="stat"><span>Workouts</span><b>${ws.length}</b></div><div class="stat"><span>Sets</span><b>${sets}</b></div>
      <div class="stat"><span>Volume</span><b>${fmt(toUnit(vol))}</b></div></div>
      <p class="muted small" style="margin-top:8px">Volume = reps × weight (${db.unit}).${change === null ? '' : ` ${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs the 7 days before.`}</p>
      ${top.length ? `<p class="muted small" style="margin:12px 0 4px">Most trained</p><ul class="list">${top.map(([n, s]) => `<li><span class="name">${esc(n)}</span><span class="pill">${s} sets</span></li>`).join('')}</ul>` : ''}
    </section>
    <section class="card"><h2>Day by day</h2><ul class="list">${[...days].reverse().map(d => `<li><button class="chip" data-day="${d}" style="border:0;padding:0;background:none;font-weight:600">${niceDate(d)}</button>
      <span class="muted small">${fmt(kcalOn(d))} kcal · ${workoutsOn(d).reduce((a, w) => a + setsOf(w), 0)} sets</span></li>`).join('')}</ul></section>`;
}
bind.summary = () => {
  $$('[data-mode]').forEach(b => b.onclick = () => { sumMode = b.dataset.mode; render(); });
  const s = $('#sDate'); if (s) s.onchange = () => { sumDate = s.value || today(); render(); };
  $$('[data-day]').forEach(b => b.onclick = () => { sumDate = b.dataset.day; sumMode = 'day'; render(); });
};

// ---------- Settings ----------
function viewSettings() {
  const p = db.profile || { age: 17, sex: 'male', heightCm: 175, weightKg: 70, activity: 'moderate', goal: 'maintain' };
  const lbs = db.unit === 'lb';
  return `<div class="page-head"><h1>Settings</h1><p class="muted">Your goals and data. Everything stays on this phone.</p></div>
    <section class="card"><h2>Daily goals</h2>
      <div class="grid2"><div class="field"><label for="goal">Calories (kcal)</label><input id="goal" type="number" inputmode="numeric" min="1000" max="6000" value="${db.goal}"></div>
      <div class="field"><label for="pgoal">Protein (g)</label><input id="pgoal" type="number" inputmode="numeric" min="0" max="400" value="${db.proteinGoal}"></div></div>
      <button class="btn block" id="saveGoal">Save goals</button></section>
    <section class="card"><h2>Calorie goal calculator</h2>
      <p class="muted small" style="margin-bottom:12px">Estimates what you burn (Mifflin–St Jeor) and suggests a safe daily goal.</p>
      <div class="grid2"><div class="field"><label for="pAge">Age</label><input id="pAge" type="number" inputmode="numeric" min="13" max="100" value="${p.age}"></div>
      <div class="field"><label for="pSex">Sex</label><select id="pSex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option></select></div>
      <div class="field"><label for="pH">Height (cm)</label><input id="pH" type="number" inputmode="decimal" value="${p.heightCm}"></div>
      <div class="field"><label for="pW">Weight (${lbs ? 'lb' : 'kg'})</label><input id="pW" type="number" inputmode="decimal" value="${Math.round(toUnit(p.weightKg) * 10) / 10}"></div></div>
      <div class="field"><label for="pAct">Activity</label><select id="pAct">${Object.entries(ACTIVITY).map(([k, [, l]]) => `<option value="${k}" ${p.activity === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="pGoal">Goal</label><select id="pGoal">
        <option value="maintain" ${p.goal === 'maintain' ? 'selected' : ''}>Maintain weight</option>
        <option value="gain" ${p.goal === 'gain' ? 'selected' : ''}>Build muscle (gentle surplus)</option>
        <option value="lose" ${p.goal === 'lose' ? 'selected' : ''}>Lean out (gentle deficit)</option></select></div>
      <div id="calcOut"></div>
      <div class="grid2"><button class="btn ghost" id="calc">Calculate</button><button class="btn" id="useCalc">Use as my goal</button></div>
      <p class="note">This is an estimate, not medical advice. If you're under 18 or have health concerns, check with a doctor before changing how you eat.</p></section>
    <section class="card"><h2>Backup</h2><p class="muted small" style="margin-bottom:12px">Your data lives in this browser only. Save a backup file before switching phones or clearing browser data.</p>
      <div class="grid2"><button class="btn soft" id="exportBtn">Export backup</button><label class="btn soft" style="margin:0">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label></div></section>
    <section class="card"><h2>Danger zone</h2><button class="btn danger block" id="resetBtn">Delete all data</button>
      <p class="muted small" style="margin-top:10px">${db.workouts.length} workouts · ${db.foods.length} food entries saved · RepRoom v2</p></section>`;
}
function readProfile() {
  return { age: num($('#pAge').value), sex: $('#pSex').value, heightCm: num($('#pH').value), weightKg: fromUnit($('#pW').value),
    activity: $('#pAct').value, goal: $('#pGoal').value };
}
bind.settings = () => {
  $('#saveGoal').onclick = () => {
    const g = num($('#goal').value), pg = num($('#pgoal').value);
    if (g < 1000 || g > 6000) { toast('Pick a calorie goal between 1,000 and 6,000'); return; }
    db.goal = Math.round(g); db.proteinGoal = Math.round(pg); save(); toast('Goals saved');
  };
  const show = () => {
    const p = readProfile();
    if (p.age < 13 || p.age > 100 || p.heightCm < 100 || p.heightCm > 250 || p.weightKg < 30 || p.weightKg > 300) { $('#calcOut').innerHTML = '<p class="note">Check your age, height and weight.</p>'; return null; }
    const r = calcTarget(p);
    $('#calcOut').innerHTML = `<div class="grid3" style="margin-bottom:10px"><div class="stat"><span>Resting</span><b>${fmt(r.bmr)}</b></div>
      <div class="stat"><span>You burn</span><b>${fmt(r.tdee)}</b></div><div class="stat"><span>Goal</span><b>${fmt(r.target)}</b></div></div>
      ${r.notes.map(n => `<p class="muted small" style="margin-bottom:6px">${n}</p>`).join('')}`;
    return { p, r };
  };
  $('#calc').onclick = show;
  $('#useCalc').onclick = () => { const x = show(); if (!x) return; db.profile = x.p; db.goal = x.r.target;
    db.proteinGoal = Math.round(x.p.weightKg * 1.6); save(); render(); toast(`Goal set to ${fmt(x.r.target)} kcal`); };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'RepRoom', version: 2, exported: new Date().toISOString(), ...db, draft: null }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `reproom-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.workouts) || !Array.isArray(d.foods)) throw 0;
      if (!confirm('Replace your current data with this backup?')) return;
      db = Object.assign(defaults(), d); delete db.app; delete db.version; delete db.exported; save(); render(); toast('Backup restored');
    } catch { toast("That file isn't a RepRoom backup"); }
  };
  $('#resetBtn').onclick = () => { if (confirm('Delete ALL workouts and food logs? This cannot be undone.')) { db = defaults(); save(); render(); toast('All data deleted'); } };
};

// ---------- Start ----------
$('#exercise-list').innerHTML = EXERCISES.map(e => `<option value="${e}">`).join('');
render();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
