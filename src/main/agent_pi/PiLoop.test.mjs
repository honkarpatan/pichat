// Run: node agent_pi/PiLoop.test.mjs   (pure Node, no plugin needed)
import assert from 'node:assert/strict';
import { runPiLoop } from './PiLoop.js';

const call = (name, args = {}, id) => ({ name, args, id: id || `${name}_${Math.random().toString(36).slice(2, 6)}` });
const turnFrom = (script) => {
  let i = 0;
  return async () => {
    const t = script[Math.min(i++, script.length - 1)];
    return typeof t === 'function' ? t() : t;
  };
};
const ok = async () => ({ response: { success: true } });

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

await t('tool call → result → plain answer ends the run (no finish tool)', async () => {
  const ran = [];
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'hi' }],
    streamTurn: turnFrom([
      { text: 'reading', functionCalls: [call('read', { path: 'a.js' }, 'c1')] },
      { text: 'All done.', functionCalls: [] }
    ]),
    runTool: async (fc) => { ran.push(fc.name); return { response: { content: 'x' } }; }
  });
  assert.deepEqual(ran, ['read']);
  assert.equal(r.reason, 'done');
  assert.equal(r.finalText, 'All done.');
  assert.equal(r.turns, 2);
  const roles = r.messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'model', 'user', 'model']);
  assert.equal(r.messages[2].content[0].functionResponse.id, 'c1');
});

await t('steering after a tool call skips the remaining calls and injects the message', async () => {
  const ran = [];
  let steerQueue = [];
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'go' }],
    streamTurn: turnFrom([
      { text: '', functionCalls: [call('read', { path: '1' }, 'a'), call('read', { path: '2' }, 'b'), call('read', { path: '3' }, 'c')] },
      { text: 'ok', functionCalls: [] }
    ]),
    runTool: async (fc) => { ran.push(fc.args.path); if (fc.args.path === '1') steerQueue = [{ role: 'user', content: [{ text: 'STEER' }] }]; return { response: { ok: 1 } }; },
    getSteering: async () => { const q = steerQueue; steerQueue = []; return q; }
  });
  assert.deepEqual(ran, ['1']);
  const resp = r.messages[2].content;
  assert.equal(resp.length, 3);
  assert.equal(resp[1].functionResponse.response.skipped, true);
  assert.equal(r.messages[3].content[0].text, 'STEER');
});

await t('repeat-call guard blocks identical calls, then stops with no_progress', async () => {
  const ran = [];
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    maxIdenticalCalls: 2,
    maxTurns: 20,
    streamTurn: async () => ({ text: '', functionCalls: [call('grep', { pattern: 'foo' })] }),
    runTool: async (fc) => { ran.push(fc.name); return { response: { matches: [] } }; }
  });
  assert.equal(ran.length, 2, 'only first 2 identical calls execute');
  assert.equal(r.reason, 'no_progress');
});

await t('a mutation resets the repeat counter (verify-read after edit is allowed)', async () => {
  const ran = [];
  const script = [
    [call('read', { path: 'f' })], [call('str_replace', { path: 'f', s: 1 })],
    [call('read', { path: 'f' })], [call('str_replace', { path: 'f', s: 2 })],
    [call('read', { path: 'f' })]
  ];
  let i = 0;
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    maxIdenticalCalls: 2,
    streamTurn: async () => (i < script.length ? { text: '', functionCalls: script[i++] } : { text: 'done', functionCalls: [] }),
    runTool: async (fc) => { ran.push(fc.name); return { response: { ok: true } }; },
    isMutating: (n) => n === 'str_replace'
  });
  assert.equal(ran.length, 5);
  assert.equal(r.reason, 'done');
});

await t('truncated text-only reply is continued (max 2×)', async () => {
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    streamTurn: turnFrom([
      { text: 'part1', functionCalls: [], truncated: true },
      { text: 'part2', functionCalls: [], truncated: true },
      { text: 'part3', functionCalls: [], truncated: true },
      { text: 'never', functionCalls: [] }
    ]),
    runTool: ok
  });
  assert.equal(r.turns, 3, '1 original + 2 continuations');
  const sys = r.messages.filter((m) => m.role === 'user' && /cut off/.test(m.content?.[0]?.text || ''));
  assert.equal(sys.length, 2);
});

