// 3번 거점 인계·반납 화면. 명세: docs/specs/0007-hub-handover-return.md
// 예약 화면의 인계 카드(QR·진행)와 거점 관리자 화면(/hub). QR은 OS 카메라가 /hub?code=… 를 연다.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { encode } from 'uqr';
import {
  HUB_MANAGER_ID,
  HandoverCodeSchema,
  HandoverViewSchema,
  IMAGE_CONTENT_TYPES,
  UploadedImageSchema,
  type Handover,
  type HandoverView,
  type ReservationView,
} from '@sb/contracts';
import { api, formatSeoulDateTime, idPath, type ActionScope } from '../../lib/api.js';
import { useAction, useOnline } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { shrink } from '../../lib/photo.js';
import { ActionButton, ErrorNotice, Loading } from '../../components/ui.js';
import './reservation.css';

const STEPS: { stage: Handover['stage']; label: string }[] = [
  { stage: 'READY', label: '인계 대기' },
  { stage: 'PICKED_UP', label: '대여 중' },
  { stage: 'RETURNED', label: '반납 확인 중' },
  { stage: 'COMPLETED', label: '반납 완료' },
];
const stepIndex = (stage: Handover['stage']) => STEPS.findIndex((s) => s.stage === stage);

function QrCode({ text }: { text: string }) {
  const qr = useMemo(() => encode(text, { border: 2 }), [text]);
  return (
    <svg
      className="handover-qr"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="인계 QR 코드"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path
        fill="#000"
        d={qr.data
          .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
          .join('')}
      />
    </svg>
  );
}

