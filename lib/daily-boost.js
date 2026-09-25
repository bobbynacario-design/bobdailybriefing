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
  // Append only: saved reflections use these stable catalog positions.
  var themes = ['Curiosity','Perspective','Momentum','Perspective','Creativity','Curiosity','Confidence','Curiosity','Perspective','Reset','Connection','Curiosity','Momentum','Reset'];
  [
    ['Curiosity','Follow the unfamiliar word','One unfamiliar word can be a doorway into a whole new subject.','Choose a word you encountered recently. Write what you think it means, then check a reliable reference.','Find an example of the idea in everyday life. Explain how the example changed your first definition.'],
    ['Curiosity','Ask how it got here','Ordinary objects carry stories of design, trade, and human choices.','Pick an object on your desk. Write three questions about how it was made.','Investigate one question using a maker or museum source. Keep one surprising detail and its source.'],
    ['Curiosity','Chase the mechanism','Knowing the name of something is only the beginning of understanding it.','Choose something you use every day. Sketch how you think it works.','Check your sketch against an explanation from its creator or a trusted reference. Mark the missing step.'],
    ['Curiosity','Build a question ladder','A better question can move you beyond the first obvious answer.','Start with something that puzzles you. Ask “why?” once, then ask “how could I check?”','Write three possible explanations and one observation that would help distinguish them.'],
    ['Perspective','Separate seeing from assuming','An observation and the story you attach to it are two different things.','Divide a note into “What I observed” and “What I assumed.” Add one item to each.','Write two other explanations for the same observation. Name what evidence would help you choose.'],
    ['Perspective','Zoom out one level','A close view shows details; a wider view can reveal what connects them.','Choose a frustrating task. Name the larger purpose it serves.','Draw the steps before and after that task. Find one handoff that could be clearer.'],
    ['Perspective','Try the opposite question','Reversing a question can expose a choice you have not considered.','Instead of asking how to add more, ask what you could remove from a current task.','Make a simpler version of a plan. Identify what it still achieves and what you would lose.'],
    ['Perspective','Give disagreement a fair hearing','Understanding an opposing view can sharpen your own thinking.','Write the strongest fair version of a view you disagree with.','Find an original explanation from someone who holds that view. Note one point you had overlooked.'],
    ['Creativity','Make three imperfect versions','A first idea is a starting point, not a verdict on your imagination.','Write three different titles, openings, or approaches for something you are making.','Develop the least obvious version for ten minutes. Keep one element that surprises you.'],
    ['Creativity','Use a useful constraint','A boundary can give your imagination something concrete to work with.','Describe your idea in exactly six words.','Create a rough version using only what you already have. Notice what the constraint helped you choose.'],
    ['Creativity','Change the medium','A thought can reveal a new side when you give it a different form.','Turn a written idea into a quick sketch or diagram.','Explain a difficult idea as a short story with a person, a problem, and a choice.'],
    ['Creativity','Keep the odd idea','An unusual idea does not have to be practical immediately to be worth exploring.','Write one deliberately unusual solution to a small problem.','Find the useful principle inside that solution. Adapt it into something you could actually try.'],
    ['Creativity','Remix something familiar','You can create by changing one part of something you already understand.','Pick a familiar routine and imagine changing its order, setting, or audience.','Sketch two variations. Try the smallest reversible change and record what you notice.'],
    ['Momentum','Close a tiny loop','A small unfinished task can be a good place to regain movement.','Finish one task that genuinely takes less than two minutes.','Choose a loose end and bring it to a clear stopping point. Write what “finished for now” means.'],
    ['Momentum','Prepare the next beginning','Starting can be easier when the first step is already waiting for you.','Write the exact first action for a task you want to start tomorrow.','Prepare the materials and a rough outline so you can begin without another planning session.'],
    ['Momentum','Make progress visible','A visible trace can help you recognize work that otherwise feels invisible.','Write one thing that is clearer or further along than it was yesterday.','Compare an earlier draft or note with today’s version. Name the change and what helped it happen.'],
    ['Momentum','Choose a finish line','A small clear finish line can make an open-ended task feel approachable.','Define what you could reasonably finish in the next ten minutes.','Work toward that finish line, then stop and record what is done and what remains.'],
    ['Confidence','Remember a learned skill','Something that feels natural now may once have felt difficult.','Name one skill you learned through practice. Recall an awkward early attempt.','Break that learning process into steps. Borrow one step for something you are learning now.'],
    ['Confidence','Make room for beginner work','Being new at something gives you permission to practice without performing.','Choose one skill you would enjoy trying. Make a deliberately rough first attempt.','Practice one small part of that skill for ten minutes. Record a discovery rather than a score.'],
    ['Confidence','Use your own measure','You can choose a measure of progress that reflects what matters to you.','Finish this sentence: “Today, enough would look like…”','Choose one action that matches your answer. Notice whether your usual to-do list gives it any room.'],
    ['Confidence','Recognize your contribution','Your contribution may be clearer when you describe its effect on someone else.','Recall one time your effort made someone’s day or work easier.','Name the ability behind that contribution and one small way to use it again this week.'],
    ['Confidence','Write a kinder instruction','The words you use with yourself can leave more room for a next attempt.','Rewrite one harsh self-instruction as advice you would give a friend.','Use that advice on a real task. Write a specific next step without judging your character.'],
    ['Reset','Let one thing wait','Choosing a pause can be a deliberate use of your attention.','Name one nonessential task that can wait today. Write when you will reconsider it.','Review your list and move one optional item out of today. Give the freed space a purpose you value.'],
    ['Reset','Return to your surroundings','There is a world beyond the next screenful of information.','Look away from the screen and notice three colors, shapes, or sounds around you.','Spend a quiet few minutes observing a place you know. Describe one detail you usually miss.'],
    ['Reset','Keep one good moment','A day can contain a worthwhile moment without being a perfect day.','Write one small moment you enjoyed recently, as specifically as you can.','Describe what made that moment possible. Make a little room for something similar this week.'],
    ['Connection','Notice quiet effort','Some contributions are easy to rely on and easy to overlook.','Think of someone whose quiet effort helped you recently. Write exactly what they did.','Draft a short, specific thank-you. Decide for yourself whether and when to share it.'],
    ['Connection','Ask a better opening question','A thoughtful question can make room for an answer you did not expect.','Replace “How are things?” with a question you would genuinely like to hear answered.','Write three open questions for a future conversation, then choose one and plan to listen without rushing.'],
    ['Connection','Find the shared purpose','People can prefer different methods while caring about a similar outcome.','Think of a small disagreement. Name one outcome both people might value.','Draft a way to discuss that shared outcome, then write a question that checks your assumption about it.']
  ].forEach(function(entry) { themes.push(entry[0]); prompts.push(entry.slice(1)); });
  // Rotation order: each theme is spread evenly across the cycle, staggered by
  // theme, so consecutive days (and swaps) move to a different theme.
  var themeNames = themes.filter(function(theme, index) { return themes.indexOf(theme) === index; });
  var order = prompts.map(function(prompt, index) {
    var group = themes.map(function(theme, i) { return theme === themes[index] ? i : -1; }).filter(function(i) { return i >= 0; });
    var phase = (themeNames.indexOf(themes[index]) + 1) / (themeNames.length + 1);
    return {index:index, key:(group.indexOf(index) + phase) / group.length};
  }).sort(function(a, b) { return a.key - b.key || a.index - b.index; }).map(function(entry) { return entry.index; });
  var RECENT_DAYS = 14;
  function indexFor(day, offset, count) {
    var index = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
    return ((index + (offset || 0)) % count + count) % count;
  }
  function shiftDay(day, days) {
    return new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0,10);
  }
  // First spark at or after an order position that was not used in the last two weeks.
  function pickFrom(position, saved, today) {
    var recent = {}, since = shiftDay(today, -RECENT_DAYS);
    Object.keys(saved || {}).forEach(function(key) { if (key !== today && key >= since) recent[saved[key].spark] = true; });
    for (var step = 0; step < order.length; step++) {
      var candidate = order[(position + step) % order.length];
      if (!recent[candidate]) return candidate;
    }
    return order[position % order.length];
  }
  function sparkFor(day, saved) {
    return pickFrom(indexFor(day,0,order.length), saved, day);
  }
  function nextSpark(from, saved, today) {
    return pickFrom(order.indexOf(from) + 1, saved, today);
  }
  function dateKey(now) {
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now || new Date());
  }
  function promptFor(day, offset) {
    return prompts[order[indexFor(day,offset,order.length)]];
  }
  function clean(value) {
    var result = {};
    if (!value || typeof value !== 'object') return result;
    Object.keys(value).filter(function(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day); }).sort().slice(-90).forEach(function(day) {
      var item = value[day];
      if (!item || typeof item !== 'object') return;
      result[day] = {energy:item.energy === 'stretch' ? 'stretch' : 'gentle', offset:Number.isInteger(item.offset) && item.offset >= 0 ? item.offset % prompts.length : 0, done:item.done === true, note:typeof item.note === 'string' ? item.note.slice(0,1200) : ''};
      // Old entries rotated over 14 prompts. Preserve their original meaning.
      result[day].spark = Number.isInteger(item.spark) && item.spark >= 0 && item.spark < prompts.length ? item.spark : indexFor(day,result[day].offset,14);
    });
    return result;
  }
  root.DailyBoostCore = {dateKey:dateKey,promptFor:promptFor,sparkFor:sparkFor,nextSpark:nextSpark,clean:clean,count:prompts.length,themes:themes.slice(),order:order.slice()};
  if (!root.document) return;
  var records = {}, account = null, day = null, failed = false;
  function el(id) { return document.getElementById('boost-' + id); }
  function current() { return records[day] || (records[day] = {energy:'gentle',spark:sparkFor(day,records),offset:0,done:false,note:''}); }
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
      heading.textContent = key + ' · ' + prompts[records[key].spark][0] + (records[key].done ? ' · Done' : '');
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
    var item = current(), prompt = prompts[item.spark];
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
    status(); renderHistory(); renderLibrary();
  }
  function renderLibrary() {
    var list = el('library-list'); list.replaceChildren();
    var theme = el('theme').value, query = el('search').value.trim().toLowerCase(), count = 0;
    prompts.forEach(function(prompt,index) {
      if (theme && themes[index] !== theme || query && (themes[index] + ' ' + prompt.join(' ')).toLowerCase().indexOf(query) < 0) return;
      count++;
      var card = document.createElement('article'), title = document.createElement('h4'), thought = document.createElement('p'), button = document.createElement('button');
      title.textContent = prompt[0]; thought.textContent = prompt[1]; button.className = 'tool-chip';
      button.textContent = index === current().spark ? 'Selected · ' + themes[index] : 'Choose · ' + themes[index];
      button.disabled = current().done || index === current().spark;
      button.setAttribute('aria-label','Choose spark: ' + prompt[0]);
      button.addEventListener('click',function() {
        render(); if (current().done) return;
        current().spark = index; persist(); render();
        el('library').open = false; el('title').focus();
      });
      card.append(title,thought,button); list.appendChild(card);
    });
    el('library-count').textContent = count + ' of ' + prompts.length + ' sparks' + (current().done ? ' · Undo today’s completion to choose a different quest.' : ' · Choose what fits your day. Your daily note stays with you.');
    if (!count) list.textContent = 'No sparks match. Try another theme or a shorter search.';
  }
  root.renderDailyBoost = render;
  root.resetDailyBoost = function() { records = {}; account = null; day = null; if (el('note')) { el('note').value = ''; el('history').replaceChildren(); el('feedback').textContent = ''; } };
  document.addEventListener('DOMContentLoaded',function() {
    if (!el('title')) return;
    ['gentle','stretch'].forEach(function(energy) { el(energy).addEventListener('click',function() { render(); if (!current().done) current().energy = energy; persist(); render(); }); });
    el('swap').addEventListener('click',function() { render(); if (!current().done) current().spark = nextSpark(current().spark,records,day); persist(); render(); });
    el('theme').addEventListener('change',renderLibrary);
    el('search').addEventListener('input',renderLibrary);
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
