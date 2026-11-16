/**
 * PiLoop — the Pi agent loop, as a PURE module (no plugin imports).
 *
 * Mechanism (same shape as Pi's agent-core):
 *
 *   prompt -> LLM turn -> tool calls? -> run tools -> tool results -> LLM turn -> ...
 *   until the model answers WITHOUT tool calls.
 *
 *   - steering messages   : checked after every tool call. If one arrives, the
 *                           remaining calls of the batch are skipped and the
 *                           message is injected before the next LLM turn.
 *   - follow-up messages  : consumed only when the agent would otherwise stop.
 *   - transformContext    : hook before every LLM turn (compaction / pruning).
 *   - no finish tool, no forced tool use, no "nudges".
 *
 * Messages use the plugin's internal provider-neutral shape:
 *   { role: 'user' | 'model' | 'system', content: string | parts[] }
 *   parts: { text } | { functionCall:{name,args,id} } | { functionResponse:{name,id,response} } | provider blocks
 *
 * Everything environment-specific is injected, so this file can be unit tested in Node.
 */

const TAG = '[PiLoop]';

export function makeAbortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function sigOf(fc) {
  let a = '';
  try { a = JSON.stringify(fc.args ?? {}); } catch (_) { a = String(fc.args); }
  return `${fc.name}:${a.slice(0, 600)}`;
}

/**
 * @param {object} opts
 * @param {Array}  opts.messages                      initial transcript
 * @param {(ctx:{messages:Array,turn:number})=>Promise<{text:string,functionCalls:Array,rawParts?:Array,truncated?:boolean}>} opts.streamTurn
 * @param {(fc:object, ctx:{turn:number,index:number})=>Promise<{response:object,isError?:boolean,stop?:boolean}>} opts.runTool
 * @param {(e:object)=>void} [opts.onEvent]
 * @param {AbortSignal} [opts.signal]
 * @param {()=>Promise<Array>} [opts.getSteering]     returns message objects
 * @param {()=>Promise<Array>} [opts.getFollowUp]     returns message objects
 * @param {(messages:Array, ctx:{turn:number})=>Promise<Array>|Array} [opts.transformContext]
 * @param {number} [opts.maxTurns=50]
 * @param {'sequential'|'parallel'} [opts.toolExecution='sequential']
 * @param {(name:string)=>boolean} [opts.isParallelSafe]
 * @param {(name:string)=>boolean} [opts.isMutating]
 * @param {number} [opts.maxIdenticalCalls=4]
 * @param {number} [opts.maxTruncationContinues=2]
 * @returns {Promise<{messages:Array, reason:string, turns:number, finalText:string, anyOutput:boolean}>}
 */