function Steps({ stage }: { stage: Handover['stage'] }) {
  const current = stepIndex(stage);
  return (
    <ol className="handover-steps">
      {STEPS.map((s, i) => (
        <li
          key={s.stage}
          className={i < current ? 'done' : i === current ? 'current' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/** 대여 전·반납 사진, AI 비교 후보, 관리자 판정. */
function HandoverRecord({ handover }: { handover: Handover }) {
  const { comparison, inspection } = handover;
  return (
    <>
      {(handover.pickupPhotoId || handover.returnPhotoId) && (
        <div className="handover-photos">
          {handover.pickupPhotoId && (
            <figure>
              <img src={`/api/v1/images/${handover.pickupPhotoId}`} alt="대여 전 사진" />
              <figcaption>
                대여 전{handover.pickedUpAt ? ` · ${formatSeoulDateTime(handover.pickedUpAt)}` : ''}
              </figcaption>
            </figure>
          )}
          {handover.returnPhotoId && (
            <figure>
              <img src={`/api/v1/images/${handover.returnPhotoId}`} alt="반납 사진" />
              <figcaption>
                반납{handover.returnedAt ? ` · ${formatSeoulDateTime(handover.returnedAt)}` : ''}
              </figcaption>
            </figure>
          )}
        </div>
      )}
      {comparison && (
        <div className="handover-compare" role="note">
          <strong>AI 사진 비교 · 판정이 아닌 후보예요</strong>
          {comparison.status === 'FAILED' ? (
            <p>사진 비교를 하지 못했어요. 관리자가 사진을 직접 비교해 주세요.</p>
          ) : (
            <>
              {comparison.summary && <p>{comparison.summary}</p>}
              {comparison.differences.length > 0 && (
                <ul>
                  {comparison.differences.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {inspection && (
        <p
          className={inspection.result === 'OK' ? 'handover-result ok' : 'handover-result damaged'}
        >
          관리자 판정 ·{' '}
          {inspection.result === 'OK' ? '문제 없음' : `파손 있음 — ${inspection.note}`}
        </p>
      )}
    </>
  );
}

/** 예약 상세 화면의 인계 카드. 빌리는 사람에게만 QR을 보여준다. */
export function HandoverCard({ view, placeLabel }: { view: ReservationView; placeLabel?: string }) {
  const r = view.reservation;
  const handover = r.handover;
  if (r.status !== 'CONFIRMED' || !handover) return null;
  const owner = view.role === 'OWNER';
  return (
    <div className="content-card handover-card">
      <h2>거점 인계·반납</h2>
      <Steps stage={handover.stage} />
      {handover.stage === 'READY' &&
        (owner ? (
          <p className="field-hint">빌리는 이웃이 거점에서 물건을 받으면 알려드려요.</p>
        ) : (
          handover.code && (
            <div className="handover-qr-box">
              <QrCode text={`${window.location.origin}/hub?code=${handover.code}`} />
              <p className="handover-code" aria-label={`인계 코드 ${handover.code}`}>
                {handover.code.slice(0, 4)} {handover.code.slice(4)}
              </p>
              <p className="field-hint">
                {placeLabel ?? '만남 장소'}에서 거점 관리자에게 이 QR을 보여 주세요. 관리자가 대여
                전 사진을 찍고 물건을 건네드려요.
              </p>
            </div>
          )
        ))}
      {handover.stage === 'PICKED_UP' && !owner && (
        <p className="field-hint">
          {formatSeoulDateTime(r.endAt)}까지 같은 거점에 반납해 주세요. 반납할 때도 이 화면의 QR을
          보여 주세요.
        </p>
      )}
      {handover.stage === 'PICKED_UP' && !owner && handover.code && (
        <div className="handover-qr-box">
          <QrCode text={`${window.location.origin}/hub?code=${handover.code}`} />
        </div>
      )}
      <HandoverRecord handover={handover} />
    </div>
  );
}

function PhotoPicker({
  label,
  file,
  onChange,
  disabled,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return (
    <label className="handover-picker">
      {label}
      <input
        type="file"
        accept={IMAGE_CONTENT_TYPES.join(',')}
        capture="environment"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        disabled={disabled}
      />
      {preview && <img src={preview} alt="찍은 사진 미리보기" />}
    </label>
  );
}

async function upload(scope: ActionScope, file: File) {
  return api.execute(scope.command('/images', 'POST', await shrink(file)), UploadedImageSchema);
}

function HubActions({ view, code }: { view: HandoverView; code: string }) {
  const queryClient = useQueryClient();
  const action = useAction();
  const online = useOnline();
  const [file, setFile] = useState<File | null>(null);
  const [damaged, setDamaged] = useState(false);
  const [note, setNote] = useState('');
  const r = view.reservation;
  const stage = r.handover!.stage;
  const busy = action.pending || action.canRetry || !online;
  const send = (path: string, body: (scope: ActionScope) => Promise<object>) =>
    action.run(async (scope) => {
      const updated = await api.execute(
        scope.command(`/handovers/${idPath(code)}/${path}`, 'POST', {
          expectedVersion: r.version,
          ...(await body(scope)),
        }),
        HandoverViewSchema,
      );
      setFile(null);
      queryClient.setQueryData(['handover', code], updated);
    });
  if (r.status !== 'CONFIRMED')
    return <p className="field-hint">확정 상태가 아닌 예약이라 인계할 수 없어요.</p>;
  return (
    <div className="page-section">
      {stage === 'READY' && (
        <>
          <PhotoPicker label="대여 전 사진 찍기" file={file} onChange={setFile} disabled={busy} />
          <ActionButton
            isDisabled={!file || busy}
            onPress={() => send('pickup', async (s) => ({ photoId: (await upload(s, file!)).id }))}
          >
            {action.pending ? '저장하는 중…' : '사진 저장하고 인계하기'}
          </ActionButton>
        </>
      )}
      {stage === 'PICKED_UP' && (
        <>
          <PhotoPicker label="반납 사진 찍기" file={file} onChange={setFile} disabled={busy} />
          <p className="field-hint">대여 전 사진과 같은 방향에서 찍으면 비교가 정확해져요.</p>
          <ActionButton
            isDisabled={!file || busy}
            onPress={() => send('return', async (s) => ({ photoId: (await upload(s, file!)).id }))}
          >
            {action.pending ? 'AI가 사진을 비교하는 중…' : '반납 사진으로 비교하기'}
          </ActionButton>
        </>
      )}
      {stage === 'RETURNED' && (
        <>
          <p className="field-hint">AI 후보를 참고해 물건을 직접 확인하고 판정해 주세요.</p>
          {!damaged ? (
            <div className="handover-decide">
              <ActionButton
                isDisabled={busy}
                onPress={() => send('inspect', async () => ({ result: 'OK' }))}
              >
                문제 없음
              </ActionButton>
              <ActionButton secondary isDisabled={busy} onPress={() => setDamaged(true)}>
                파손 있음
              </ActionButton>
            </div>
          ) : (
            <>
              <label>
                파손 내용
                <textarea
                  value={note}
                  maxLength={300}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="예: 손잡이 아래쪽 긁힘, 작동은 정상"
                />
              </label>
              <ActionButton
                isDisabled={!note.trim() || busy}
                onPress={() =>
                  send('inspect', async () => ({ result: 'DAMAGED', note: note.trim() }))
                }
              >
                파손으로 판정하기
              </ActionButton>
              <ActionButton secondary isDisabled={busy} onPress={() => setDamaged(false)}>
                돌아가기
              </ActionButton>
            </>
          )}
        </>
      )}
      {stage === 'COMPLETED' && <p className="field-hint">이 예약의 반납 확인이 끝났어요.</p>}
      <ErrorNotice action={action} />
    </div>
  );
}

/** 거점 관리자 화면: QR(또는 코드 입력)로 예약을 찾아 인계·반납을 기록한다. */
export function HubPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const parsed = HandoverCodeSchema.safeParse(params.get('code') ?? '');
  const code = parsed.success ? parsed.data : null;
  const [input, setInput] = useState('');
  const manager = session?.user.id === HUB_MANAGER_ID;
  const query = useQuery({
    queryKey: ['handover', code],
    enabled: manager && !!code,
    queryFn: ({ signal }) => api.get(`/handovers/${idPath(code!)}`, HandoverViewSchema, signal),
  });
  if (!manager)
    return (
      <section>
        <p className="eyebrow">거점 관리</p>
        <h1>거점 관리자 화면이에요.</h1>
        <p className="lead">거점 관리자 아이디(demo-hub)로 들어와 QR을 다시 찍어 주세요.</p>
      </section>
    );
  const view = query.data;
  const r = view?.reservation;
  return (
    <section>
      <p className="eyebrow">거점 관리 · 인계·반납</p>
      <h1>{code ? '인계 코드를 확인했어요.' : 'QR을 찍거나\n코드를 입력해 주세요.'}</h1>
      <form
        className="handover-code-form"
        onSubmit={(e) => {
          e.preventDefault();
          const next = HandoverCodeSchema.safeParse(input.replace(/\s/g, ''));
          if (next.success) setParams({ code: next.data });
        }}
      >
        <label>
          인계 코드 8자리
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD 2345"
          />
        </label>
        <ActionButton type="submit" secondary isDisabled={!input.trim()}>
          찾기
        </ActionButton>
      </form>
      {code &&
        (query.isPending ? (
          <Loading />
        ) : !view || !r ? (
          <ErrorNotice error={query.error} />
        ) : (
          <>
            <div className="content-card">
              <div className="item-header">
                <img src={r.item.image.url} alt={r.item.image.alt} width="92" height="80" />
                <div>
                  <span className="source-label">
                    {r.source === 'PUBLIC'
                      ? '공공 · 센터 데모'
                      : `이웃 · ${view.ownerDisplayName ?? '주민'}`}
                  </span>
                  <h2>{r.item.title}</h2>
                </div>
              </div>
              <dl className="terms">
                <div>
                  <dt>빌리는 이웃</dt>
                  <dd>{view.requesterDisplayName}</dd>
                </div>
                <div>
                  <dt>기간</dt>
                  <dd>
                    {formatSeoulDateTime(r.startAt)} ~ {formatSeoulDateTime(r.endAt)}
                  </dd>
                </div>
                <div>
                  <dt>거점</dt>
                  <dd>{view.placeLabel}</dd>
                </div>
              </dl>
              {r.handover && (
                <>
                  <Steps stage={r.handover.stage} />
                  <HandoverRecord handover={r.handover} />
                </>
              )}
            </div>
            <HubActions view={view} code={code} />
          </>
        ))}
      <p className="demo-notice">시연용 거점이에요. 실제 캠퍼스 거점 운영과 연동되지 않아요.</p>
    </section>
  );
}
