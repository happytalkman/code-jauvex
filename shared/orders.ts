/**
 * When the app carries out an order said to it (open a new agent, restart) and when it asks first. Pure, checked in tests/orders.test.ts.
 * The rule (the user's, 2026-09-23): the app acts on its own only when it is sure the words are an order for it. When nobody is sure,
 * it asks in one short line; a clear yes carries the order out, anything else sends the words to the agent as they were said.
 * A misread order creates or stops things nobody asked for: "give me the handoff instructions so the other agent can work on this"
 * opened a new agent (Jev leaned to the agent at 0.55, the voice model read an order, and the app acted on the voice model alone).
 */
export const JEV_MIN_CONFIDENCE = 0.6; // below this Jev's pick is not taken: the voice model is asked instead
export const JEV_SURE = 0.85;          // at or above this, Jev's word alone makes the app act; between the two, it asks

/** The kind of agent named in what was said, as speech-to-text writes it: Claude as "Cloud", Codex as "codecs", ZCode as "Z code" or
 * "zed code", Jev as "Jeff", "Jet" or "Jab", and in Korean (클로드, 코덱스, 제트 코드, 클로, 제브: "클로" is Claw only when no "드" follows).
 * Claw and ZCode are looked for first: their words contain "claw" and "code". Null when none was named. */
const AGENT_WORDS: ['zcode' | 'codex' | 'jev' | 'claude' | 'claw', RegExp][] = [['claw', /\b(claw|claws|clawcode|claw ?code)\b|클로(?!드)/i], ['zcode', /\b(z ?-?code|zed ?code|zee ?code|zhipu|glm)\b|(?:제트|지|즈|z)\s?코드|지엘엠/i], ['codex', /\b(codex|codecs|code ?x|kodex|chat ?gpt|open ?ai|gpt)\b|코덱스|코덱|챗\s?지피티|오픈\s?에이아이|지피티/i], ['jev', /\b(jev|jeff|jet|jab|jav|jeb|classifier)\b|제브|젭|분류기/i], ['claude', /\b(claude|cloud|clod|claud|clawed|anthropic)\b|클로드|클라우드|앤트로픽/i]];
/** Jev's question for the kind of agent an order asks for: every provider has its answer (Claw had none until 2026-09-27, and "open a
 * new claw agent" opened Claude, Jev's nearest pick at 0.97), with the ways speech-to-text writes each, Korean too. */
export const AGENT_KIND_CHOICES = { type: 'choice' as const, instructions: 'Which kind of agent is asked for in `said`? Speech-to-text often writes Claude as "Cloud", Codex as "codecs", ZCode as "Z code" or "zed code", and Jev as "Jeff", "Jet" or "Jab". Claw and Claude are different agents: "claw" (Korean 클로) is Claw, "Claude" (Korean 클로드) is Claude.',
  criteria: { claude: 'Claude (클로드), not Claw', codex: 'Codex, ChatGPT or OpenAI (코덱스)', zcode: 'ZCode (Z code, zed code, 제트 코드), GLM or Zhipu', claw: 'Claw, claw-code (클로), not Claude', jev: 'Jev, a classifier agent (제브)', unspecified: 'No kind was named' } };
export const agentKindSaid = (text: string): 'zcode' | 'codex' | 'jev' | 'claude' | 'claw' | null => AGENT_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;

export type OrderVerdict = 'act' | 'ask' | 'pass';
/** exact: the words are the order and nothing else ("restart the app"). jev: its pick (for the app or the agent) and how sure.
 *  model: what the voice model read, when it was asked (null: not asked, or no usable answer). */
export function orderVerdict(o: { exact?: boolean; jev?: { forApp: boolean; confidence: number } | null; model?: 'order' | 'not' | null }): OrderVerdict {
  if (o.exact) return 'act';
  const j = o.jev;
  if (j && j.confidence >= JEV_MIN_CONFIDENCE) return !j.forApp ? 'pass' : j.confidence >= JEV_SURE ? 'act' : 'ask';
  return o.model === 'not' ? 'pass' : 'ask'; // nobody sure: it may be an order, so it is asked, never carried out
}

