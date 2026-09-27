// The voice's fixed lines (the ones no model words): an acknowledgment, what it does with words said during a turn, a pause, a
// goodbye, an order for the app and the app's question about one. Each is said in the language of what the user just said: Korean
// when it has Hangul in it, English otherwise (2026-09-27: every fixed line was English, whatever was said). The voice model's own
// lines already follow the language of the message (VOICE_PROMPT). Pure, checked in tests/lines.test.ts.
export type Lang = 'en' | 'ko';
/** The language to answer in: Korean when what was said has Hangul in it ("코덱스 에이전트 열어줘", "Codex 에이전트"), else English. */
export const langOf = (said: string): Lang => (/[가-힣]/.test(said) ? 'ko' : 'en');

type Lines = {
  ack: Record<'problem' | 'question' | 'thanks' | 'task' | 'other', string[]>;
  busy: Record<'task' | 'steer' | 'ask' | 'stop' | 'replace', string[]>;
  hold: string[];
  bye: Record<'night' | 'back' | 'bye', string[]>;
  restart: string; reload: string; stopped: string; restartQuestion: string;
  /** "Opening a new Codex agent named X in scratch." `what`: the kind, already in this language, or ''; `where`: the folder, or null for the open one. */
  newAgent: (what: string, name: string | undefined, where: string | null) => string;
  newAgentQuestion: (what: string, where: string | null) => string;
  /** The kinds as the voice says them: in Korean, so a Korean voice says them as a Korean speaker would. */
  kinds: Record<'claude' | 'codex' | 'zcode' | 'claw' | 'jev', string>;
};

export const LINES: Record<Lang, Lines> = {
  en: {
    ack: {
      problem: ['Oh, okay, let me check.', "That's strange, let me look.", 'Hmm, let me see what happened.', "That shouldn't happen, let me look."], // concern, never cheer
      question: ['Let me check.', 'Good question, one second.', 'Let me look at that.', 'One moment, checking.'],
      thanks: ['Happy to help.', 'Anytime.', 'Glad you like it.'],
      task: ['Okay, one second.', 'Sure, give me a moment.', 'Got it, one moment.', 'Sure, one moment.'],
      other: ['Okay, one second.', 'Mmm, let me think.', 'Sure, give me a moment.'], // never a single word: it sounds like a brush-off
    },
    busy: {
      task: ["Okay, I'll queue that up.", "Got it, I'll keep that for right after this."],
      steer: ['Okay, working on that now.', 'Got it, on it.', 'Sure, one moment.'],
      ask: ["Good question, I'll answer that too.", 'Let me look at that as well.'],
      stop: ["Okay, I'll take care of that right away, stopping now.", 'Okay, stopping now.'],
      replace: ['Okay, switching to that right away.', 'Got it, dropping this and switching now.'],
    },
    hold: ['Sure, take your time.', "Okay, I'm here.", 'Take your time.', 'Of course, no rush.'],
    bye: {
      night: ['Good night, sleep well.', 'Good night. I will be here when you are back.'],
      back: ["Sure, I'll be here. Talk later.", 'Okay, see you in a bit.'],
      bye: ['Bye for now.', 'Goodbye, talk soon.', 'See you later.'],
    },
    restart: 'Okay, restarting the app.', reload: 'Okay, reloading the interface.', stopped: 'Okay, stopped.',
    restartQuestion: 'Restart the app? It stops every turn that is running. Say yes to restart; anything else goes to the agent as you said it.',
    newAgent: (what, name, where) => `Opening a new ${what ? `${what} ` : ''}agent${name ? ` named ${name}` : ''} in ${where ?? 'this folder'}.`,
    newAgentQuestion: (what, where) => `Should I open a new ${what ? `${what} ` : ''}agent in ${where ?? 'this folder'}? Say yes to open it; anything else goes to the agent as you said it.`,
    kinds: { claude: 'Claude', codex: 'Codex', zcode: 'ZCode', claw: 'Claw', jev: 'Jev' },
  },
  ko: {
    ack: {
      problem: ['아, 그래요? 확인해 볼게요.', '이상하네요, 살펴볼게요.', '음, 무슨 일인지 볼게요.', '그러면 안 되는데, 한번 볼게요.'],
      question: ['확인해 볼게요.', '좋은 질문이에요, 잠시만요.', '한번 살펴볼게요.', '잠시만요, 확인하고 있어요.'],
      thanks: ['도움이 돼서 기뻐요.', '언제든지요.', '마음에 드셨다니 다행이에요.'],
      task: ['네, 잠시만요.', '알겠어요, 조금만 기다려 주세요.', '네, 금방 할게요.', '알겠어요, 잠시만요.'],
      other: ['네, 잠시만요.', '음, 생각해 볼게요.', '네, 조금만 기다려 주세요.'],
    },
    busy: {
      task: ['네, 대기열에 넣어 둘게요.', '알겠어요, 이 작업 끝나면 바로 할게요.'],
      steer: ['네, 지금 반영할게요.', '알겠어요, 바로 할게요.', '네, 잠시만요.'],
      ask: ['좋은 질문이에요, 그것도 답할게요.', '그것도 같이 볼게요.'],
      stop: ['네, 바로 처리할게요. 지금 멈출게요.', '네, 지금 멈출게요.'],
      replace: ['네, 그걸로 바로 바꿀게요.', '알겠어요, 이건 그만두고 바로 바꿀게요.'],
    },
    hold: ['네, 천천히 하세요.', '네, 여기 있을게요.', '천천히 하세요.', '그럼요, 서두르지 않으셔도 돼요.'],
    bye: {
      night: ['잘 자요, 푹 쉬세요.', '잘 자요. 돌아오시면 여기 있을게요.'],
      back: ['네, 여기 있을게요. 이따 얘기해요.', '네, 이따 봐요.'],
      bye: ['다음에 또 봐요.', '네, 또 얘기해요.', '그럼 이따 봐요.'],
    },
    restart: '네, 앱을 재시작할게요.', reload: '네, 인터페이스를 새로고침할게요.', stopped: '네, 멈췄어요.',
    restartQuestion: '앱을 재시작할까요? 실행 중인 모든 작업이 멈춰요. 재시작하려면 네라고 말해 주세요. 다른 말은 말씀하신 그대로 에이전트에게 보낼게요.',
    // particles: "에이전트를" and "폴더에" never change, so the folder and the name are never followed by a particle of their own
    newAgent: (what, name, where) => `${where ? `${where} 폴더에` : '이 폴더에'} 새 ${what ? `${what} ` : ''}에이전트를 열게요.${name ? ` 이름은 ${name}.` : ''}`,
    newAgentQuestion: (what, where) => `${where ? `${where} 폴더에` : '이 폴더에'} 새 ${what ? `${what} ` : ''}에이전트를 열까요? 열려면 네라고 말해 주세요. 다른 말은 말씀하신 그대로 에이전트에게 보낼게요.`,
    kinds: { claude: '클로드', codex: '코덱스', zcode: '제트코드', claw: '클로', jev: '제브' },
  },
};
/** The lines for what was just said. */
export const linesFor = (said: string): Lines => LINES[langOf(said)];
