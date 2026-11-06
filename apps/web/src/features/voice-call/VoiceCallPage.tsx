// 음성 접수 통화 화면. 명세: docs/specs/0003-voice-call-reservation.md
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AgentTaskDetailSchema,
  ExtractNeedResultSchema,
  INTAKE_APPROVAL_TERMINAL,
  IntakeApprovalSchema,
  RequestViewSchema,
  createEmptyNeed,
  pickRandomPolicy,
  type CenterPolicyId,
  type ExtractNeedResult,
  type IntakeApproval,
  type RequestView,
  type VoiceStatus,
} from '@sb/contracts';
import { ActionScope, api, idPath, serverClock } from '../../lib/api.js';
import { useOnline, usePlaces } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { ActionButton } from '../../components/ui.js';
import { CallCharacter } from './CallCharacter.js';
import { VoiceCallClient, type CallSnapshot } from './call-client.js';
import { deriveCharacterState, type ApprovalPhase } from './character.js';
import {
  RENTAL_POLICY,
  buildChecklist,
  checklistProgress,
  readyForApproval,
  type ChecklistItem,
} from './checklist.js';
import { buildDemoScript } from './demo-script.js';
import { reservationOutbox } from './reservation-outbox.js';
import { PolicyCards } from './PolicyCards.js';
import {
  policyUtterances,
  selectPolicyCards,
  usePolicyMatch,
  type PolicyCardSelection,
} from './policy-match.js';
import mascotAvatar from './assets/mascot-avatar.webp';
import './voice-call.css';

interface Line {
  role: 'user' | 'assistant';
  text: string;
}
const reservationLabels: Record<IntakeApproval['status'], string> = {
  QUEUED: '예약 신청을 준비하고 있어요',
  SEARCHING: '빌릴 수 있는 물품을 찾고 있어요',
  RETRYING: '예약 신청을 다시 시도하고 있어요',
  SUBMITTED: '예약 신청을 보냈어요',
  NO_MATCH: '지금 빌릴 수 있는 물품이 없어요',
  CLOSED: '신청이 종료됐어요',
  // 명세 0004: 계속 실패하면 재시도를 멈추고 알림으로 안내한다.
  FAILED: '예약 신청을 마치지 못했어요. 요청함에서 직접 진행해 주세요',
};
// The dialing screen stays this long while the real connection starts underneath, then gives way to
// the call screen; errors and closes end it sooner.
const RING_MS = 2_000;