/** The answer to the app's question: a clear yes, a clear no, or neither (then the words go to the agent). */
export function answerIs(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase().replace(/[.,!?…]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!t || t.split(' ').length > 8) return null;
  if (/^(?:no|nope|nah|not that|don'?t|do not|cancel|never ?mind|stop)\b/.test(t) || /\b(?:for the agent|to the agent|send it)\b/.test(t)) return 'no';
  if (/^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|correct|right|exactly|please do|do it|go ahead|go for it|open it|create it|make it|restart(?: it)?)\b/.test(t)) return 'yes';
  // Korean: 아니/취소/에이전트한테 is a no; 네/응/그래/좋아/맞아/열어/만들어/재시작 is a yes
  if (/^(?:아니|아뇨|노|싫어|취소|하지\s?마|됐어|그만)/.test(t) || /(?:에이전트한테|에이전트에게|그대로 보내)/.test(t)) return 'no';
  if (/^(?:네|넵|예|응|웅|그래|좋아|맞아|오케이|열어|만들어|재시작|다시 시작|해\s?줘|그렇게\s?해)/.test(t)) return 'yes';
  return null;
}

/** Does a spoken stop carry more than the stop itself? "Okay, wait a second. List, list, list. Before you do anything, stop." does:
 * the turn is cut and those words then go to the agent, since they tell it what to do next. "Stop", "hold on, stop that" or
 * "okay wait, before you do anything, stop" do not: nothing is left once the words that only stop are taken out. (2026-09-23: a
 * stop's words were dropped whatever they said, and never shown in the chat either.) */
const ONLY_STOP = /\b(?:before you do anything(?: else)?|don'?t do anything(?: yet| else)?|wait a (?:second|sec|minute|moment)|hold on|hang on|one (?:second|sec|moment)|a (?:second|sec|moment)|right now|stop (?:it|that|this|now|there)|cancel (?:it|that|this)|stop+(?:ping)?|wait|cancel|enough|halt|pause|okay|ok|hey|so|and|just|please|now|no|that|it|this|everything|all)\b/gi;
export const stopSaysMore = (text: string): boolean => /\p{L}/u.test(text.replace(ONLY_STOP, ' '));

// ---------- the gates of the app's orders (electron/voice.ts): cheap word checks that let a sentence reach Jev (or the voice model)
// as a possible order for the app. English as before, and Korean: 2026-09-27, "스크래치 폴더에 새 코덱스 에이전트 만들어줘" and "앱
// 재시작해" never reached Jev and went to the agent as messages. Korean puts the verb last, and to JS regexes Hangul is not a word
// character (\b and \W do not work around it), so its patterns stand apart.
const NEW_GATE = /^\W*(?:(?:ok(?:ay)?|hey|please|now|and|so|then)\W+)*(?:can you\W+|could you\W+|i want (?:you )?to\W+|let'?s\W+)?(?:create|make|start|open|spin up|launch|give me|add|new)\b[^.?!]{0,60}\b(?:agent|session|chat|conversation)s?\b/i;
// "... 에이전트 (하나) 만들어줘 / 열어 / 띄워 / 새로 시작해": the thing, then an order to open one (not "만드는", "만든": a description)
const NEW_GATE_KO = /(?:에이전트|세션|채팅|대화창|대화방)[^.?!]{0,20}?(?:만들어|만들자|열어|열자|띄워|띄우자|시작해|시작하자|생성해|추가해|켜\s?줘)/;
/** Does this sentence ask the app to open a new agent (a session, a chat)? Only a gate: Jev and the voice model decide. */
export const newAgentAsked = (sentence: string): boolean => NEW_GATE.test(sentence) || NEW_GATE_KO.test(sentence);

const RESTART_GATE = /^\W*(?:(?:ok(?:ay)?|hey|please|now|and|so|then)\W+)*(?:can you\W+|could you\W+|please\W+)?(?:restart|relaunch|reload|reboot)\W+(?:the\W+|this\W+)?(?:app|application|program|yourself)\b[^a-z]*$/i;
const KO_DO = '(?:해|하자|해요|해\\s?줘|해\\s?줄래|해\\s?줄래요|해\\s?주세요|시켜|시켜\\s?줘|줘|주세요)?'; // the polite or plain ending of an order: 해 / 해줘 / 해 주세요 / 하자 / 줘 ...
const RESTART_GATE_KO = new RegExp(`^\\s*(?:(?:지금|좀|그냥|자|이제)\\s+)*(?:앱|어플|애플리케이션|프로그램)(?:을|를)?\\s*(?:좀\\s*)?(?:재시작|다시\\s*시작|재실행|다시\\s*실행|리스타트|재부팅)\\s*${KO_DO}[\\s.!?]*$`);
/** "Restart the app" / "앱 재시작해", and nothing else: the exact order, carried out at once. */
export const restartAsked = (full: string): boolean => (full.split(/\s+/).length <= 8 && RESTART_GATE.test(full)) || RESTART_GATE_KO.test(full.trim());
/** "Can you restart the app now?" / "앱 껐다 켜 줄래?": the words of a restart and of the app are there, not the exact shape. Jev (or the
 * voice model, and then a question) decides whether a restart of this app is meant; never the rule alone. */
export const restartMaybeAsked = (full: string): boolean => full.split(/\s+/).length <= 14 && (
  (/\b(restart|relaunch|reload|reboot)\b/i.test(full) && /\b(app|application|program|yourself)\b/i.test(full))
  || (/재시작|다시\s*시작|재실행|다시\s*실행|리스타트|재부팅|껐다\s*켜/.test(full) && /앱|어플|애플리케이션|프로그램/.test(full)));

const RELOAD_GATE = /^\W*(?:(?:ok(?:ay)?|hey|please|now|and|so|then)\W+)*(?:can you\W+|could you\W+|please\W+)?(?:(?:reload|refresh|soft[- ]restart|soft[- ]reload)\W+(?:the\W+|this\W+)?(?:ui|interface|window|frontend|front end|view|screen)|soft\W+restart|soft\W+reload)\b(?:\W+(?:please|now))?[^a-z]*$/i;
const RELOAD_GATE_KO = new RegExp(`^\\s*(?:(?:지금|좀|그냥)\\s+)*(?:인터페이스|화면|창|UI|유아이)(?:을|를)?\\s*(?:좀\\s*)?(?:새로\\s*고침|리로드|다시\\s*불러와|다시\\s*로드)\\s*${KO_DO}[\\s.!?]*$`, 'i');
/** "Reload the interface" / "soft restart" / "인터페이스 새로고침해줘": the window alone, the running turns untouched. One sentence. */
export const reloadAsked = (sentence: string): boolean => {
  const x = sentence.replace(/^\W*(?:(?:yeah|yes|okay|ok|and|so|obviously|now|then|also|please|just)\b\W*)+/i, '');
  return (x.split(/\s+/).length <= 10 && RELOAD_GATE.test(x)) || RELOAD_GATE_KO.test(sentence.trim());
};
