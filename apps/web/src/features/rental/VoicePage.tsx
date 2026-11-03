import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AgentTaskDetailSchema,
  ExtractNeedResultSchema,
  RequestViewSchema,
  TaskAcceptedDataSchema,
  createEmptyNeed,
  formatSeoulDateTime,
  formatKrw,
  type RequestView,
  type VoiceStatus,
  type VoiceCompletion,
} from '@sb/contracts';
import { ActionScope, api, idPath } from '../../lib/api.js';
import { useAction, useOnline, usePlaces } from '../../lib/hooks.js';
import { useSync } from '../../lib/session.js';
import { VoiceClient, type TranscriptLine } from '../../lib/voice.js';
import { ActionButton, ErrorNotice, Loading } from '../../components/ui.js';

const voiceLabels: Record<VoiceStatus, string> = {
  IDLE: '통화로 신청서를 작성해요',
  CONNECTING: '음성 연결 중',
  LISTENING: '듣고 있어요',
  SPEAKING: '답하고 있어요',
  RECONNECT_REQUIRED: '다시 연결해 주세요',
  CLOSED: '통화가 종료됐어요',
  ERROR: '음성 연결 확인 필요',
};
export function VoicePage() {
  const navigate = useNavigate();
  const query = useQueryClient();
  const sync = useSync();
  const online = useOnline();
  const places = usePlaces();
  const transcriptBox = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>('IDLE');
  const [voiceError, setVoiceError] = useState('');
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [request, setRequest] = useState<RequestView | null>(null);
  const requestRef = useRef<RequestView | null>(null);
  const creating = useRef<Promise<RequestView> | null>(null);
  const createScope = useRef(new ActionScope());
  const [voiceTask, setVoiceTask] = useState<string | null>(null);
  const [textTask, setTextTask] = useState<string | null>(null);
  const action = useAction();
  const composing = useRef(false);
  const finishRef = useRef<(completion: VoiceCompletion) => void>(() => {});
  const voice = useRef<VoiceClient | null>(null);
  if (!voice.current)
    voice.current = new VoiceClient(
      setStatus,
      (role, delta) =>
        setTranscript((lines) => {
          const last = lines.at(-1);
          return last?.role === role
            ? [...lines.slice(0, -1), { role, text: last.text + delta }]
            : [...lines, { role, text: delta }];
        }),
      setVoiceError,
      setVoiceTask,
      (completion) => finishRef.current(completion),
    );
  useEffect(() => {
    const end = () => {
      void voice.current?.stop();
      setTranscript([]);
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        end();
        setStatus('RECONNECT_REQUIRED');
      }
    };
    window.addEventListener('sb:session-end', end);
    window.addEventListener('pagehide', end);
    document.addEventListener('visibilitychange', hide);
    return () => {
      end();
      window.removeEventListener('sb:session-end', end);
      window.removeEventListener('pagehide', end);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useLayoutEffect(() => {
    const box = transcriptBox.current;
    if (!box) return;
    if (followLatest.current) box.scrollTop = box.scrollHeight;
    else setHasNewMessages(true);
  }, [transcript]);
  const ensureRequest = async () => {
    if (requestRef.current) return requestRef.current;
    creating.current ??= api.execute(
      createScope.current.command('/requests', 'POST', { need: createEmptyNeed() }),
      RequestViewSchema,
    );
    try {
      const view = await creating.current;
      requestRef.current = view;
      setRequest(view);
      query.setQueryData(['request', view.request.id], view);
      return view;
    } finally {
      creating.current = null;
    }
  };
  // agent-turns accepts ROUTE_INTENT. Its EXTRACT_NEED child carries the same turnId.
  // Follow that child so a route result (or an older turn's proposal) is never shown as a need.
  const textInput = sync.data?.tasks.find((task) => task.id === textTask)?.inputVersion;
  const latestExtraction = sync.data?.tasks
    .filter(
      (task) =>
        task.requestId === request?.request.id &&
        task.kind === 'EXTRACT_NEED' &&
        (!textTask ||
          (textInput &&
            'turnId' in textInput &&
            'turnId' in task.inputVersion &&
            task.inputVersion.turnId === textInput.turnId)),
    )
    .at(-1)?.id;
  const taskId = textTask ? (latestExtraction ?? textTask) : voiceTask;
  const task = useQuery({
    queryKey: ['task', taskId],
    enabled: !!taskId,
    queryFn: ({ signal }) => api.get(`/tasks/${idPath(taskId!)}`, AgentTaskDetailSchema, signal),
    refetchInterval: (q) =>
      ['QUEUED', 'RUNNING'].includes(q.state.data?.status ?? 'QUEUED') ? 1500 : false,
  });
  const extraction = ExtractNeedResultSchema.safeParse(task.data?.result);
  const proposal = extraction.success && task.data?.status === 'SUCCEEDED' ? extraction.data : null;
  const finish = (completion?: VoiceCompletion) =>
    action.run(async () => {
      const view = await ensureRequest();
      setFinishing(true);
      try {
        await voice.current!.finish(completion?.requestVersion ?? view.request.version, completion);
        await query.invalidateQueries({ queryKey: ['sync'] });
        navigate('/inbox?role=REQUESTER');
      } finally {
        setFinishing(false);
      }
    });
  finishRef.current = finish;
  const form = proposal?.proposedNeed ?? request?.request.need ?? createEmptyNeed();
  const formRows = [
    ['필요한 물품', form.queryText || '어떤 물품이 필요하세요?'],
    ['빌리는 날', form.startAt ? formatSeoulDateTime(form.startAt) : '날짜와 시간 확인 중'],
    ['돌려주는 날', form.endAt ? formatSeoulDateTime(form.endAt) : '날짜와 시간 확인 중'],
    [
      '만남 장소',
      form.preferredPlaceIds
        .map((id) => places.data?.items.find((place) => place.id === id)?.label ?? '')
        .filter(Boolean)
        .join(' · ') || '장소 확인 중',
    ],
    ['최대 예산 · 선택', form.maxBudgetKrw ? formatKrw(form.maxBudgetKrw) : '지정하지 않았어요'],
  ];
  const active = ['CONNECTING', 'LISTENING', 'SPEAKING'].includes(status);
  const review = () =>
    action.run(async () => {
      const view = await ensureRequest();
      await voice.current?.stop();
      navigate(`/requests/${view.request.id}/edit`, {
        state: proposal ? { proposal, inputVersion: task.data?.inputVersion } : null,
      });
    });
  const thinking =
    task.data?.status === 'QUEUED' ||
    task.data?.status === 'RUNNING' ||
    (task.data?.kind === 'ROUTE_INTENT' &&
      task.data.status === 'SUCCEEDED' &&
      task.data.result &&
      'intent' in task.data.result &&
      ['RENTAL_REQUEST', 'UNCLEAR'].includes(String(task.data.result.intent)));
  return (
    <section className="voice-page" aria-labelledby="voice-title">
      <header className="call-heading">
        <div className="call-avatar" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <p className="eyebrow">성북 공유대여 상담 도우미</p>
          <h1 id="voice-title">편하게 말씀해 주세요</h1>
          <p role="status">{voiceLabels[status]}</p>
        </div>
      </header>
      <p className="call-intro">
        함께 신청서를 채워요. 필수 정보가 모이면 종료 안내 후 통화가 자동으로 끝나고 물품을
        조회해요.
      </p>
      <div
        className="transcript call-chat"
        ref={transcriptBox}
        role="log"
        aria-label="대화 자막"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={() => {
          const box = transcriptBox.current;
          if (box) {
            followLatest.current = box.scrollHeight - box.scrollTop - box.clientHeight < 64;
            if (followLatest.current) setHasNewMessages(false);
          }
        }}
      >
        {!transcript.length && (
          <div className="call-empty">
            <span aria-hidden="true">···</span>
            <p>통화를 시작하면 도우미가 먼저 인사해요.</p>
            <small>물품부터 알려 주세요. 나머지는 하나씩 여쭤볼게요.</small>
          </div>
        )}
        {transcript.map((line, i) => (
          <div key={i} className={`chat-message ${line.role}`}>
            <strong>{line.role === 'user' ? '나' : '상담 도우미'}</strong>
            <p>{line.text}</p>
          </div>
        ))}
      </div>
      {hasNewMessages && (
        <ActionButton
          secondary
          onPress={() => {
            followLatest.current = true;
            if (transcriptBox.current)
              transcriptBox.current.scrollTop = transcriptBox.current.scrollHeight;
            setHasNewMessages(false);
          }}
        >
          새 대화 보기 ↓
        </ActionButton>
      )}
      {!active && !finishing && (
        <ActionButton
          onPress={() => {
            setVoiceError('');
            setMuted(false);
            setTextTask(null);
            setVoiceTask(null);
            setTranscript([]);
            followLatest.current = true;
            void voice.current?.start(async () => (await ensureRequest()).request.id);
          }}
          isDisabled={!online || active || finishing || action.pending}
        >
          ☎ {status === 'RECONNECT_REQUIRED' ? '다시 통화하기' : '통화 시작'}
        </ActionButton>
      )}
      <div className="voice-controls">
        <ActionButton
          secondary
          onPress={() => {
            voice.current?.mute(!muted);
            setMuted(!muted);
          }}
          isDisabled={!active || finishing}
          aria-pressed={muted}
        >
          {muted ? '음소거 해제' : '음소거'}
        </ActionButton>
        <ActionButton
          secondary
          onPress={() => finish()}
          isDisabled={!online || finishing || action.pending || (!active && !action.error)}
        >
          {finishing ? '종료 후 조회 접수 중…' : '통화 종료·조회'}
        </ActionButton>
        <ActionButton
          secondary
          onPress={() => {
            void voice.current?.stop();
            setTextMode(true);
          }}
        >
          텍스트로 입력
        </ActionButton>
      </div>
      <section className="call-form content-card" aria-labelledby="call-form-title">
        <div className="card-topline">
          <h2 id="call-form-title">대여 신청서</h2>
          <span className="demo-badge">{thinking ? '작성 중' : '통화 중 수집'}</span>
        </div>
        <dl>
          {formRows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="field-hint">
          통화 중에는 정보를 수집해요. 실제 결제와 예약이 이루어지지 않습니다.
        </p>
      </section>
      {voiceError && (
        <div className="error-notice" role="alert">
          <p>{voiceError}</p>
          {voiceError.includes('재생') && (
            <ActionButton secondary onPress={() => voice.current?.play()}>
              오디오 재생
            </ActionButton>
          )}
        </div>
      )}
      {textMode && (
        <form
          className="content-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (composing.current || !text.trim()) return;
            action.run(async (scope) => {
              const view = await ensureRequest();
              const latest = await api.get(
                `/requests/${idPath(view.request.id)}`,
                RequestViewSchema,
              );
              const accepted = await api.execute(
                scope.command('/agent-turns', 'POST', {
                  requestId: latest.request.id,
                  expectedRequestVersion: latest.request.version,
                  text: text.trim(),
                }),
                TaskAcceptedDataSchema,
              );
              setTextTask(accepted.taskId);
            });
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current))
              event.preventDefault();
          }}
        >
          <label>
            필요한 물품과 사용 계획
            <textarea
              disabled={action.pending || action.canRetry}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="예: 다음 주에 프로젝터가 필요해요. 센터 앞에서 만날 수 있어요."
            />
          </label>
          <ActionButton
            type="submit"
            isDisabled={action.pending || action.canRetry || thinking || !online || !text.trim()}
          >
            신청서 채우기
          </ActionButton>
        </form>
      )}
      <ErrorNotice action={action} />
      <ErrorNotice error={task.error} />
      {thinking && <Loading>말씀하신 조건을 정리하고 있어요.</Loading>}
      {task.data?.status === 'FAILED' && (
        <p className="error-notice" role="alert">
          조건을 정리하지 못했어요. 다시 입력하거나 직접 작성해 주세요.
        </p>
      )}
      {proposal?.clarificationQuestion && (
        <p className="field-hint">{proposal.clarificationQuestion}</p>
      )}
      {textMode && proposal && (
        <ActionButton onPress={review} isDisabled={action.pending || !online}>
          신청서 확인·수정
        </ActionButton>
      )}
      <ActionButton secondary onPress={review} isDisabled={action.pending || !online}>
        직접 조건 작성하기
      </ActionButton>
      <p className="field-hint">
        필수 정보 수집 후 자동 종료하거나 통화 종료·조회를 눌러 조회해요. 정보가 부족하면 요청함에서
        이어서 작성할 수 있어요.
      </p>
      <Link to="/">홈으로</Link>
    </section>
  );
}