export function VoiceCallPage() {
  const [params] = useSearchParams();
  const scripted = params.get('demo') === 'script';
  const query = useQueryClient();
  const online = useOnline();
  const places = usePlaces();
  const { session } = useSession();
  const eligible = session?.user.demoEligible ?? false;

  const [status, setStatus] = useState<VoiceStatus>('IDLE');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null);
  const [proposal, setProposal] = useState<{ taskId: string; result: ExtractNeedResult } | null>(
    null,
  );
  const [scriptThinking, setScriptThinking] = useState(false);
  const [phase, setPhase] = useState<ApprovalPhase>('collecting');
  const [dismissedTaskId, setDismissedTaskId] = useState<string | null>(null);
  const [reservation, setReservation] = useState<IntakeApproval | null>(null);
  // 명세 0004: 백그라운드 재전송을 멈춘 경우(재시도할 수 없는 응답·횟수 상한).
  const [outboxFailed, setOutboxFailed] = useState(false);
  const [request, setRequest] = useState<RequestView | null>(null);
  const requestRef = useRef<RequestView | null>(null);
  const creating = useRef<Promise<RequestView> | null>(null);
  const createScope = useRef(new ActionScope());
  const scriptTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [dialing, setDialing] = useState(false);
  const ring = useRef({ timers: [] as ReturnType<typeof setTimeout>[], connecting: false });
  // 명세 0005: 상황을 말하지 않았거나 맞는 정책이 없을 때 안내할 정책. 통화마다 한 번 고른다.
  const [randomPolicy, setRandomPolicy] = useState<CenterPolicyId>(() => pickRandomPolicy());

  const client = useRef<VoiceCallClient | null>(null);
  client.current ??= new VoiceCallClient({
    status: setStatus,
    transcript: (role, delta) =>
      setLines((previous) => {
        const last = previous.at(-1);
        return last?.role === role
          ? [...previous.slice(0, -1), { role, text: last.text + delta }]
          : [...previous, { role, text: delta }];
      }),
    error: setError,
    snapshot: setSnapshot,
  });

  const stopScript = () => {
    scriptTimers.current.forEach(clearTimeout);
    scriptTimers.current = [];
  };
  useEffect(() => {
    const end = () => {
      stopScript();
      void client.current?.stop();
    };
    const hide = () => {
      if (document.visibilityState === 'hidden' && !scripted) end();
    };
    const sessionEnd = () => {
      end();
      reservationOutbox.clear();
    };
    window.addEventListener('sb:session-end', sessionEnd);
    window.addEventListener('pagehide', end);
    document.addEventListener('visibilitychange', hide);
    return () => {
      end();
      window.removeEventListener('sb:session-end', sessionEnd);
      window.removeEventListener('pagehide', end);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [scripted]);

  const stopRinging = () => {
    ring.current.timers.forEach(clearTimeout);
    ring.current = { timers: [], connecting: false };
    setDialing(false);
  };
  useEffect(() => () => ring.current.timers.forEach(clearTimeout), []);
  // start() first reports CLOSED for the previous call, so a closing status only ends the dialing
  // screen once this call has reported CONNECTING.
  useEffect(() => {
    if (!dialing) return;
    if (status === 'CONNECTING') ring.current.connecting = true;
    else if (
      ring.current.connecting &&
      ['ERROR', 'RECONNECT_REQUIRED', 'CLOSED', 'IDLE'].includes(status)
    )
      stopRinging();
  }, [dialing, status]);

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

  // The server attaches each call utterance's extraction task; follow it until it settles.
  const taskId = snapshot?.taskId ?? null;
  const task = useQuery({
    queryKey: ['task', taskId],
    enabled: !!taskId && !scripted,
    queryFn: ({ signal }) => api.get(`/tasks/${idPath(taskId!)}`, AgentTaskDetailSchema, signal),
    refetchInterval: (q) =>
      ['QUEUED', 'RUNNING'].includes(q.state.data?.status ?? 'QUEUED') ? 1000 : false,
  });
  useEffect(() => {
    if (task.data?.status !== 'SUCCEEDED') return;
    const parsed = ExtractNeedResultSchema.safeParse(task.data.result);
    if (parsed.success) setProposal({ taskId: task.data.id, result: parsed.data });
  }, [task.data]);
  const thinking = scripted
    ? scriptThinking
    : task.data?.status === 'QUEUED' || task.data?.status === 'RUNNING';

  const need = proposal?.result.proposedNeed ?? request?.request.need ?? createEmptyNeed();
  const checklist = useMemo(
    () => buildChecklist(need, places.data?.items ?? [], eligible),
    [need, places.data, eligible],
  );
  const progress = checklistProgress(checklist);
  const active = ['CONNECTING', 'LISTENING', 'SPEAKING'].includes(status);
  const complete = readyForApproval(proposal?.result ?? null, eligible, serverClock.now());
  // 명세 0005: 통화 중 발화로 관련 정책을 백그라운드에서 찾는다(통화 화면에는 표시하지 않음).
  const utterances = useMemo(() => policyUtterances(lines), [lines]);
  const policyMatch = usePolicyMatch(utterances, scripted);

  // Collection complete → hide the checklist, lift the character and raise the approval sheet.
  useEffect(() => {
    if (phase === 'collecting' && complete && active && proposal?.taskId !== dismissedTaskId)
      setPhase('review');
    if (phase === 'review' && !complete) setPhase('collecting');
  }, [phase, complete, active, proposal?.taskId, dismissedTaskId]);

  // Background retries report back here while the page is open.
  useEffect(
    () =>
      reservationOutbox.subscribe((requestId, result, _error, final) => {
        if (requestId !== requestRef.current?.request.id) return;
        if (result) {
          setReservation(result);
          setPhase('done');
        } else if (final) setOutboxFailed(true);
      }),
    [],
  );
  const followed = useQuery({
    queryKey: ['intake-approval', reservation?.id],
    enabled: !!reservation && !scripted,
    queryFn: ({ signal }) =>
      api.get(`/intake-approvals/${idPath(reservation!.id)}`, IntakeApprovalSchema, signal),
    refetchInterval: (q) =>
      INTAKE_APPROVAL_TERMINAL.includes(q.state.data?.status ?? 'QUEUED') ? false : 2000,
  });
  const reservationState = followed.data ?? reservation;

  const character = deriveCharacterState({
    voice: status,
    phase,
    thinking,
    userSpoke: scripted ? lines.some((l) => l.role === 'user') : !!snapshot?.userSpoke,
  });

  const reset = () => {
    setError('');
    setMuted(false);
    setLines([]);
    setSnapshot(null);
    setProposal(null);
    setPhase('collecting');
    setDismissedTaskId(null);
    setReservation(null);
    setRandomPolicy(pickRandomPolicy());
  };
  const startCall = () => {
    reset();
    ring.current.timers.forEach(clearTimeout);
    ring.current = {
      timers: [setTimeout(stopRinging, RING_MS)],
      connecting: false,
    };
    setDialing(true);
    if (scripted) {
      stopScript();
      const placeId = places.data?.items[0]?.id ?? 'place-center';
      for (const step of buildDemoScript(serverClock.now(), placeId))
        scriptTimers.current.push(
          setTimeout(
            () => {
              if (step.kind === 'status') setStatus(step.status);
              if (step.kind === 'line') setLines((previous) => [...previous, step]);
              if (step.kind === 'thinking') setScriptThinking(true);
              if (step.kind === 'proposal') {
                setScriptThinking(false);
                setProposal({ taskId: `task_demo_${step.at}`, result: step.result });
              }
            },
            // The scripted call reports CONNECTING at once; everything after waits for the ring.
            step.at === 0 ? 0 : step.at + RING_MS,
          ),
        );
      return;
    }
    void client.current?.start(async () => (await ensureRequest()).request.id);
  };
  const endCall = () => {
    stopRinging();
    stopScript();
    if (scripted) setStatus('CLOSED');
    void client.current?.stop();
  };

  const approve = async () => {
    if (!proposal || phase !== 'review') return;
    setPhase('reserving');
    setError('');
    client.current?.hold();
    if (scripted) {
      stopScript();
      await new Promise((resolve) => setTimeout(resolve, 1400));
      setStatus('CLOSED');
      setPhase('done');
      return;
    }
    const view = await ensureRequest();
    try {
      // The agent's reservation tool: the server runs the existing reservation contract.
      const result = await reservationOutbox.submit({
        requestId: view.request.id,
        extractionTaskId: proposal.taskId,
        voiceSessionId: client.current?.voiceSessionId ?? null,
      });
      setReservation(result);
      await client.current?.stop();
      setPhase('done');
    } catch {
      // End the call regardless; the outbox keeps retrying in the background.
      await client.current?.stop();
      setPhase('retrying');
    } finally {
      void query.invalidateQueries({ queryKey: ['sync'] });
    }
  };

  const sheetOpen = phase !== 'collecting';
  const latestAssistant = [...lines].reverse().find((line) => line.role === 'assistant');
  const latestUser = [...lines].reverse().find((line) => line.role === 'user');
  const nextItem = checklist.find((item) => !item.optional && !item.done);

  return (
    <section
      className="vc-screen"
      data-phase={phase}
      data-dialing={dialing || undefined}
      aria-labelledby="vc-title"
    >
      <header className="vc-topbar">
        <Link to="/" className="vc-back" aria-label="홈으로 나가기">
          ←
        </Link>
        <div>
          <h1 id="vc-title">물품대여 상담 통화</h1>
          <p>성북구 1인가구지원센터 · 공유대여</p>
        </div>
        <span className={active ? 'vc-live on' : 'vc-live'}>
          {dialing ? '연결 중' : active ? '통화 중' : '대기'}
        </span>
      </header>
      {scripted && <p className="vc-script-badge">시연 스크립트 · 실제 통화·예약 없음</p>}
      {dialing && (
        <div className="vc-dialing">
          <div className="vc-dialing-avatar" aria-hidden="true">
            <span className="vc-dialing-wave" />
            <span className="vc-dialing-wave" />
            <img src={mascotAvatar} alt="" width={176} height={176} />
          </div>
          <p className="vc-dialing-name">공유대여 상담 도우미</p>
          <p className="vc-dialing-text" role="status">
            전화를 연결하고 있어요
            <span className="vc-dialing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
          <ActionButton onPress={endCall}>통화 취소</ActionButton>
        </div>
      )}

      <div className="vc-stage">
        <CallCharacter state={character} progress={progress} />
        <ul className="vc-checklist" aria-label="접수에 필요한 정보" aria-hidden={sheetOpen}>
          {checklist.map((item) => (
            <ChecklistRow key={item.key} item={item} current={item === nextItem && active} />
          ))}
        </ul>
      </div>

      <div className="vc-captions" role="log" aria-live="polite" aria-label="통화 자막">
        {latestUser && (
          <p className="vc-caption user">
            <span>나</span>
            {latestUser.text}
          </p>
        )}
        {latestAssistant && (
          <p className="vc-caption assistant">
            <span>도우미</span>
            {latestAssistant.text}
          </p>
        )}
        {!lines.length && !active && phase === 'collecting' && (
          <p className="vc-caption hint">
            통화를 시작하면 도우미가 먼저 인사해요. 체크리스트가 모두 채워지면 신청 내용을 보여
            드려요.
          </p>
        )}
      </div>
      {error && (
        <div className="vc-error" role="alert">
          <p>{error}</p>
          {error.includes('재생') && (
            <ActionButton secondary onPress={() => client.current?.play()}>
              오디오 재생
            </ActionButton>
          )}
        </div>
      )}

      <div className="vc-controls">
        {!active && phase === 'collecting' ? (
          <>
            <ActionButton onPress={startCall} isDisabled={!online && !scripted}>
              ☎ {status === 'RECONNECT_REQUIRED' ? '다시 통화하기' : '통화 시작'}
            </ActionButton>
            {request && proposal && (
              <Link
                className="vc-text-link"
                to={`/requests/${request.request.id}/edit`}
                state={{ proposal: proposal.result, inputVersion: task.data?.inputVersion }}
              >
                신청서 직접 확인하기
              </Link>
            )}
            <Link className="vc-text-link" to="/rental/classic">
              텍스트로 입력하기
            </Link>
          </>
        ) : (
          active &&
          phase === 'collecting' && (
            <>
              <ActionButton
                secondary
                aria-pressed={muted}
                onPress={() => {
                  client.current?.mute(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? '음소거 해제' : '음소거'}
              </ActionButton>
              <ActionButton onPress={endCall}>통화 종료</ActionButton>
            </>
          )
        )}
      </div>

      <ApprovalSheet
        open={sheetOpen}
        phase={phase}
        checklist={checklist}
        reservation={reservationState}
        outboxFailed={outboxFailed}
        scripted={scripted}
        policies={selectPolicyCards(policyMatch, randomPolicy)}
        onApprove={() => void approve()}
        onEdit={() => {
          setDismissedTaskId(proposal?.taskId ?? null);
          setPhase('collecting');
        }}
      />
    </section>
  );
}

function ChecklistRow({ item, current }: { item: ChecklistItem; current: boolean }) {
  return (
    <li
      className="vc-check"
      data-done={item.done || undefined}
      data-optional={item.optional || undefined}
      data-current={current || undefined}
    >
      <span className="vc-check-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="m7 12.5 3.2 3.2L17 9" />
        </svg>
      </span>
      <span className="vc-check-text">
        <strong>
          {item.label}
          {item.optional && <em> · 선택</em>}
        </strong>
        <small>{item.done ? item.value : item.hint}</small>
      </span>
      <span className="vc-sr">{item.done ? '확인됨' : item.optional ? '선택 항목' : '필요'}</span>
    </li>
  );
}

function ApprovalSheet({
  open,
  phase,
  checklist,
  reservation,
  outboxFailed,
  scripted,
  policies,
  onApprove,
  onEdit,
}: {
  open: boolean;
  phase: ApprovalPhase;
  checklist: ChecklistItem[];
  reservation: IntakeApproval | null;
  outboxFailed: boolean;
  scripted: boolean;
  policies: PolicyCardSelection;
  onApprove: () => void;
  onEdit: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open, phase]);
  const rows = checklist.filter(
    (item) => item.key !== 'eligibility' && (item.done || !item.optional),
  );
  return (
    <section
      className="vc-sheet"
      data-open={open || undefined}
      aria-hidden={!open}
      inert={!open}
      aria-labelledby="vc-sheet-title"
    >
      <span className="vc-sheet-handle" aria-hidden="true" />
      {phase === 'review' && (
        <>
          <h2 id="vc-sheet-title" ref={heading} tabIndex={-1}>
            이렇게 예약 신청할까요?
          </h2>
          <p className="vc-sheet-lead">통화로 정리한 신청 내용이에요. 맞으면 최종 승인해 주세요.</p>
          <dl className="vc-summary">
            {rows.map((item) => (
              <div key={item.key}>
                <dt>{item.label}</dt>
                <dd>{item.value ?? '지정하지 않음'}</dd>
              </div>
            ))}
            <div>
              <dt>수령 안내</dt>
              <dd>{RENTAL_POLICY.pickup}</dd>
            </div>
          </dl>
          <ul className="vc-policy">
            {RENTAL_POLICY.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <ActionButton onPress={onApprove}>최종 승인하고 예약 신청</ActionButton>
          <button type="button" className="vc-sheet-secondary" onClick={onEdit}>
            내용을 고칠게요 · 통화 계속
          </button>
        </>
      )}
      {phase === 'reserving' && (
        <>
          <h2 id="vc-sheet-title" ref={heading} tabIndex={-1}>
            예약 신청을 보내고 있어요
          </h2>
          <p className="vc-sheet-lead">
            도우미가 예약 신청 도구를 실행하고 있어요. 끝나면 통화를 종료해요.
          </p>
          <div className="vc-progress" aria-hidden="true" />
        </>
      )}
      {phase === 'done' && (
        <>
          <h2 id="vc-sheet-title" ref={heading} tabIndex={-1}>
            {scripted
              ? '시연: 예약 신청이 접수됐어요'
              : reservation
                ? reservationLabels[reservation.status]
                : '예약 신청을 접수했어요'}
          </h2>
          <p className="vc-sheet-lead">
            통화를 종료했어요. 진행 상황과 담당자 응답은 요청함과 앱 알림에서 확인할 수 있어요.
          </p>
          {!scripted && (
            <Link className="button" to="/inbox?role=REQUESTER">
              요청함에서 확인하기
            </Link>
          )}
          <PolicyCards selection={policies} />
        </>
      )}
      {phase === 'retrying' && outboxFailed && (
        <>
          <h2 id="vc-sheet-title" ref={heading} tabIndex={-1}>
            예약 신청을 보내지 못했어요
          </h2>
          <p className="vc-sheet-lead">
            여러 번 다시 보냈지만 신청을 마치지 못했어요. 요청함에서 신청서를 확인하고 직접 진행해
            주세요.
          </p>
          <Link className="button" to="/inbox?role=REQUESTER">
            요청함에서 이어서 하기
          </Link>
        </>
      )}
      {phase === 'retrying' && !outboxFailed && (
        <>
          <h2 id="vc-sheet-title" ref={heading} tabIndex={-1}>
            통화를 종료하고 다시 시도하고 있어요
          </h2>
          <p className="vc-sheet-lead">
            예약 신청 연결이 불안정했어요. 승인한 내용으로 백그라운드에서 자동으로 다시 보내고
            있어요. 앱을 닫아도 다음에 열면 이어서 보내요.
          </p>
          <div className="vc-progress" aria-hidden="true" />
          <Link className="button secondary" to="/inbox?role=REQUESTER">
            요청함 보기
          </Link>
        </>
      )}
    </section>
  );
}
