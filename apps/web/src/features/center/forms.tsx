import { useState } from 'react';
import { Button, Input, Label, TextArea, TextField } from 'react-aria-components';
import { formatCenterDate, type CenterRecord } from './content.js';
import { DemoNotice, Sheet } from './shared.js';

export type PreviewKind = 'program' | 'leader' | 'member' | 'report';
const definitions = {
  program: {
    title: '프로그램 신청 양식',
    action: '신청 미리보기',
    fields: [
      ['alias', '예시 별명', '이웃'],
      ['reason', '참여하고 싶은 이유', '새로운 일상을 함께 만들어 보고 싶어요.'],
    ],
  },
  leader: {
    title: '리더 참여 양식',
    action: '신청 미리보기',
    fields: [
      ['club', '예시 동아리 이름', '천천히, 동네 한 바퀴'],
      ['theme', '모임 주제', '동네 산책'],
      ['plan', '활동 계획', '한 달에 두 번, 가까운 산책길에서 만나요.'],
      ['members', '예상 인원 (예시)', '4명'],
    ],
  },
  member: {
    title: '팀원 참여 양식',
    action: '신청 미리보기',
    fields: [
      ['alias', '예시 별명', '이웃'],
      ['interest', '함께하고 싶은 활동', '동네 산책과 이야기 나누기'],
      ['reason', '참여하고 싶은 이유', '가까운 곳에서 함께할 이웃을 만나고 싶어요.'],
    ],
  },
  report: {
    title: '활동보고 양식',
    action: '활동보고 미리보기',
    fields: [
      ['activity', '활동 이름', '초록을 나눈 하루'],
      ['date', '활동일 (예시)', '2026. 11. 7.'],
      ['members', '참여 인원 (예시)', '4명'],
      ['description', '활동 내용', '각자 기르는 식물을 소개하고 돌보는 방법을 나눴어요.'],
      ['reflection', '활동 소감', '함께 배우니 더 즐거웠어요.'],
    ],
  },
} as const;

/** Each sheet owns its short-lived draft; there is no submission or persistence. */
export function FormPreview({
  item,
  kind,
  onClose,
}: {
  item: CenterRecord;
  kind: PreviewKind;
  onClose: () => void;
}) {
  const definition = definitions[kind];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(definition.fields.map(([key, , initial]) => [key, initial])),
  );
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const showPreview = () => {
    if (definition.fields.some(([key]) => !values[key]?.trim())) {
      setError('빈 항목에 예시 내용을 입력해 주세요.');
      return;
    }
    setError('');
    setPreview(true);
  };
  return (
    <Sheet title={preview ? definition.action : definition.title} isOpen onClose={onClose}>
      <DemoNotice>
        설계된 예시 양식입니다. 실제 신청·예약되지 않습니다. 실제 개인정보 대신 예시를 입력해
        주세요.
      </DemoNotice>
      <p>
        <strong>{item.title}</strong>
      </p>
      {preview ? (
        <div className="center-preview-result" aria-live="polite">
          <h3>입력 내용을 확인해 보세요</h3>
          <dl className="center-facts">
            {definition.fields.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{values[key]}</dd>
              </div>
            ))}
          </dl>
          <p>전송·접수·저장되지 않은 미리보기입니다.</p>
          <Button className="center-button" onPress={() => setPreview(false)}>
            예시 내용 수정
          </Button>
        </div>
      ) : (
        <form
          className="center-form"
          onSubmit={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
          }}
        >
          {definition.fields.map(([key, label]) => (
            <TextField
              key={key}
              value={values[key] ?? ''}
              onChange={(value) => {
                setValues((previous) => ({ ...previous, [key]: value }));
                setError('');
              }}
              isRequired
            >
              <Label>{label}</Label>
              {['reason', 'plan', 'description', 'reflection'].includes(key) ? (
                <TextArea maxLength={500} rows={3} />
              ) : (
                <Input maxLength={100} />
              )}
            </TextField>
          ))}
          {kind === 'report' && <p>사진·증빙 첨부 및 보고서 전송은 제공하지 않습니다.</p>}
          {error && (
            <p className="center-field-error" role="alert">
              {error}
            </p>
          )}
          <Button className="center-button center-primary" type="button" onPress={showPreview}>
            {definition.action}
          </Button>
        </form>
      )}
      <Button className="center-button center-wide" onPress={onClose}>
        미리보기 닫기
      </Button>
    </Sheet>
  );
}
export type SpaceDraft = {
  date: string;
  start: string;
  end: string;
  people: string;
  purpose: string;
};
export function validateSpaceDraft(draft: SpaceDraft) {
  if (!draft.date || !draft.start || !draft.end || !draft.people || !draft.purpose.trim())
    return '날짜·시간·인원·이용 목적에 예시 내용을 입력해 주세요.';
  if (draft.end <= draft.start) return '종료 시간은 시작 시간보다 늦게 골라 주세요.';
  return '';
}
export function SpacePreview({
  item,
  draft,
  onClose,
}: {
  item: CenterRecord;
  draft: SpaceDraft;
  onClose: () => void;
}) {
  return (
    <Sheet title="예약 미리보기" isOpen onClose={onClose}>
      <DemoNotice>
        실제 신청·예약되지 않습니다. 공간의 가용 여부를 조회한 결과가 아닙니다.
      </DemoNotice>
      <h3>{item.title}</h3>
      <dl className="center-facts">
        <div>
          <dt>날짜 (예시)</dt>
          <dd>{formatCenterDate(draft.date)}</dd>
        </div>
        <div>
          <dt>시간</dt>
          <dd>
            {draft.start}–{draft.end}
          </dd>
        </div>
        <div>
          <dt>인원</dt>
          <dd>{draft.people}명</dd>
        </div>
        <div>
          <dt>이용 목적</dt>
          <dd>{draft.purpose}</dd>
        </div>
        <div>
          <dt>이용료 안내</dt>
          <dd>무료 (공개 안내 참고)</dd>
        </div>
      </dl>
      <p>예약·승인·출입 권한은 생성되지 않습니다.</p>
      <Button className="center-button center-primary center-wide" onPress={onClose}>
        미리보기 닫기
      </Button>
    </Sheet>
  );
}