export async function runPiLoop(opts) {
  const {
    messages: initial,
    streamTurn,
    runTool,
    onEvent = () => {},
    signal = null,
    getSteering = async () => [],
    getFollowUp = async () => [],
    transformContext = null,
    maxTurns = 50,
    toolExecution = 'sequential',
    isParallelSafe = () => false,
    isMutating = () => false,
    maxIdenticalCalls = 4,
    maxTruncationContinues = 2
  } = opts;

  let transcript = Array.isArray(initial) ? initial.slice() : [];
  let turn = 0;
  let reason = 'done';
  let finalText = '';
  let anyOutput = false;
  let truncContinues = 0;
  let doom = false;
  const seen = new Map();

  const emit = (e) => {
    try { onEvent(e); } catch (err) { console.warn(TAG, 'listener threw', err?.message || err); }
  };
  const checkAbort = () => { if (signal && signal.aborted) throw makeAbortError(); };

  emit({ type: 'agent_start' });

  outer:
  while (true) {
    // Messages that were already queued before this run segment started.
    const early = await getSteering();
    if (early && early.length) transcript.push(...early);

    while (true) {
      checkAbort();
      if (turn >= maxTurns) { reason = 'max_steps'; break outer; }
      turn++;
      emit({ type: 'turn_start', turn });

      if (transformContext) {
        const next = await transformContext(transcript, { turn });
        if (Array.isArray(next) && next.length) transcript = next;
      }
      checkAbort();

      const res = (await streamTurn({ messages: transcript, turn })) || {};
      checkAbort();

      const text = typeof res.text === 'string' ? res.text : '';
      const calls = Array.isArray(res.functionCalls) ? res.functionCalls : [];
      const parts = Array.isArray(res.rawParts) && res.rawParts.length
        ? res.rawParts
        : [...(text ? [{ text }] : []), ...calls.map((fc) => ({ functionCall: fc }))];

      if (text.trim()) { finalText = text; anyOutput = true; }
      if (calls.length) anyOutput = true;
      if (parts.length) transcript.push({ role: 'model', content: parts });
      emit({ type: 'message_end', turn, text, toolCalls: calls.length });

      // ---- no tool calls: the model is answering --------------------------------
      if (!calls.length) {
        emit({ type: 'turn_end', turn, toolResults: [] });

        if (res.truncated && parts.length && truncContinues < maxTruncationContinues) {
          truncContinues++;
          transcript.push({
            role: 'user',
            content: [{ text: '[SYSTEM: Your last reply hit the output limit and was cut off. Continue exactly where you stopped.]' }]
          });
          continue;
        }
        const steer = await getSteering();
        if (steer && steer.length) { transcript.push(...steer); continue; }
        break; // agent would stop -> follow-up check below
      }

      // ---- tool calls -----------------------------------------------------------
      const responses = new Array(calls.length);
      const steerMsgs = [];
      let stop = false;

      const execOne = async (fc, index) => {
        const sig = sigOf(fc);
        const n = (seen.get(sig) || 0) + 1;
        seen.set(sig, n);
        if (n > maxIdenticalCalls + 2) {
          doom = true;
          return { response: { error: 'Repeated identical call blocked. Stop and answer.' }, isError: true };
        }
        if (n > maxIdenticalCalls) {
          return {
            response: {
              error: `You already made this exact ${fc.name} call ${n - 1} times with the same arguments and nothing changed. ` +
                'Change your approach, or answer with what you already know.',
              repeated: true
            },
            isError: true
          };
        }
        emit({ type: 'tool_execution_start', turn, toolCallId: fc.id, toolName: fc.name, args: fc.args });
        let r;
        try {
          r = await runTool(fc, { turn, index });
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          r = { response: { error: e?.message || String(e) }, isError: true };
        }
        if (!r || typeof r !== 'object') r = { response: { success: true } };
        if (!r.response || typeof r.response !== 'object') r.response = { result: r.response ?? null };
        if (isMutating(fc.name) && !r.isError) seen.clear();
        emit({ type: 'tool_execution_end', turn, toolCallId: fc.id, toolName: fc.name, isError: !!r.isError });
        return r;
      };

      const canParallel =
        toolExecution === 'parallel' && calls.length > 1 && calls.every((fc) => isParallelSafe(fc.name));

      if (canParallel) {
        const all = await Promise.all(calls.map((fc, i) => execOne(fc, i)));
        all.forEach((r, i) => { responses[i] = r; if (r.stop) stop = true; });
        const steer = await getSteering();
        if (steer && steer.length) steerMsgs.push(...steer);
      } else {
        let skipRest = false;
        for (let i = 0; i < calls.length; i++) {
          checkAbort();
          if (skipRest) {
            responses[i] = {
              response: { skipped: true, error: 'Skipped: the user sent a new message while tools were running.' },
              isError: true
            };
            continue;
          }
          const r = await execOne(calls[i], i);
          responses[i] = r;
          if (r.stop) stop = true;
          const steer = await getSteering();
          if (steer && steer.length) { steerMsgs.push(...steer); skipRest = true; }
        }
      }

      transcript.push({
        role: 'user',
        content: calls.map((fc, i) => ({
          functionResponse: { name: fc.name, id: fc.id, response: responses[i].response }
        }))
      });
      if (steerMsgs.length) transcript.push(...steerMsgs);

      emit({ type: 'turn_end', turn, toolResults: responses.map((r) => !!r.isError) });

      if (doom) { reason = 'no_progress'; break outer; }
      if (stop) { reason = 'done'; break outer; }
      // loop again: the model sees the tool results
    }

    // Agent would stop: consume follow-ups, otherwise finish.
    const follow = await getFollowUp();
    if (follow && follow.length) {
      transcript.push(...follow);
      continue outer;
    }
    break outer;
  }

  emit({ type: 'agent_end', reason, turns: turn });
  return { messages: transcript, reason, turns: turn, finalText, anyOutput };
}
