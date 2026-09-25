// A small daily practice, independent of feed refreshes and model calls.
(function(root) {
  'use strict';
  var prompts = [
    ['Notice the overlooked', 'A useful idea often starts with something ordinary that everyone has stopped questioning.', 'Notice one recurring frustration today. Write down who experiences it and what makes it annoying.', 'Sketch a small fix for that frustration. What could you try without buying or building anything?'],
    ['Borrow a different lens', 'A familiar problem can look different through someone else’s eyes.', 'Describe a current problem as your customer would describe it, without using your professional vocabulary.', 'Describe the same problem from three perspectives. Find one need your original framing missed.'],
    ['Make the first move smaller', 'You do not need a perfect plan to make one useful move.', 'Pick something you have been putting off. Do just its first two-minute step.', 'Make a rough first version of one thing you have been postponing. Stop polishing and name the next step.'],
    ['Look for the exception', 'The example that does not fit can be more revealing than another example that does.', 'Choose a belief you use at work. Write one situation where it might not hold.', 'Find a counterexample in your notes or a source you trust. Write how it changes the limits of your belief.'],
    ['Connect two worlds', 'An idea from outside your usual field can open a new route into a familiar challenge.', 'Pick a hobby and a work problem. Write one principle from the hobby that might help.', 'Explore that connection with a concrete example. Name where the analogy helps and where it breaks.'],
    ['Follow a real question', 'Curiosity becomes useful when you can say exactly what you want to understand.', 'Write one question you would enjoy answering, even if nobody asked you to.', 'Read one original source about that question. Capture one thing learned and one thing still unclear.'],
    ['Collect a small win', 'Quiet progress still counts. Give yourself evidence that you are moving.', 'Write down one thing you handled better recently and what helped.', 'Turn that win into a repeatable practice. Try it once on something you need to do today.'],
    ['Explain it simply', 'Explaining an idea in plain words can reveal the part you have not understood yet.', 'Explain one idea you learned this week in three sentences a friend could understand.', 'Add a concrete example and an exception. Look up the part you struggled to explain.'],
    ['Test one assumption', 'A small experiment can teach you something that more planning cannot.', 'Name one assumption behind a current plan. What observation would make you reconsider?', 'Design a low-cost experiment with a clear observation and a stopping point. Take its first step.'],
    ['Make room to notice', 'A little space can help you see what a crowded day hides.', 'Step away from your feed for two minutes. Notice something around you and write a question about it.', 'Take a short walk or quiet break. Return with three observations and choose one to explore.'],
    ['Find the missing voice', 'The people closest to a problem may see something the summary leaves out.', 'Think of one person whose experience would improve your understanding. Draft a thoughtful question for them.', 'Read a first-person account related to your work or interests. Record how it differs from your assumptions.'],
    ['Turn a headline into a question', 'Information becomes more useful when it changes what you ask or do.', 'Open today’s briefing below. Choose one item and write: “What would I need to know before acting on this?”', 'Check the original source for one briefing item. Separate what it establishes from what you are inferring.'],
    ['Leave something easier', 'A small improvement today can give your future self more room to think.', 'Remove one tiny source of friction: clarify a note, prepare a file, or write your next starting step.', 'Improve one recurring task with a short checklist or reusable example. Try it on a real case.'],
    ['Choose what matters', 'A productive day can include choosing what deserves less of your attention.', 'Name one thing that would make today feel worthwhile. Give it a small, specific next action.', 'Spend ten focused minutes on that action. Write what moved forward and what you can leave for later.']
  ];
  function dateKey(now) {
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now || new Date());
  }
  function promptFor(day, offset) {
    var index = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
    return prompts[((index + (offset || 0)) % prompts.length + prompts.length) % prompts.length];
  }
  function clean(value) {
    var result = {};
    if (!value || typeof value !== 'object') return result;
    Object.keys(value).filter(function(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day); }).sort().slice(-90).forEach(function(day) {
      var item = value[day];
      if (!item || typeof item !== 'object') return;
      result[day] = {energy:item.energy === 'stretch' ? 'stretch' : 'gentle', offset:Number.isInteger(item.offset) && item.offset >= 0 ? item.offset % prompts.length : 0, done:item.done === true, note:typeof item.note === 'string' ? item.note.slice(0,1200) : ''};
    });
    return result;
  }
  root.DailyBoostCore = {dateKey:dateKey,promptFor:promptFor,clean:clean};
  if (!root.document) return;
  var records = {}, account = null, day = null, failed = false;
  function el(id) { return document.getElementById('boost-' + id); }
  function current() { return records[day] || (records[day] = {energy:'gentle',offset:0,done:false,note:''}); }
  function status() { el('status').textContent = failed ? 'Could not save on this device. Keep this page open and copy your note before leaving.' : account ? 'Saved on this device only · up to 90 daily entries · private to this sign-in' : 'Sign in to save your small wins.'; }
  function persist() {
    if (!account) { status(); return; }
    try { records = clean(records); root.localStorage.setItem('bob-daily-boost:' + account, JSON.stringify(records)); failed = false; }
    catch (error) { failed = true; }
    status();
  }
  function renderHistory() {
    var list = el('history'); list.replaceChildren();
    var days = Object.keys(records).filter(function(key) { return key < day && (records[key].note || records[key].done); }).sort().reverse().slice(0,7);
    el('history-title').textContent = days.length ? 'Your recent discoveries (' + days.length + ')' : 'Your recent discoveries';
    if (!days.length) { list.textContent = 'Your reflections will collect here. A missed day is just a missed day; start again whenever you like.'; return; }
    days.forEach(function(key) {
      var entry = document.createElement('article'), heading = document.createElement('h4'), note = document.createElement('p');
      heading.textContent = key + ' · ' + promptFor(key,records[key].offset)[0] + (records[key].done ? ' · Done' : '');
      note.textContent = records[key].note || 'Made time for a small quest.';
      entry.append(heading,note); list.appendChild(entry);
    });
  }
  function render() {
    if (!el('title')) return;
    var uid = root._firebaseUid || null;
    if (uid !== account) {
      account = uid; records = {}; failed = false;
      if (account) try { records = clean(JSON.parse(root.localStorage.getItem('bob-daily-boost:' + account) || '{}')); } catch (error) { failed = true; }
    }
    day = dateKey();
    var item = current(), prompt = promptFor(day,item.offset);
    el('date').textContent = day + ' · A fresh perspective each day';
    el('title').textContent = prompt[0]; el('thought').textContent = prompt[1];
    el('quest').textContent = prompt[item.energy === 'stretch' ? 3 : 2];
    el('duration').textContent = item.energy === 'stretch' ? '10-minute exploration' : '2-minute small step';
    ['gentle','stretch'].forEach(function(energy) { el(energy).setAttribute('aria-pressed',String(item.energy === energy)); el(energy).disabled = item.done; });
    el('note').value = item.note;
    el('done').textContent = item.done ? '✓ Small win captured · Undo' : 'I did it';
    el('done').setAttribute('aria-pressed',String(item.done));
    el('swap').disabled = item.done;
    el('feedback').textContent = item.done ? 'That counts. Take the idea with you into your day.' : 'One small step is enough. You set the pace.';
    status(); renderHistory();
  }
  root.renderDailyBoost = render;
  root.resetDailyBoost = function() { records = {}; account = null; day = null; if (el('note')) { el('note').value = ''; el('history').replaceChildren(); el('feedback').textContent = ''; } };
  document.addEventListener('DOMContentLoaded',function() {
    if (!el('title')) return;
    ['gentle','stretch'].forEach(function(energy) { el(energy).addEventListener('click',function() { render(); if (!current().done) current().energy = energy; persist(); render(); }); });
    el('swap').addEventListener('click',function() { render(); if (!current().done) current().offset = (current().offset + 1) % prompts.length; persist(); render(); });
    el('done').addEventListener('click',function() { render(); current().done = !current().done; persist(); render(); });
    el('note').addEventListener('input',function() {
      // Keep a late-night draft attached to the day on which it was started.
      if (account !== (root._firebaseUid || null)) { render(); return; }
      current().note = el('note').value.slice(0,1200); persist();
    });
    document.addEventListener('visibilitychange',function() { if (!document.hidden && day !== dateKey()) render(); });
    root.setInterval(function() { if (!document.hidden && day !== dateKey() && document.activeElement !== el('note')) render(); },60000);
    render();
  });
})(typeof window !== 'undefined' ? window : globalThis);
