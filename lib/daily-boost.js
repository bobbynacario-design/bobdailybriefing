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
    ['Connection','Find the shared purpose','People can prefer different methods while caring about a similar outcome.','Think of a small disagreement. Name one outcome both people might value.','Draft a way to discuss that shared outcome, then write a question that checks your assumption about it.'],
    ['Craft','Find the number that has to be true','Every figure you rely on rests on a quieter number that must also hold.','Pick one figure you are relying on this week. Write the one other number that must be true for it to stand.','Trace that figure back to its source document. Mark where the chain is thinnest and what would strengthen it.'],
    ['Craft','Read it as the insured would','The same letter can read as fair or as a wall, depending on who opens it.','Reread one sentence you sent recently as if you received it during a hard week. Rewrite it more plainly.','Take one draft email or report section. Mark every term a non-specialist would stumble on and give each a plain alternative.'],
    ['Craft','Ask for less, get more','A shorter, sharper request often comes back faster and more complete.','Look at one open request for information. Remove one item you do not genuinely need.','Rewrite one request list so each item says why it matters and the easiest form in which to supply it.'],
    ['Craft','Test the “but for” story','A loss is measured against what would have happened, which nobody actually saw.','For one matter, write in a sentence what most likely would have happened without the event.','Write two alternative “but for” scenarios and the evidence that would favour each. Name the one you were quietly assuming.'],
    ['Craft','Spot the pattern across files','The fifth similar case can show what the first four each kept hidden.','Think of two recent matters that felt alike. Write the one thing they had in common.','Skim three past files for a recurring delay, gap, or question. Draft one checklist line that would catch it next time.'],
    ['Craft','Explain the figure in one breath','If a number cannot be explained simply, the reasoning may need another look.','Explain one figure you calculated recently in a single sentence the insured could follow.','Write the three-step story behind a key figure: starting point, adjustment, result. Check each step against its source.'],
    ['Craft','Look for the missing document','Sometimes the most telling evidence is the record you expected and did not find.','For one matter, name a document you would normally expect to see but have not.','Write what that missing record would show, and two other sources that could confirm the same point.'],
    ['Craft','Stress-test one assumption','An assumption is cheapest to test before it is built into a figure.','Name one assumption inside a current calculation, such as a rate, a period, or a useful life.','Move that assumption by a reasonable amount and recalculate. Note how far the result shifts and whether the report should say so.']
  ].forEach(function(entry) { themes.push(entry[0]); prompts.push(entry.slice(1)); });
  // Sunday's spark (index 50), kept out of the rotation. Saved Sundays store this
  // index, so it must not move: add any new rotating sparks after it.
  themes.push('Review');
  prompts.push(['Look back on your week','A week holds more than it seems while you are living it. A few minutes of rereading can show you what mattered.','Reread this week’s notes below. Carry one forward into next week and write a sentence on why it matters.','Reread this week’s notes below. Name one pattern running through them, carry the most useful note forward, and write one small experiment to try next week.']);
  var REVIEW = prompts.length - 1;
  // Evidence sparks that work on a real story from the briefing shown on Today.
  // Each gives the short (g) and deeper (s) quest to pair with that story; the
  // card leads with the story itself, so these read as the next sentence.
  // prefer narrows the story to those briefing sections when any are present:
  // the claims-craft sparks want a loss event, not an AI product launch.
  // Keys are catalog indices, so they follow the append-only rule too.
  var CLAIMS = ['insurance','interruptions'];
  var BRIEFING = {
    3: {g:'Write one situation where its main claim would not hold for the people you work with.', s:'Find a counterexample in your own files or a source you trust. Write how it limits how far the story applies.'},
    8: {g:'Name one assumption the story rests on. What would you need to see to doubt it?', s:'List what the source assumes and what it actually shows. Pick the assumption that matters most for a claim or a client, and say how you would test it.'},
    10: {g:'Whose view is missing from it? Write one question you would ask them.', s:'Find a first-hand account from someone it affects: an insured, a business owner, a worker. Note how it differs from the summary.'},
    11: {g:'Write: “What would I need to know before acting on this?”', s:'Open the original source and separate what it establishes from what you are inferring.'},
    17: {g:'Ask “why?” once, then ask “how could I check?”', s:'Write three possible explanations for it and one observation, from the source or elsewhere, that would tell them apart.'},
    18: {g:'Write one line on what was observed and one on what is being assumed.', s:'Mark each claim in the source as observed or assumed, then write two other explanations for the observed part.'},
    21: {g:'Write the strongest fair case against its main claim.', s:'Find a source that reads the same event differently. Note the one point it makes that the first did not.'},
    43: {prefer:CLAIMS, g:'Read it as an insured business owner would. Write the one question they would put to their broker.', s:'Rewrite why it matters for an insured with no industry vocabulary, and name the one thing in their own policy they should check.'},
    45: {prefer:CLAIMS, g:'Write in one sentence what most likely would have happened without the event.', s:'Write two alternative “but for” scenarios and the evidence that would favour each. Name the one the story quietly assumes.'},
    48: {prefer:CLAIMS, g:'Name the one record that would confirm it, and whether anyone has published it yet.', s:'Write what that record would show, and two other sources that could confirm the same point.'}
  };
  // Rotation order: each theme is spread evenly across the cycle, staggered by
  // theme, so consecutive days (and swaps) move to a different theme.
  var themeNames = themes.filter(function(theme, index) { return index !== REVIEW && themes.indexOf(theme) === index; });
  var order = prompts.map(function(prompt, index) {
    var group = themes.map(function(theme, i) { return theme === themes[index] ? i : -1; }).filter(function(i) { return i >= 0; });
    var phase = (themeNames.indexOf(themes[index]) + 1) / (themeNames.length + 1);
    return {index:index, key:(group.indexOf(index) + phase) / group.length};
  }).filter(function(entry) { return entry.index !== REVIEW; }).sort(function(a, b) { return a.key - b.key || a.index - b.index; }).map(function(entry) { return entry.index; });
  var themeLabels = {Reset:'Rest & reset', Craft:'Work craft', Review:'Weekly look-back'};
  function themeLabel(index) { return themeLabels[themes[index]] || themes[index]; }
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
  function isSunday(day) { return new Date(day + 'T00:00:00Z').getUTCDay() === 0; }
  function sparkFor(day, saved) {
    return isSunday(day) ? REVIEW : pickFrom(indexFor(day,0,order.length), saved, day);
  }
  function nextSpark(from, saved, today) {
    // Swapping away from the look-back resumes the rotation where today sits.
    var position = order.indexOf(from);
    return pickFrom(position < 0 ? indexFor(today,0,order.length) : position + 1, saved, today);
  }
  function dateKey(now) {
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now || new Date());
  }
  function label(day) {
    var date = new Date(day + 'T00:00:00Z');
    return 'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[date.getUTCDay()] + ' ' + date.getUTCDate() + ' ' + 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[date.getUTCMonth()];
  }
  function promptFor(day, offset) {
    return prompts[order[indexFor(day,offset,order.length)]];
  }
  // Briefing stories noted on a day (Note this): headline, publisher and a web link only.
  function cleanStories(list) {
    return (Array.isArray(list) ? list : []).filter(function(story) { return story && typeof story.headline === 'string' && story.headline.trim(); }).slice(-6).map(function(story) {
      var url = typeof story.url === 'string' && /^https?:\/\//i.test(story.url) ? story.url.slice(0,600) : '';
      return {headline:story.headline.trim().slice(0,300), source:typeof story.source === 'string' ? story.source.slice(0,120) : '', url:url};
    });
  }
  // Briefing stories whose source link was opened on a day ("✓ Opened"). Only
  // linked stories can be opened, so a web url is required. Capped per day and
  // kept for two weeks (see clean), because the whole history shares one doc.
  var OPENED_DAYS = 14;
  // how: 'open' (its source link was opened; needs the link) or 'read' (marked
  // read by hand, which also works for a story with no link).
  function cleanOpened(list) {
    function linked(story) { return typeof story.url === 'string' && /^https?:\/\//i.test(story.url); }
    return (Array.isArray(list) ? list : []).filter(function(story) { return story && typeof story.headline === 'string' && story.headline.trim() && (linked(story) || story.how === 'read'); }).slice(-20).map(function(story) {
      return {headline:story.headline.trim().slice(0,200), source:typeof story.source === 'string' ? story.source.slice(0,80) : '', url:linked(story) ? story.url.slice(0,600) : '', how:story.how === 'read' ? 'read' : 'open'};
    });
  }
  // Watch-metric reminders, kept on the day they were set: the thing to check,
  // the story it came from, and when it is due (a PHT day key).
  var DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
  function cleanReminders(list) {
    return (Array.isArray(list) ? list : []).filter(function(item) { return item && typeof item.metric === 'string' && item.metric.trim() && typeof item.due === 'string' && DAY_KEY.test(item.due); }).slice(-10).map(function(item) {
      return {metric:item.metric.trim().slice(0,200), headline:typeof item.headline === 'string' ? item.headline.slice(0,200) : '', source:typeof item.source === 'string' ? item.source.slice(0,80) : '',
        url:typeof item.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url.slice(0,600) : '', due:item.due, done:item.done === true, doneOn:typeof item.doneOn === 'string' && DAY_KEY.test(item.doneOn) ? item.doneOn : ''};
    });
  }
  // A date named in the watch metric ("due 12 Oct", "October 12", "2026-10-12")
  // if it is a real day within the next four months; month names must be whole
  // words, so "12 markets" is not 12 March. "" when there is none.
  var MONTHS = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  function parseDue(text, today) {
    var s = String(text || '').toLowerCase(), names = Object.keys(MONTHS).join('|'), m, y = 0, mo = 0, d = 0;
    if ((m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + names + ')\\b\\.?(?:,?\\s+(20\\d\\d))?').exec(s))) { d = +m[1]; mo = MONTHS[m[2]]; y = m[3] ? +m[3] : 0; }
    else if ((m = new RegExp('\\b(' + names + ')\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d\\d))?').exec(s))) { mo = MONTHS[m[1]]; d = +m[2]; y = m[3] ? +m[3] : 0; }
    if (!mo || !d) return '';
    function key(year) { return year + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
    var year = +today.slice(0, 4), due = key(y || year);
    if (!y && due < today) due = key(year + 1);
    var at = new Date(due + 'T00:00:00Z');
    if (isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== due) return '';
    return due >= today && due <= shiftDay(today, 120) ? due : '';
  }
  var HORIZON_DAYS = {days:3, weeks:14, months:30};
  function dueFor(story, today) {
    return parseDue(story.metric, today) || shiftDay(today, HORIZON_DAYS[String(story.horizon || '').toLowerCase()] || 7);
  }
  // One story, however it was recorded: its link without query or trailing slash, else its headline.
  function storyKey(story) {
    var url = story && typeof story.url === 'string' ? story.url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '') : '';
    return url ? 'u:' + url : 'h:' + String(story && story.headline || '').trim().toLowerCase();
  }
  var FIELDS = ['energy','spark','done','tucked','note','carry','ref','refSource','refUrl','picked','intention','trialPlan','trialDue','trialOutcome','trialDone'];
  var INTENTIONS = {'':'Surprise me',motivation:'Motivation',clarity:'Clarity',curiosity:'Curiosity',calm:'Calm',challenge:'A challenge'};
  var INTENT_THEMES = {motivation:['Momentum','Confidence'],clarity:['Perspective','Craft'],curiosity:['Curiosity','Connection'],calm:['Reset'],challenge:['Creativity','Craft']};
  var LISTS = ['stories','opened','reminders'];
  function itemKey(item) { return storyKey(item) + (item.metric ? '|' + item.metric : ''); }
  function clocks(value) {
    var out = {};
    if (value && typeof value === 'object') Object.keys(value).slice(0,300).forEach(function(key) {
      if (key !== '__proto__' && key !== 'constructor' && Number.isFinite(value[key]) && value[key] >= 0) out[key] = value[key];
    });
    return out;
  }
  // Recovered note versions (from a genuine two-device conflict) are a safety
  // net, not an archive: three per day, kept two weeks, so the one shared doc
  // stays far below Firestore's 1 MiB limit. Dismissals merge as a set, so a
  // version dismissed on one device does not come back from another.
  var MAX_VERSIONS = 3, VERSION_DAYS = 14;
  function versionId(v) { return v.at + ':' + v.text.length; }
  function clean(value) {
    var result = {};
    if (!value || typeof value !== 'object') return result;
    var days = Object.keys(value).filter(function(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day); }).sort().slice(-90);
    var openedSince = days.length ? shiftDay(days[days.length - 1], -OPENED_DAYS) : '';
    var versionsSince = days.length ? shiftDay(days[days.length - 1], -VERSION_DAYS) : '';
    days.forEach(function(day) {
      var item = value[day];
      if (!item || typeof item !== 'object') return;
      result[day] = {energy:item.energy === 'stretch' ? 'stretch' : 'gentle', offset:Number.isInteger(item.offset) && item.offset >= 0 ? item.offset % prompts.length : 0, done:item.done === true, tucked:item.tucked === true, note:typeof item.note === 'string' ? item.note.slice(0,1200) : '', carry:typeof item.carry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.carry) ? item.carry : '', ref:typeof item.ref === 'string' ? item.ref.slice(0,300) : '', refSource:typeof item.refSource === 'string' ? item.refSource.slice(0,120) : '', refUrl:typeof item.refUrl === 'string' && /^https?:\/\//i.test(item.refUrl) ? item.refUrl.slice(0,600) : '', picked:item.picked === 'library' || item.picked === 'swap' || item.picked === 'intention' ? item.picked : '', stories:cleanStories(item.stories), reminders:cleanReminders(item.reminders), opened:day >= openedSince ? cleanOpened(item.opened) : [], updatedAt:Number.isFinite(item.updatedAt) && item.updatedAt > 0 ? Math.floor(item.updatedAt) : 0};
      // Old entries rotated over 14 prompts. Preserve their original meaning.
      result[day].spark = Number.isInteger(item.spark) && item.spark >= 0 && item.spark < prompts.length ? item.spark : indexFor(day,result[day].offset,14);
      var entry = result[day];
      entry.intention = Object.prototype.hasOwnProperty.call(INTENTIONS,item.intention) ? item.intention : '';
      entry.trialPlan = typeof item.trialPlan === 'string' ? item.trialPlan.slice(0,400) : '';
      entry.trialDue = DAY_KEY.test(item.trialDue || '') ? item.trialDue : '';
      entry.trialOutcome = typeof item.trialOutcome === 'string' ? item.trialOutcome.slice(0,800) : '';
      entry.trialDone = item.trialDone === true;
      entry.fieldClocks = clocks(item.fieldClocks);
      entry.listClocks = {};
      LISTS.forEach(function(field) { entry.listClocks[field] = clocks(item.listClocks && item.listClocks[field]); });
      entry.favourites = {};
      Object.keys(item.favourites || {}).filter(function(id) { return /^\d+$/.test(id) && +id < prompts.length; }).forEach(function(id) {
        var fav = item.favourites[id]; if (fav && Number.isFinite(fav.at)) entry.favourites[id] = {on:fav.on === true,at:fav.at};
      });
      entry.noteParent = Number.isFinite(item.noteParent) ? item.noteParent : 0;
      entry.versionsDismissed = (Array.isArray(item.versionsDismissed) ? item.versionsDismissed : []).filter(function(id) { return typeof id === 'string' && id.length <= 40; }).slice(-16);
      entry.noteVersions = day < versionsSince ? [] : (Array.isArray(item.noteVersions) ? item.noteVersions : []).filter(function(v) { return v && typeof v.text === 'string' && v.text.trim() && Number.isFinite(v.at) && entry.versionsDismissed.indexOf(versionId(v)) < 0; }).slice(-MAX_VERSIONS).map(function(v) { return {text:v.text.slice(0,1200),at:v.at}; });
    });
    return result;
  }
  function won(entry) { return !!entry && (entry.done || !!entry.note.trim()); }
  function fieldTime(entry, field) { return Object.prototype.hasOwnProperty.call(entry.fieldClocks || {},field) ? entry.fieldClocks[field] : entry.updatedAt || 0; }
  function mergeDay(a,b) {
    var newer = a.updatedAt > b.updatedAt || a.updatedAt === b.updatedAt && a.note.length >= b.note.length ? a : b;
    var out = JSON.parse(JSON.stringify(newer));
    FIELDS.forEach(function(field) {
      var at = fieldTime(a,field), bt = fieldTime(b,field);
      var winner = at > bt ? a : bt > at ? b : field === 'note' && a.note.length !== b.note.length ? (a.note.length > b.note.length ? a : b) : JSON.stringify(a[field]) >= JSON.stringify(b[field]) ? a : b;
      out[field] = winner[field]; out.fieldClocks[field] = Math.max(at,bt);
    });
    LISTS.forEach(function(field) {
      var am = {}, bm = {}, stamps = {};
      (a[field] || []).forEach(function(v) { am[itemKey(v)] = v; });
      (b[field] || []).forEach(function(v) { bm[itemKey(v)] = v; });
      var keys = new Set(Object.keys(am).concat(Object.keys(bm),Object.keys(a.listClocks[field]),Object.keys(b.listClocks[field])));
      out[field] = [];
      keys.forEach(function(key) {
        var at = a.listClocks[field][key] || (am[key] ? a.updatedAt : 0), bt = b.listClocks[field][key] || (bm[key] ? b.updatedAt : 0);
        var value = at > bt ? am[key] : bt > at ? bm[key] : JSON.stringify(am[key] || null) >= JSON.stringify(bm[key] || null) ? am[key] : bm[key];
        stamps[key] = Math.max(at,bt); if (value) out[field].push(value);
      });
      out.listClocks[field] = stamps;
    });
    out.favourites = mergeFavourites([a,b]);
    var versions = (a.noteVersions || []).concat(b.noteVersions || []);
    if (a.note !== b.note && a.noteParent !== fieldTime(b,'note') && b.noteParent !== fieldTime(a,'note')) {
      [a,b].forEach(function(e) { if (e.note.trim()) versions.push({text:e.note,at:fieldTime(e,'note')}); });
    }
    out.noteParent = out.note === a.note ? a.noteParent : b.noteParent;
    out.versionsDismissed = (a.versionsDismissed || []).concat(b.versionsDismissed || []).filter(function(id, i, list) { return list.indexOf(id) === i; }).slice(-16);
    out.noteVersions = versions.filter(function(v,i,list) { return v.text !== out.note && out.versionsDismissed.indexOf(versionId(v)) < 0 && list.findIndex(function(other) { return other.text === v.text; }) === i; }).sort(function(x,y) { return x.at-y.at || x.text.localeCompare(y.text); }).slice(-MAX_VERSIONS);
    out.updatedAt = Math.max(a.updatedAt,b.updatedAt);
    return out;
  }
  function mergeFavourites(entries) {
    var out = {};
    entries.forEach(function(entry) { Object.keys(entry.favourites || {}).forEach(function(id) { var f = entry.favourites[id]; if (!out[id] || f.at > out[id].at || f.at === out[id].at && !f.on) out[id] = f; }); });
    return out;
  }
  // Device copy + account copy -> one set of days. Independent fields and list
  // items merge; divergent notes retain alternate text for recovery.
  // upload: days the account should receive; stale: account keys to delete.
  function merge(local, remote) {
    var mine = clean(local), theirs = clean(remote), picked = {}, upload = [];
    Object.keys(mine).concat(Object.keys(theirs)).forEach(function(key) {
      if (picked[key]) return;
      var a = mine[key], b = theirs[key];
      if (!b) { picked[key] = a; if (a.updatedAt || won(a) || a.tucked) upload.push(key); return; }
      if (!a) { picked[key] = b; return; }
      picked[key] = mergeDay(a,b);
      if (JSON.stringify(picked[key]) !== JSON.stringify(b)) upload.push(key);
    });
    var kept = clean(picked);
    // An account copy still carrying opened stories that have aged out is
    // rewritten, so the shared doc does not keep growing with reading history.
    Object.keys(remote || {}).forEach(function(key) {
      var raw = remote[key];
      if (kept[key] && raw && Array.isArray(raw.opened) && raw.opened.length && !kept[key].opened.length && upload.indexOf(key) < 0) upload.push(key);
    });
    return {records:kept, upload:upload.filter(function(key) { return kept[key]; }), stale:Object.keys(remote || {}).filter(function(key) { return !kept[key]; })};
  }
  root.DailyBoostCore = {dateKey:dateKey,promptFor:promptFor,sparkFor:sparkFor,nextSpark:nextSpark,clean:clean,merge:merge,parseDue:parseDue,review:REVIEW,linked:Object.keys(BRIEFING).map(Number),count:prompts.length,themes:themes.slice(),order:order.slice(),
    sparkTitle:function(index) { return prompts[index] ? prompts[index][0] : ''; }};
  // The server (Morning 5 push) requires the synced twin in functions/ for the
  // same rotation, so today's spark in the notification matches the app.
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DailyBoostCore;
  if (!root.document) return;
  // expanded: reopened during this visit to Today; a done or tucked day otherwise shows as a one-line strip.
  var records = {}, baseline = {}, account = null, day = null, failed = false, expanded = false;
  // syncBase: per day, the note clock of the version this device last saw on
  // the account. A local note edit builds on that, not on its own previous
  // keystroke, so several keystrokes between syncs are never read as a conflict.
  // sentNotes: the note text each in-flight push carried, per day.
  var syncBase = {}, sentNotes = {};
  function learnBase(entries) {
    var seen = clean(entries);
    Object.keys(seen).forEach(function(key) { syncBase[key] = fieldTime(seen[key], 'note'); });
    return seen;
  }
  // Account sync (index.html provides fbLoadDailyBoost/fbSaveDailyBoost). The
  // device copy stays the working store; the account copy is merged in on
  // sign-in and on return, and changed days are written shortly after an edit.
  var sync = freshSync();
  function freshSync() { return {state:'local', loading:false, loadedFor:null, lastPull:0, timer:null, inflight:0, dirty:{}, stale:[]}; }
  function resetSync() { if (sync.timer) root.clearTimeout(sync.timer); sync = freshSync(); }
  function linked() { return !!account && typeof root.fbLoadDailyBoost === 'function' && typeof root.fbSaveDailyBoost === 'function'; }
  function el(id) { return document.getElementById('boost-' + id); }
  function current() { return records[day] || (records[day] = {energy:'gentle',spark:sparkFor(day,records),offset:0,done:false,note:'',stories:[],opened:[],favourites:mergeFavourites(Object.values(records))}); }
  function status() {
    var text;
    if (!account) text = 'Sign in to save your small wins.';
    else if (!linked()) text = failed ? 'Could not save on this device. Keep this page open and copy your note before leaving.' : 'Saved on this device only · up to 90 daily entries · private to this sign-in';
    else if (sync.state === 'synced') text = 'Synced across your devices · last 90 entries · private to this sign-in';
    else if (sync.state === 'error') text = failed ? 'Could not save on this device or to your account. Keep this page open and copy your note.' : 'Saved on this device · your account is out of reach for now, will retry';
    else text = failed ? 'Syncing to your account…' : 'Saved on this device · syncing to your account…';
    el('status').textContent = text;
  }
  function saveLocal() {
    records = clean(records);
    Object.keys(records).forEach(function(key) {
      var entry = records[key], old = baseline[key];
      if (!sync.dirty[key]) return;
      var stamp = Math.max(Date.now(), (old && old.updatedAt || 0) + 1);
      FIELDS.forEach(function(field) {
        if (JSON.stringify(entry[field]) !== JSON.stringify(old && old[field])) {
          if (field === 'note') {
            if (!Object.prototype.hasOwnProperty.call(syncBase, key)) syncBase[key] = old ? fieldTime(old,'note') : 0;
            entry.noteParent = syncBase[key];
          }
          entry.fieldClocks[field] = stamp;
        } else if (old) entry.fieldClocks[field] = fieldTime(old,field);
      });
      LISTS.forEach(function(field) {
        var previous = {}, next = {};
        ((old && old[field]) || []).forEach(function(v) { previous[itemKey(v)] = v; });
        entry[field].forEach(function(v) { next[itemKey(v)] = v; });
        new Set(Object.keys(previous).concat(Object.keys(next))).forEach(function(id) {
          if (JSON.stringify(previous[id]) !== JSON.stringify(next[id])) entry.listClocks[field][id] = stamp;
          else if (!entry.listClocks[field][id]) entry.listClocks[field][id] = old.updatedAt || 0;
        });
      });
      entry.updatedAt = stamp;
    });
    baseline = JSON.parse(JSON.stringify(records));
    try { records = clean(records); root.localStorage.setItem('bob-daily-boost:' + account, JSON.stringify(records)); failed = false; }
    catch (error) { failed = true; }
  }
  // The story the briefing-linked quest points at: fixed once the day's entry is
  // touched, otherwise whatever the briefing on Today leads with right now.
  function liveStory(spark) {
    var quest = BRIEFING[spark];
    var live = quest && typeof root.dailyBoostBriefingItem === 'function' ? root.dailyBoostBriefingItem(quest.prefer || []) : null;
    return live && live.headline ? live : null;
  }
  function linkedStory(item) {
    var live = liveStory(item.spark);
    if (!item.ref) return live;
    return live && live.headline === item.ref ? live : {headline:item.ref, source:item.refSource, stored:true};
  }
  // One line under the title saying how today's spark got here, and what it is
  // paired with, so nothing about the card has to be guessed.
  var SECTION_NAMES = {global:'global', ph:'Philippines', insurance:'insurance', interruptions:'interruptions', ai:'AI', markets:'markets', ev:'EV'};
  function whyText(item) {
    var parts = [item.picked === 'intention' ? 'Chosen for what you need today' : item.picked === 'library' ? 'You picked this from the library' : item.picked === 'swap' ? 'You swapped to this one' : item.spark === REVIEW && isSunday(day) ? 'Sunday look-back' : 'From today’s rotation'];
    if (BRIEFING[item.spark]) {
      var story = linkedStory(item);
      parts.push(!story ? 'pairs with a briefing story once one is loaded' : story.stored ? 'paired with the briefing story you started with' : 'paired with ' + (story.isToday ? 'today’s' : 'the') + ' top ' + (SECTION_NAMES[story.section] || 'briefing') + ' story');
    }
    if (item.intention) parts.push('Your intention: ' + INTENTIONS[item.intention]);
    return parts.join(' · ');
  }
  function questText(item, prompt) {
    var quest = BRIEFING[item.spark], story = quest ? linkedStory(item) : null;
    if (!story) return prompt[item.energy === 'stretch' ? 3 : 2];
    var lead = (story.stored ? 'The briefing story you started with' : story.isToday ? 'From today’s briefing' : 'From the briefing below' + (story.dateLabel ? ' (' + story.dateLabel + ')' : '')) + ': “' + story.headline + '”';
    return item.energy === 'stretch' ? lead + (story.source ? ' (' + story.source + ')' : '') + '. ' + quest.s : lead + '. ' + quest.g;
  }
  function persist() {
    if (!account) { status(); return; }
    var live = liveStory(current().spark);
    if (live && !current().ref) { current().ref = live.headline.slice(0,300); current().refSource = live.source.slice(0,120); current().refUrl = live.url || ''; }
    else if (!BRIEFING[current().spark] && current().ref) { current().ref = ''; current().refSource = ''; current().refUrl = ''; }
    current().updatedAt = Date.now(); sync.dirty[day] = true;
    saveLocal(); schedule(); status();
  }
  function pull(minGap) {
    if (!linked() || sync.loading || Date.now() - sync.lastPull < (minGap === undefined ? 60000 : minGap)) return;
    var uid = account, session = sync;
    sync.loading = true; sync.lastPull = Date.now();
    if (sync.state !== 'synced') sync.state = 'syncing';
    status();
    root.fbLoadDailyBoost(uid).then(function(entries) {
      if (uid !== account || session !== sync) return;
      var seen = clean(entries), result = merge(records, entries);
      // A local note that won over the account's copy has now seen it (any
      // conflict is already kept as a version), so it builds on it from here.
      Object.keys(seen).forEach(function(key) {
        syncBase[key] = fieldTime(seen[key], 'note');
        var mine = result.records[key];
        if (mine && mine.note !== seen[key].note) mine.noteParent = syncBase[key];
      });
      sync.loading = false; sync.loadedFor = uid; sync.stale = result.stale;
      result.upload.forEach(function(key) { sync.dirty[key] = true; });
      records = result.records; baseline = JSON.parse(JSON.stringify(records)); saveLocal();
      if (Object.keys(sync.dirty).length || sync.stale.length) push(); else if (!sync.inflight && !sync.timer) sync.state = 'synced';
      render();
    }, function() {
      if (uid !== account || session !== sync) return;
      sync.loading = false; sync.state = 'error'; status();
    });
  }
  function schedule() {
    if (!linked()) return;
    // Until the account copy has been merged, a write could not tell which days are newer.
    if (sync.loadedFor !== account) { pull(15000); return; }
    sync.state = 'syncing';
    if (sync.timer) root.clearTimeout(sync.timer);
    sync.timer = root.setTimeout(push, 1500);
  }
  function push() {
    if (sync.timer) { root.clearTimeout(sync.timer); sync.timer = null; }
    if (!linked() || sync.loadedFor !== account) return;
    var uid = account, session = sync, entries = {}, stale = sync.stale;
    // A snapshot, not the live records: typing during the save must not change what
    // this save carries (the account transaction may run, or re-run, after it).
    Object.keys(sync.dirty).forEach(function(key) { if (records[key]) { entries[key] = JSON.parse(JSON.stringify(records[key])); sentNotes[key] = records[key].note; } });
    var days = Object.keys(entries);
    sync.dirty = {}; sync.stale = [];
    if (!days.length && !stale.length) { if (!sync.inflight) sync.state = 'synced'; status(); return; }
    sync.state = 'syncing'; sync.inflight++; status();
    root.fbSaveDailyBoost(uid, entries, stale).then(function(confirmed) {
      if (uid !== account || session !== sync) return;
      if (confirmed) {
        // Typing that continued while this push was in flight builds on what was
        // just saved, as long as the account kept exactly that text; if another
        // device's edit won instead, the merge below keeps both.
        var kept = learnBase(confirmed);
        days.forEach(function(key) {
          if (records[key] && kept[key] && kept[key].note === sentNotes[key] && records[key].note !== kept[key].note) records[key].noteParent = fieldTime(kept[key], 'note');
        });
        records = merge(records,confirmed).records; baseline = JSON.parse(JSON.stringify(records)); saveLocal(); render();
      }
      sync.inflight--;
      if (!sync.inflight && !sync.timer && !Object.keys(sync.dirty).length && sync.state !== 'error') sync.state = 'synced';
      status();
    }, function() {
      if (uid !== account || session !== sync) return;
      sync.inflight--; sync.state = 'error';
      days.forEach(function(key) { sync.dirty[key] = true; }); sync.stale = sync.stale.concat(stale);
      status();
    });
  }
  // shownDay: an older day opened from search, pinned to the top of the list.
  var shownDay = null;
  function renderHistory() {
    var list = el('history'); list.replaceChildren();
    var days = Object.keys(records).filter(function(key) { return key < day && (records[key].note || records[key].done); }).sort().reverse().slice(0,7);
    if (shownDay && records[shownDay] && shownDay < day) days = [shownDay].concat(days.filter(function(key) { return key !== shownDay; }));
    el('history-title').textContent = days.length ? 'Your recent discoveries (' + days.length + ')' : 'Your recent discoveries';
    if (!days.length) { list.textContent = 'Your reflections will collect here. A missed day is just a missed day; start again whenever you like.'; return; }
    days.forEach(function(key) {
      var entry = document.createElement('article'), heading = document.createElement('h4'), note = document.createElement('p');
      heading.textContent = label(key) + ' · ' + prompts[records[key].spark][0] + (records[key].done ? ' · Done' : '');
      note.textContent = records[key].note || 'Made time for a small quest.';
      if (key === shownDay) { entry.className = 'is-found'; entry.tabIndex = -1; }
      entry.append(heading,note); list.appendChild(entry);
    });
  }
  function render() {
    if (!el('title')) return;
    var uid = root._firebaseUid || null;
    var switched = uid !== account;
    if (switched) {
      account = uid; records = {}; baseline = {}; syncBase = {}; sentNotes = {}; failed = false; shownDay = null; resetSync();
      if (account) try { records = clean(JSON.parse(root.localStorage.getItem('bob-daily-boost:' + account) || '{}')); } catch (error) { failed = true; }
      baseline = JSON.parse(JSON.stringify(records));
    }
    day = dateKey();
    var item = current(), prompt = prompts[item.spark];
    if (!baseline[day]) baseline[day] = clean(records)[day];
    el('date').textContent = label(day) + ' · ' + themeLabel(item.spark);
    el('title').textContent = prompt[0]; el('thought').textContent = prompt[1];
    el('why').textContent = whyText(item);
    renderLookback(item); renderCarried(item); renderNoted(item); renderReminders();
    el('note').placeholder = item.spark === REVIEW ? 'Next week I want to carry…' : 'Today I noticed…';
    el('quest').textContent = questText(item, prompt);
    var story = BRIEFING[item.spark] ? linkedStory(item) : null;
    el('briefing-jump').hidden = !(story && !story.stored);
    el('duration').textContent = item.energy === 'stretch' ? '10-minute exploration' : '2-minute small step';
    ['gentle','stretch'].forEach(function(energy) { el(energy).setAttribute('aria-pressed',String(item.energy === energy)); el(energy).disabled = item.done; });
    // Only touch the note when it changed, so a sync render keeps the caret in place.
    if (el('note').value !== item.note) el('note').value = item.note;
    el('done').textContent = item.done ? '✓ Small win captured · Undo' : 'I did it';
    el('done').setAttribute('aria-pressed',String(item.done));
    el('swap').disabled = item.done;
    el('feedback').textContent = item.done ? 'That counts. Take the idea with you into your day.' : 'One small step is enough. You set the pace.';
    renderCompact(item, prompt, renderWeek());
    status(); renderHistory(); renderLibrary(); renderPersonal();
    // Opened ticks on the briefing cards follow the records (sync, account switch).
    if (typeof root.applyOpenedTicks === 'function') root.applyOpenedTicks();
    if (switched) pull(0);
  }
  // Monday-to-Sunday dots: a record of small wins, never a streak to lose.
  function renderWeek() {
    var list = el('week'), wins = 0, start = shiftDay(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
    list.replaceChildren();
    for (var i = 0; i < 7; i++) {
      var key = shiftDay(start, i), dot = document.createElement('span'), hit = won(records[key]);
      if (hit) wins++;
      dot.className = 'boost-dot' + (hit ? ' is-won' : '') + (key === day ? ' is-today' : '') + (key > day ? ' is-ahead' : '');
      dot.title = label(key) + (hit ? ' · small win' : '');
      list.appendChild(dot);
    }
    var summary = wins ? wins + (wins === 1 ? ' small win' : ' small wins') + ' this week' : 'A fresh week. Any day can be the first.';
    el('week-label').textContent = summary; list.setAttribute('aria-label','This week: ' + summary);
    return wins;
  }
  function excerpt(note) {
    var line = note.trim().split('\n')[0];
    return line.length > 140 ? line.slice(0,139) + '…' : line;
  }
  function renderCompact(item, prompt, wins) {
    var compact = (item.done || item.tucked) && !expanded, note = excerpt(item.note);
    el('panel').className = 'daily-boost' + (compact ? ' is-compact' : '');
    el('compact-kicker').textContent = (item.done ? '✓ Today’s spark · small win captured' : 'Today’s spark · tucked away for now') + (wins ? ' · ' + wins + ' this week' : '');
    el('compact-title').textContent = prompt[0];
    el('compact-note').textContent = note ? '“' + note + '”' : item.done ? 'Done for today. Open it to add a note.' : 'It will be here whenever you want it today.';
  }
  // The look-back: the six days before it, and one note to carry into next week.
  function renderLookback(item) {
    var box = el('lookback'), list = el('lookback-list'), days = [];
    box.hidden = item.spark !== REVIEW;
    list.replaceChildren();
    if (box.hidden) return;
    for (var i = 6; i >= 1; i--) if (won(records[shiftDay(day, -i)])) days.push(shiftDay(day, -i));
    el('lookback-count').textContent = days.length ? days.length + (days.length === 1 ? ' day' : ' days') + ' with a note or small win since ' + label(shiftDay(day, -6)) + '.' : 'No notes in the last six days. That is fine: use the quest to name one thing you want next week to hold.';
    days.forEach(function(key) {
      var entry = records[key], card = document.createElement('article'), heading = document.createElement('h4'), note = document.createElement('p');
      heading.textContent = label(key) + ' · ' + prompts[entry.spark][0];
      note.textContent = entry.note.trim() || 'A small win, no note.';
      card.append(heading, note);
      if (entry.note.trim()) {
        var chosen = item.carry === key, button = document.createElement('button');
        button.className = 'tool-chip' + (chosen ? ' active' : '');
        button.textContent = chosen ? '✓ Carrying forward' : 'Carry forward';
        button.setAttribute('aria-pressed', String(chosen));
        button.addEventListener('click', function() { render(); current().carry = current().carry === key ? '' : key; persist(); render(); });
        card.appendChild(button);
      }
      list.appendChild(card);
    });
    renderWeekStories();
  }
  // The look-back's second list: every briefing story you opened, noted or took
  // a linked spark to over the week (the six days before and today), once each,
  // with what you did with it and a way to write about it now.
  function renderWeekStories() {
    var box = el('lookback-stories'), list = el('lookback-story-list'), seen = {}, rows = [];
    list.replaceChildren();
    for (var i = 6; i >= 0; i--) {
      var key = shiftDay(day, -i), entry = records[key];
      if (!entry) continue;
      var found = [];
      (entry.opened || []).forEach(function(story) { found.push([story, story.how === 'read' ? 'read' : 'opened']); });
      (entry.stories || []).forEach(function(story) { found.push([story, 'noted']); });
      if (entry.ref) found.push([{headline:entry.ref, source:entry.refSource, url:entry.refUrl}, 'spark']);
      found.forEach(function(pair) {
        var id = storyKey(pair[0]), row = seen[id];
        if (!row) { row = seen[id] = {story:{headline:pair[0].headline, source:pair[0].source || '', url:pair[0].url || ''}, day:key, kinds:[]}; rows.push(row); }
        if (!row.story.url && pair[0].url) row.story.url = pair[0].url;
        if (row.kinds.indexOf(pair[1]) < 0) row.kinds.push(pair[1]);
      });
    }
    box.hidden = !rows.length;
    rows.slice(-12).forEach(function(row) {
      var item = document.createElement('div'), meta = document.createElement('span'), title = row.story.url ? document.createElement('a') : document.createElement('span'), write = document.createElement('button');
      item.className = 'boost-week-story';
      meta.className = 'boost-kicker';
      meta.textContent = label(row.day) + ' · ' + row.kinds.join(' · ');
      title.className = 'boost-week-story-title';
      title.textContent = row.story.headline + (row.story.source ? ' (' + row.story.source + ')' : '') + (row.story.url ? ' ↗' : '');
      if (row.story.url) { title.href = row.story.url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      write.className = 'tool-chip'; write.textContent = '✎ Write about it';
      write.setAttribute('aria-label', 'Write about ' + row.story.headline + ' in today’s note');
      write.addEventListener('click', function() { root.noteBriefingStory(row.story); });
      item.append(meta, title, write);
      list.appendChild(item);
    });
  }
  // Stories noted today, under the reflection: jump back to the card, open the
  // source, or take one off the list (the note's text is left alone).
  function renderNoted(item) {
    var box = el('noted'), list = item.stories || [];
    box.replaceChildren(); box.hidden = !list.length;
    list.forEach(function(story, index) {
      var chip = document.createElement('span'), jump = document.createElement('button'), remove = document.createElement('button');
      chip.className = 'boost-noted-item';
      jump.className = 'boost-noted-title'; jump.textContent = '↓ ' + story.headline; jump.title = 'Back to this story in the briefing';
      jump.addEventListener('click', function() {
        if (!root.highlightSourceTitle || !root.highlightSourceTitle(story.headline, 'today')) el('feedback').textContent = 'That story is not in the briefing shown below right now.';
      });
      chip.appendChild(jump);
      if (story.url) {
        var open = document.createElement('a');
        open.href = story.url; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = '↗';
        open.setAttribute('aria-label', 'Open the source for ' + story.headline);
        chip.appendChild(open);
      }
      remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove ' + story.headline + ' from today');
      remove.addEventListener('click', function() { render(); (current().stories || []).splice(index, 1); persist(); render(); });
      chip.appendChild(remove);
      box.appendChild(chip);
    });
  }
  // For six days after a look-back, its chosen note rides along on the spark card.
  function renderCarried(item) {
    var box = el('carried'), found = '';
    for (var i = 1; i <= 6 && !found; i++) {
      var from = records[shiftDay(day, -i)];
      if (from && from.spark === REVIEW && from.carry && records[from.carry] && records[from.carry].note.trim()) found = from.carry;
    }
    box.hidden = !found || item.spark === REVIEW;
    box.textContent = found ? 'Carrying forward from ' + label(found) + ': “' + excerpt(records[found].note) + '”' : '';
  }
  // A plain-text copy of every stored reflection, for keeping them elsewhere.
  function exportText() {
    var days = Object.keys(records).filter(function(key) { return won(records[key]) || records[key].trialPlan || (records[key].reminders || []).length; }).sort().reverse();
    var lines = ['Daily Boost reflections · copied ' + day, ''];
    days.forEach(function(key) {
      var entry = records[key];
      lines.push(label(key) + ' ' + key.slice(0,4) + ' · ' + prompts[entry.spark][0] + ' (' + themeLabel(entry.spark) + ')' + (entry.done ? ' · done' : ''));
      if (entry.note.trim()) lines.push(entry.note.trim());
      (entry.noteVersions || []).forEach(function(v) { lines.push('Alternate reflection: ' + v.text); });
      if (entry.trialPlan) lines.push('Experiment: ' + entry.trialPlan + ' · revisit ' + entry.trialDue + (entry.trialDone ? ' · reviewed' : ''), 'What happened: ' + (entry.trialOutcome || 'Not recorded yet'));
      if (entry.carry) lines.push('Carried forward: ' + label(entry.carry));
      if (entry.ref) lines.push('Briefing story: ' + entry.ref);
      (entry.reminders || []).forEach(function(reminder) { lines.push('Reminder: ' + reminder.metric + ' — due ' + label(reminder.due) + (reminder.done ? ' (checked ' + label(reminder.doneOn || reminder.due) + ')' : '')); });
      (entry.stories || []).forEach(function(story) { lines.push('Noted story: ' + story.headline + (story.source ? ' — ' + story.source : '') + (story.url ? ' — ' + story.url : '')); });
      lines.push('');
    });
    return {text:lines.join('\n'), count:days.length};
  }
  function renderLibrary() {
    var list = el('library-list'); list.replaceChildren();
    var theme = el('theme').value, query = el('search').value.trim().toLowerCase(), count = 0;
    prompts.forEach(function(prompt,index) {
      if (el('favourites-only').checked && !(favourites()[index] || {}).on) return;
      if (theme && themes[index] !== theme || query && (themeLabel(index) + ' ' + prompt.join(' ')).toLowerCase().indexOf(query) < 0) return;
      count++;
      var card = document.createElement('article'), title = document.createElement('h4'), thought = document.createElement('p'), button = document.createElement('button');
      title.textContent = prompt[0]; thought.textContent = prompt[1]; button.className = 'tool-chip';
      button.textContent = index === current().spark ? 'Selected · ' + themeLabel(index) : 'Choose · ' + themeLabel(index);
      button.disabled = current().done || index === current().spark;
      button.setAttribute('aria-label','Choose spark: ' + prompt[0]);
      button.addEventListener('click',function() {
        render(); if (current().done) return;
        // A new spark starts from the briefing as it is now, not the last spark's story.
        current().spark = index; current().picked = 'library'; current().ref = ''; current().refSource = ''; current().refUrl = ''; persist(); render();
        el('library').open = false; el('title').focus();
      });
      var favourite = document.createElement('button'); favourite.className = 'tool-chip';
      var selected = !!(favourites()[index] || {}).on;
      favourite.textContent = selected ? '★ Saved' : '☆ Save favourite'; favourite.setAttribute('aria-pressed',String(selected));
      favourite.setAttribute('aria-label',(selected ? 'Remove favourite: ' : 'Save favourite: ') + prompt[0]);
      favourite.addEventListener('click',function() { toggleFavourite(index); });
      card.append(title,thought,button,favourite); list.appendChild(card);
    });
    el('library-summary').textContent = 'Browse all ' + prompts.length + ' sparks · Find your inspiration';
    el('library-count').textContent = count + ' of ' + prompts.length + ' sparks' + (current().done ? ' · Undo today’s completion to choose a different quest.' : ' · Choose what fits your day. Your daily note stays with you.');
    if (!count) list.textContent = 'No sparks match. Try another theme or a shorter search.';
  }
  // A recovered version: swap it in (the note it replaces becomes the recovered
  // one, so nothing is lost), or dismiss it on every device.
  function useVersion(key, version) {
    render();
    var entry = records[key];
    if (!account || !entry) return;
    var replaced = entry.note.trim();
    entry.versionsDismissed = (entry.versionsDismissed || []).concat([versionId(version)]);
    entry.noteVersions = (entry.noteVersions || []).filter(function(v) { return versionId(v) !== versionId(version); });
    if (replaced) entry.noteVersions.push({text:replaced, at:Date.now()});
    entry.note = version.text;
    commitDays([key]);
  }
  function dismissVersion(key, version) {
    render();
    var entry = records[key];
    if (!account || !entry) return;
    entry.versionsDismissed = (entry.versionsDismissed || []).concat([versionId(version)]);
    entry.noteVersions = (entry.noteVersions || []).filter(function(v) { return versionId(v) !== versionId(version); });
    commitDays([key]);
  }
  function favourites() { return mergeFavourites(Object.values(records)); }
  function toggleFavourite(index) {
    render(); if (!account) return;
    var all = favourites(), previous = all[index];
    all[index] = {on:!(previous && previous.on),at:Math.max(Date.now(),(previous && previous.at || 0)+1)};
    current().favourites = all; persist(); render();
  }
  function chooseForIntention(intent) {
    var allowed = INTENT_THEMES[intent];
    if (!allowed) return nextSpark(current().spark,records,day);
    var candidates = order.filter(function(id) { return allowed.indexOf(themes[id]) >= 0 && id !== current().spark; });
    var recent = Object.keys(records).filter(function(key) { return key < day && key >= shiftDay(day,-14); }).map(function(key) { return records[key].spark; });
    return candidates.find(function(id) { return recent.indexOf(id) < 0; }) ?? candidates[0] ?? current().spark;
  }
  function renderPersonal() {
    var item = current();
    el('intention').value = item.intention || ''; el('intention').disabled = item.done;
    el('intention-hint').textContent = item.done ? 'Undo completion to choose a new direction.' : 'Choose what would help today. Your reflection stays with you.';
    var fav = !!(favourites()[item.spark] || {}).on;
    el('favourite').textContent = fav ? '★ Saved favourite' : '☆ Save this spark';
    el('favourite').setAttribute('aria-pressed',String(fav));
    if (document.activeElement !== el('trial-plan') && document.activeElement !== el('trial-due')) {
      el('trial-plan').value = item.trialPlan || '';
      el('trial-due').value = item.trialDue || shiftDay(day,3);
    }
    el('trial-due').min = day;
    el('trial-save').textContent = item.trialPlan ? 'Update experiment' : 'Save experiment';
    var conflicts = el('conflicts'); conflicts.replaceChildren();
    Object.keys(records).sort().reverse().forEach(function(key) { (records[key].noteVersions || []).forEach(function(version) {
      var card = document.createElement('article'), heading = document.createElement('strong'), note = document.createElement('p'), actions = document.createElement('div');
      heading.textContent = 'From another device · ' + label(key); note.textContent = version.text;
      actions.className = 'boost-version-actions';
      [['Use this version', function() { useVersion(key, version); }], ['Dismiss', function() { dismissVersion(key, version); }]].forEach(function(pair) {
        var button = document.createElement('button');
        button.type = 'button'; button.className = 'tool-chip'; button.textContent = pair[0];
        button.addEventListener('click', pair[1]);
        actions.appendChild(button);
      });
      card.append(heading,note,actions); conflicts.appendChild(card);
    }); });
    el('conflicts-wrap').hidden = !conflicts.children.length;
    var list = el('experiments');
    if (list.contains && document.activeElement && document.activeElement.tagName === 'TEXTAREA' && list.contains(document.activeElement)) return;
    list.replaceChildren();
    var keys = Object.keys(records).filter(function(key) { return records[key].trialPlan; }).sort(function(a,b) {
      return Number(records[a].trialDone)-Number(records[b].trialDone) || (records[a].trialDue || a).localeCompare(records[b].trialDue || b);
    });
    el('experiments-panel').hidden = !keys.length;
    keys.forEach(function(key) {
      var trial = records[key], row = document.createElement('article'), title = document.createElement('h3'), when = document.createElement('p');
      title.textContent = trial.trialPlan; when.className = 'boost-kicker';
      when.textContent = (trial.trialDone ? 'Reviewed' : trial.trialDue <= day ? 'Ready to revisit' : 'Revisit ' + label(trial.trialDue)) + ' · From ' + label(key);
      var outcomeLabel = document.createElement('label'), outcome = document.createElement('textarea'), button = document.createElement('button');
      outcomeLabel.textContent = 'What happened?'; outcome.value = trial.trialOutcome || ''; outcome.maxLength = 800; outcome.rows = 2;
      outcome.setAttribute('aria-label','What happened with: ' + trial.trialPlan);
      outcome.addEventListener('input',function() { if (!records[key]) return; records[key].trialOutcome = outcome.value.slice(0,800); records[key].updatedAt = Date.now(); sync.dirty[key] = true; saveLocal(); schedule(); status(); });
      outcomeLabel.appendChild(outcome); button.className = 'tool-chip'; button.textContent = trial.trialDone ? 'Reopen experiment' : 'Finish review';
      button.addEventListener('click',function() { if (!records[key]) return; records[key].trialDone = !records[key].trialDone; commitDays([key]); });
      row.append(title,when,outcomeLabel,button); list.appendChild(row);
    });
  }
  // The card's actions, shared by its buttons and the quick keys.
  function toggleDone() { render(); current().done = !current().done; if (current().done) expanded = true; persist(); render(); }
  function tuckAway() {
    render(); current().tucked = true; expanded = false; persist(); render();
    var briefing = document.getElementById('daily-intelligence');
    if (briefing && briefing.focus) briefing.focus();
  }
  function reopen() { expanded = true; render(); el('title').focus(); }
  function focusNote() {
    expanded = true; render();
    var note = el('note');
    note.focus();
    try { note.setSelectionRange(note.value.length, note.value.length); } catch (error) {}
    if (note.scrollIntoView) note.scrollIntoView({block:'center', behavior:'smooth'});
  }
  function compactNow() { return /\bis-compact\b/.test(el('panel').className || ''); }
  // Arriving at Today starts collapsed again if the day's spark is done or tucked.
  root.renderDailyBoost = function() { expanded = false; render(); pull(); };
  // The briefing below changed (rendered, opened from History, cleared).
  root.refreshDailyBoost = function() { render(); };
  // Reflections for Ctrl+K: every stored day with a note, noted stories or a
  // linked-spark story, read fresh at search time so a new note is findable.
  root.dailyBoostSearchEntries = function() {
    if (!account) return [];
    return Object.keys(records).sort().filter(function(key) {
      var entry = records[key];
      return entry.note.trim() || (entry.stories || []).length || entry.ref;
    }).map(function(key) {
      var entry = records[key];
      return {day:key, label:label(key), spark:prompts[entry.spark][0], theme:themeLabel(entry.spark), note:entry.note.trim(), done:entry.done,
        stories:(entry.stories || []).map(function(story) { return story.headline; }).concat(entry.ref ? [entry.ref] : [])};
    });
  };
  // Open one day from search: today goes to the note; an earlier day is pinned
  // to the top of the discoveries list, opened and highlighted.
  root.openDailyBoostDay = function(key) {
    if (!el('note') || !records[key]) return false;
    if (key === dateKey()) { focusNote(); return true; }
    shownDay = key; expanded = true; render();
    var panel = el('history-panel'), found = el('history').children && el('history').children[0];
    if (panel) panel.open = true;
    if (found && found.focus) {
      found.focus({preventScroll:true});
      if (found.scrollIntoView) found.scrollIntoView({block:'center', behavior:'smooth'});
    }
    return true;
  };
  // A briefing card's source link was opened: keep the story on today, so the
  // card can show "✓ Opened" on any device and the look-back can list it.
  root.markBriefingStoryOpened = function(story) {
    if (!story || !story.headline || !/^https?:\/\//i.test(String(story.url || '')) || !el('note')) return false;
    render();
    if (!account) return false;
    var list = current().opened || (current().opened = []), id = storyKey(story);
    var mine = list.filter(function(other) { return storyKey(other) === id; })[0];
    if (mine) { mine.how = 'open'; mine.url = story.url; }
    else list.push({headline:story.headline, source:story.source || '', url:story.url, how:'open'});
    persist(); render();
    return true;
  };
  // How a story has been read in the last seven days (a story often runs again
  // the next morning): 'opened' its source, 'read' (marked by hand), 'noted', or ''.
  function readState(story) {
    if (!account || !day || !story) return '';
    var id = storyKey(story), state = '';
    for (var i = 0; i < 7 && state !== 'opened'; i++) {
      var entry = records[shiftDay(day, -i)];
      if (!entry) continue;
      (entry.opened || []).forEach(function(other) { if (storyKey(other) === id) state = other.how === 'read' && state !== 'opened' ? 'read' : 'opened'; });
      if (!state && (entry.stories || []).some(function(other) { return storyKey(other) === id; })) state = 'noted';
    }
    return state;
  }
  root.dailyBoostReadState = readState;
  root.dailyBoostWasOpened = function(story) { return readState(story) === 'opened'; };
  // "Mark read" on a card: toggles a by-hand read mark (undo clears it from any
  // of the last seven days). A story already opened stays read.
  // ── Watch-metric reminders ──
  // Every reminder across the stored days, with the day it lives on.
  function allReminders() {
    var out = [];
    Object.keys(records).sort().forEach(function(key) { (records[key].reminders || []).forEach(function(item, index) { out.push({day:key, index:index, item:item}); }); });
    return out;
  }
  function activeReminder(story) {
    var id = storyKey(story);
    return allReminders().filter(function(entry) { return !entry.item.done && storyKey(entry.item) === id; })[0] || null;
  }
  // Save edits made to earlier days as well as today (each touched day syncs).
  function commitDays(keys) {
    keys.forEach(function(key) { if (records[key]) { records[key].updatedAt = Date.now(); sync.dirty[key] = true; } });
    saveLocal(); schedule(); status(); render();
  }
  root.dailyBoostReminderFor = function(story) {
    if (!account || !story) return null;
    var entry = activeReminder(story);
    return entry ? {due:entry.item.due, label:label(entry.item.due)} : null;
  };
  // "⏰ Remind me" on a card: sets a reminder for its watch metric, or cancels
  // the one already set. Returns the new reminder, null when cancelled.
  root.toggleBriefingReminder = function(story) {
    if (!story || !story.headline || !String(story.metric || '').trim() || !el('note')) return false;
    render();
    if (!account) return false;
    var entry = activeReminder(story);
    if (entry) { records[entry.day].reminders.splice(entry.index, 1); commitDays([entry.day]); return null; }
    var item = {metric:String(story.metric).trim(), headline:story.headline, source:story.source || '', url:story.url || '', due:dueFor(story, day), done:false, doneOn:''};
    (current().reminders || (current().reminders = [])).push(item);
    commitDays([day]);
    return {due:item.due, label:label(item.due), metric:item.metric};
  };
  function reminderAction(entry, action) {
    var item = records[entry.day] && records[entry.day].reminders[entry.index];
    if (!item) return;
    if (action === 'snooze') item.due = shiftDay(item.due > day ? item.due : day, 7);
    else { item.done = true; item.doneOn = day; }
    commitDays([entry.day]);
  }
  function relativeDue(due) {
    var days = Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
    return days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : days > 1 ? 'in ' + days + ' days · ' + label(due) : days === -1 ? 'a day overdue' : -days + ' days overdue';
  }
  // The "To check" panel: reminders due today or earlier, with upcoming ones folded.
  function renderReminders() {
    var panel = el('reminders');
    if (!panel) return;
    var active = allReminders().filter(function(entry) { return !entry.item.done; }).sort(function(a, b) { return a.item.due < b.item.due ? -1 : a.item.due > b.item.due ? 1 : 0; });
    var due = active.filter(function(entry) { return entry.item.due <= day; }), upcoming = active.filter(function(entry) { return entry.item.due > day; });
    panel.hidden = !active.length;
    el('reminders-title').textContent = due.length ? '⏰ To check today (' + due.length + ')' : '⏰ Coming up to check';
    el('reminders-sub').textContent = due.length ? 'Things your briefing said to look up, now due.' : 'Nothing due today. Next: ' + (upcoming[0] ? upcoming[0].item.metric + ', ' + relativeDue(upcoming[0].item.due) : '');
    var list = el('reminder-list'); list.replaceChildren();
    due.forEach(function(entry) { list.appendChild(reminderRow(entry, true)); });
    var more = el('reminder-upcoming'); more.replaceChildren();
    upcoming.forEach(function(entry) { more.appendChild(reminderRow(entry, false)); });
    el('reminder-upcoming-wrap').hidden = !upcoming.length;
    el('reminder-upcoming-title').textContent = upcoming.length + (due.length ? ' more coming up' : ' coming up');
  }
  function reminderRow(entry, isDue) {
    var item = entry.item, row = document.createElement('article'), head = document.createElement('div'), metric = document.createElement('strong'), when = document.createElement('span');
    var from = document.createElement('p'), actions = document.createElement('div');
    row.className = 'watch-reminder' + (isDue && item.due < day ? ' is-overdue' : '');
    head.className = 'watch-reminder-head';
    metric.textContent = item.metric; when.className = 'boost-kicker'; when.textContent = relativeDue(item.due);
    head.append(metric, when);
    from.className = 'watch-reminder-from';
    from.textContent = 'From “' + item.headline + '”' + (item.source ? ' · ' + item.source : '');
    if (item.url) { var link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' ↗'; link.setAttribute('aria-label', 'Open the source for ' + item.headline); from.appendChild(link); }
    actions.className = 'watch-reminder-actions';
    var dateLabel = document.createElement('label'), dateInput = document.createElement('input'), reschedule = document.createElement('button');
    dateLabel.textContent = 'Review date '; dateInput.type = 'date'; dateInput.value = item.due; dateLabel.appendChild(dateInput);
    reschedule.className = 'tool-chip'; reschedule.textContent = 'Change date';
    reschedule.addEventListener('click',function() {
      var value = dateInput.value, parsed = new Date(value + 'T00:00:00Z');
      if (!DAY_KEY.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) return;
      item.due = value; commitDays([entry.day]);
    });
    [['✓ Checked', function() { reminderAction(entry, 'done'); }],
     ['✎ Note what you found', function() {
       reminderAction(entry, 'done');
       prefillNote('Checked “' + item.metric + '” (on “' + item.headline + '”): ', item.metric);
     }],
     ['Snooze a week', function() { reminderAction(entry, 'snooze'); }]].forEach(function(pair) {
      var button = document.createElement('button');
      button.type = 'button'; button.className = 'tool-chip'; button.textContent = pair[0];
      button.addEventListener('click', pair[1]);
      actions.appendChild(button);
    });
    actions.append(dateLabel,reschedule);
    row.append(head, from, actions);
    return row;
  }
  root.markBriefingStoryRead = function(story) {
    if (!story || !story.headline || !el('note')) return false;
    render();
    if (!account) return false;
    var id = storyKey(story), state = readState(story);
    if (state === 'opened') return true;
    if (state === 'read') {
      for (var i = 0; i < 7; i++) {
        var key = shiftDay(day, -i), entry = records[key];
        if (!entry || !entry.opened) continue;
        var kept = entry.opened.filter(function(other) { return !(other.how === 'read' && storyKey(other) === id); });
        if (kept.length !== entry.opened.length) { entry.opened = kept; entry.updatedAt = Date.now(); sync.dirty[key] = true; }
      }
      saveLocal(); schedule(); status(); render();
      return true;
    }
    (current().opened || (current().opened = [])).push({headline:story.headline, source:story.source || '', url:/^https?:\/\//i.test(String(story.url || '')) ? story.url : '', how:'read'});
    persist(); render();
    return true;
  };
  // "Note this" on a briefing card: open today's reflection on that story, and
  // keep the story (with its link) on the day. Returns false when signed out.
  root.noteBriefingStory = function(story) {
    if (!story || !story.headline || !el('note')) return false;
    render();
    if (!account) return false;
    var item = current(), list = item.stories || (item.stories = []);
    var same = function(other) { return story.url ? other.url === story.url : other.headline === story.headline; };
    if (!list.some(same)) { list.push({headline:story.headline, source:story.source || '', url:story.url || ''}); list.splice(0, Math.max(0, list.length - 6)); }
    prefillNote('On “' + story.headline + '”' + (story.source ? ' (' + story.source + ')' : '') + ': ', story.headline);
    return true;
  };
  // Start a line in today's note (unless one about the same thing is already
  // there), open the card, and leave the caret ready at the end.
  function prefillNote(lead, about) {
    var note = el('note');
    if (!account || !note) return;
    if (note.value.indexOf('“' + about + '”') < 0) note.value = note.value.trim() ? note.value.replace(/\s+$/, '') + '\n\n' + lead : lead;
    current().note = note.value.slice(0,1200);
    expanded = true; persist(); render();
    note.focus();
    try { note.setSelectionRange(note.value.length, note.value.length); } catch (error) {}
    if (note.scrollIntoView) note.scrollIntoView({block:'center', behavior:'smooth'});
  }
  root.resetDailyBoost = function() { records = {}; account = null; day = null; expanded = false; shownDay = null; resetSync(); if (el('note')) { el('note').value = ''; el('history').replaceChildren(); el('feedback').textContent = ''; el('export').value = ''; el('export').hidden = true; el('copy-status').textContent = ''; el('noted').replaceChildren(); el('noted').hidden = true; } };
  document.addEventListener('DOMContentLoaded',function() {
    if (!el('title')) return;
    ['gentle','stretch'].forEach(function(energy) { el(energy).addEventListener('click',function() { render(); if (!current().done) current().energy = energy; persist(); render(); }); });
    el('swap').addEventListener('click',function() {
      render();
      if (!current().done) { current().spark = current().intention ? chooseForIntention(current().intention) : nextSpark(current().spark,records,day); current().picked = 'swap'; current().ref = ''; current().refSource = ''; current().refUrl = ''; }
      persist(); render();
    });
    el('theme').addEventListener('change',renderLibrary);
    el('search').addEventListener('input',renderLibrary);
    el('favourites-only').addEventListener('change',renderLibrary);
    el('favourite').addEventListener('click',function() { toggleFavourite(current().spark); });
    el('intention').addEventListener('change',function() {
      var intent = el('intention').value; render(); if (current().done) return;
      current().intention = intent; current().spark = chooseForIntention(intent); current().picked = 'intention';
      current().ref = ''; current().refSource = ''; current().refUrl = ''; persist(); render();
    });
    el('trial-save').addEventListener('click',function() {
      var plan = el('trial-plan').value.trim(), due = el('trial-due').value;
      if (!plan || !DAY_KEY.test(due) || due < dateKey() || !Number.isFinite(Date.parse(due + 'T00:00:00Z'))) { el('trial-status').textContent = 'Add a small action and a review date of today or later.'; return; }
      render(); current().trialPlan = plan.slice(0,400); current().trialDue = due; current().trialDone = false;
      persist(); render(); el('trial-status').textContent = 'Saved. Revisit it in Your experiments below; review dates are shown in the app.';
    });
    el('done').addEventListener('click',toggleDone);
    el('tuck').addEventListener('click',tuckAway);
    el('open').addEventListener('click',reopen);
    // Quick keys on Today: N note, D done, T tuck or reopen. Never while typing,
    // with a modifier held, off the Today page, or behind an overlay.
    document.addEventListener('keydown',function(event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return;
      var target = event.target, tag = target && target.tagName ? String(target.tagName).toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
      var page = document.getElementById('page-today');
      if (!page || (' ' + page.className + ' ').indexOf(' active ') < 0 || page.inert) return;
      if (document.querySelector && document.querySelector('#auth-overlay:not(.hidden), #evidence-picker-overlay:not([hidden]), #intel-search-overlay:not([hidden])')) return;
      var key = String(event.key || '').toLowerCase(), act = {n:focusNote, d:toggleDone, t:compactNow() ? reopen : tuckAway}[key];
      if (!act) return;
      event.preventDefault(); act();
    });
    el('briefing-jump').addEventListener('click',function() {
      var story = linkedStory(current());
      if (!story || !root.highlightSourceTitle || !root.highlightSourceTitle(story.headline,'today')) el('feedback').textContent = 'That story is not in the briefing shown below right now.';
    });
    el('copy').addEventListener('click',function() {
      render();
      var result = exportText(), box = el('export');
      if (!result.count) { box.hidden = true; el('copy-status').textContent = 'Nothing to copy yet. Notes and small wins will collect here.'; return; }
      function manual() { box.hidden = false; box.value = result.text; box.focus(); box.select(); el('copy-status').textContent = 'Copy did not go through. Select the text below and copy it.'; }
      if (!root.navigator || !root.navigator.clipboard) { manual(); return; }
      root.navigator.clipboard.writeText(result.text).then(function() {
        box.hidden = true; el('copy-status').textContent = 'Copied ' + result.count + (result.count === 1 ? ' entry.' : ' entries.') + ' Paste it anywhere you keep notes.';
      }, manual);
    });
    el('note').addEventListener('input',function() {
      // Keep a late-night draft attached to the day on which it was started.
      if (account !== (root._firebaseUid || null)) { render(); return; }
      current().note = el('note').value.slice(0,1200); persist();
    });
    document.addEventListener('visibilitychange',function() {
      // Leaving: send a pending edit now. Returning: pick up the other device's days.
      if (document.hidden) { if (sync.timer) push(); return; }
      if (day !== dateKey()) render();
      pull();
    });
    root.addEventListener('pagehide',function() { if (sync.timer) push(); });
    root.setInterval(function() { if (!document.hidden && day !== dateKey() && document.activeElement !== el('note')) render(); },60000);
    render();
  });
})(typeof window !== 'undefined' ? window : globalThis);