await t('follow-up messages are consumed only when the agent would stop', async () => {
  let fu = [{ role: 'user', content: [{ text: 'FOLLOW' }] }];
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    streamTurn: turnFrom([{ text: 'first', functionCalls: [] }, { text: 'second', functionCalls: [] }]),
    runTool: ok,
    getFollowUp: async () => { const q = fu; fu = []; return q; }
  });
  assert.equal(r.turns, 2);
  assert.equal(r.finalText, 'second');
  assert.equal(r.messages[2].content[0].text, 'FOLLOW');
});

await t('stop flag from a tool (virtual finish) ends the run after the batch', async () => {
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    streamTurn: turnFrom([{ text: '', functionCalls: [call('finish_task', { summary: 's' })] }, { text: 'SHOULD NOT RUN', functionCalls: [] }]),
    runTool: async () => ({ response: { success: true }, stop: true })
  });
  assert.equal(r.turns, 1);
  assert.equal(r.reason, 'done');
});

await t('max turns', async () => {
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    maxTurns: 3,
    streamTurn: async ({ turn }) => ({ text: '', functionCalls: [call('read', { path: 'p' + turn })] }),
    runTool: ok
  });
  assert.equal(r.reason, 'max_steps');
  assert.equal(r.turns, 3);
});

await t('abort throws AbortError', async () => {
  const ac = new AbortController();
  let threw = null;
  try {
    await runPiLoop({
      messages: [{ role: 'user', content: 'x' }],
      signal: ac.signal,
      streamTurn: async () => { ac.abort(); return { text: 'x', functionCalls: [] }; },
      runTool: ok
    });
  } catch (e) { threw = e; }
  assert.equal(threw && threw.name, 'AbortError');
});

await t('parallel mode runs a read-only batch concurrently, keeps result order', async () => {
  const order = [];
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    toolExecution: 'parallel',
    isParallelSafe: () => true,
    streamTurn: turnFrom([
      { text: '', functionCalls: [call('read', { p: 1 }, 'a'), call('read', { p: 2 }, 'b')] },
      { text: 'done', functionCalls: [] }
    ]),
    runTool: async (fc) => {
      await new Promise((res) => setTimeout(res, fc.args.p === 1 ? 30 : 5));
      order.push(fc.args.p);
      return { response: { p: fc.args.p } };
    }
  });
  assert.deepEqual(order, [2, 1], 'finished out of order (concurrent)');
  const fr = r.messages[2].content;
  assert.deepEqual(fr.map((p) => p.functionResponse.id), ['a', 'b'], 'results stay in call order');
});

await t('runTool exception becomes an error result, loop continues', async () => {
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'x' }],
    streamTurn: turnFrom([{ text: '', functionCalls: [call('read', {}, 'z')] }, { text: 'recovered', functionCalls: [] }]),
    runTool: async () => { throw new Error('disk exploded'); }
  });
  assert.equal(r.messages[2].content[0].functionResponse.response.error, 'disk exploded');
  assert.equal(r.finalText, 'recovered');
});

await t('transformContext result persists in the transcript', async () => {
  let calls = 0;
  const r = await runPiLoop({
    messages: [{ role: 'user', content: 'a' }, { role: 'model', content: 'b' }, { role: 'user', content: 'c' }],
    transformContext: async (m) => { calls++; return calls === 1 ? [m[0], { role: 'user', content: 'SUMMARY' }, m[2]] : m; },
    streamTurn: turnFrom([{ text: 'x', functionCalls: [call('read', {})] }, { text: 'y', functionCalls: [] }]),
    runTool: ok
  });
  assert.equal(r.messages[1].content, 'SUMMARY');
});

console.log(`\n${passed} passed`);
