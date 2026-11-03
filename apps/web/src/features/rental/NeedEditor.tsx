import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ConfirmedNeedSchema,
  ExtractNeedResultSchema,
  RequestViewSchema,
  SearchAcceptedDataSchema,
  validatePeriod,
  type NeedDraft,
  type RequestView,
} from '@sb/contracts';
import { api, idPath, serverClock, formatSeoulDateTime } from '../../lib/api.js';
import { useAction, useOnline, usePlaces } from '../../lib/hooks.js';
import { categories } from '../../lib/presentation.js';
import { ActionButton, Check, ErrorNotice } from '../../components/ui.js';
import { PeriodFields } from '../../components/PeriodFields.js';

export function NeedEditor({ view }: { view: RequestView }) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQueryClient();
  const proposed = ExtractNeedResultSchema.safeParse(location.state?.proposal);
  const currentProposal =
    proposed.success &&
    (!location.state?.inputVersion?.needRevision ||
      location.state.inputVersion.needRevision === view.request.needRevision);
  const [need, setNeed] = useState<NeedDraft>(
    currentProposal && proposed.success ? proposed.data.proposedNeed : view.request.need,
  );
  const [baseVersion, setBaseVersion] = useState(view.request.version);
  const [errors, setErrors] = useState<string[]>([]);
  const composing = useRef(false);
  const action = useAction();
  const online = useOnline();
  const places = usePlaces();
  const locked = action.pending || action.canRetry;
  const change = (patch: Partial<NeedDraft>) => {
    setNeed((n) => ({ ...n, ...patch }));
    setErrors([]);
  };
  const submit = () => {
    if (composing.current) return;
    const parsed = ConfirmedNeedSchema.safeParse(need);
    const missing = [
      !need.category && '물품 분류를 선택해 주세요.',
      !need.queryText.trim() && '필요한 물품을 적어 주세요.',
      !need.startAt && '시작 날짜를 정해 주세요.',
      !need.endAt && '종료 날짜를 정해 주세요.',
      !need.preferredPlaceIds.length && '만남 장소를 1~3곳 선택해 주세요.',
    ].filter((v): v is string => !!v);
    if (!parsed.success) {
      setErrors(
        missing.length
          ? missing
          : ['기간과 예산을 확인해 주세요. 예산은 양의 정수로 입력해 주세요.'],
      );
      return;
    }
    const period = validatePeriod(parsed.data.startAt, parsed.data.endAt, serverClock.now());
    if (!period.valid) {
      setErrors(period.issues);
      return;
    }
    action.run(async (scope) => {
      const saved = await api.execute(
        scope.command(`/requests/${idPath(view.request.id)}/draft`, 'PATCH', {
          expectedRequestVersion: baseVersion,
          need: parsed.data,
        }),
        RequestViewSchema,
      );
      setBaseVersion(saved.request.version);
      query.setQueryData(['request', saved.request.id], saved);
      const accepted = await api.execute(
        scope.command(`/requests/${idPath(saved.request.id)}/search`, 'POST', {
          expectedRequestVersion: saved.request.version,
        }),
        SearchAcceptedDataSchema,
      );
      query.setQueryData(['request', saved.request.id], accepted.request);
      void query.invalidateQueries({ queryKey: ['sync'] });
      navigate(`/requests/${saved.request.id}`);
    });
  };
  return (
    <section>
      <p className="eyebrow">01 요청 확인</p>
      <h1>이렇게 찾아볼까요?</h1>
      <p>
        필요한 조건을 확인해 주세요.
        <br />
        아직 이웃에게 요청을 보내지 않았어요.
      </p>
      {currentProposal && proposed.success && proposed.data.clarificationQuestion && (
        <p className="demo-notice">{proposed.data.clarificationQuestion}</p>
      )}
      {proposed.success && !currentProposal && (
        <p className="demo-notice">
          초안이 바뀌어 이전 음성 요약을 적용하지 않았어요. 현재 조건을 확인해 주세요.
        </p>
      )}
      {baseVersion !== view.request.version && !action.pending && (
        <div className="demo-notice" role="alert">
          <p>다른 화면에서 초안이 바뀌었어요. 최신 초안을 확인한 뒤 이어가 주세요.</p>
          <ActionButton
            secondary
            onPress={() => {
              setNeed(view.request.need);
              setBaseVersion(view.request.version);
              action.clearError();
            }}
          >
            최신 초안 불러오기
          </ActionButton>
        </div>
      )}
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current))
            e.preventDefault();
        }}
      >
        <label>
          필요한 물품
          <input
            disabled={locked}
            value={need.queryText}
            onChange={(e) => change({ queryText: e.target.value })}
            maxLength={200}
            placeholder="예: 프로젝터"
            required
          />
        </label>
        <label>
          물품 분류
          <select
            disabled={locked}
            value={need.category ?? ''}
            onChange={(e) => change({ category: e.target.value as NeedDraft['category'] })}
            required
          >
            <option value="" disabled>
              분류를 골라 주세요
            </option>
            {Object.entries(categories).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <PeriodFields
          disabled={locked}
          startAt={need.startAt}
          endAt={need.endAt}
          onChange={(startAt, endAt) => change({ startAt, endAt })}
        />
        {need.startAt && need.endAt && (
          <div className="date-summary">
            <strong>확인한 날짜</strong>
            <p>
              {formatSeoulDateTime(need.startAt)}부터
              <br />
              {formatSeoulDateTime(need.endAt)}까지
            </p>
          </div>
        )}
        <fieldset>
          <legend>
            만남 장소 <span className="muted">1~3곳</span>
          </legend>
          <ErrorNotice error={places.error} />
          {places.data?.items.map((place) => (
            <Check
              isDisabled={locked}
              key={place.id}
              isSelected={need.preferredPlaceIds.includes(place.id)}
              onChange={(selected) =>
                change({
                  preferredPlaceIds: selected
                    ? [...need.preferredPlaceIds, place.id]
                    : need.preferredPlaceIds.filter((id) => id !== place.id),
                })
              }
            >
              {place.label} <span className="muted">· 가상 장소</span>
            </Check>
          ))}
        </fieldset>
        <label>
          최대 예산 <span className="muted">선택</span>
          <div className="input-suffix">
            <input
              disabled={locked}
              aria-label="최대 예산"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={need.maxBudgetKrw ?? ''}
              onChange={(e) =>
                change({ maxBudgetKrw: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="예산 제한 없음"
            />
            <span>원</span>
          </div>
        </label>
        {errors.length > 0 && (
          <div className="error-notice" role="alert">
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        <ErrorNotice action={action} />
        <ActionButton type="submit" isDisabled={action.pending || action.canRetry || !online}>
          {action.pending ? '조건을 확인하는 중…' : '이 조건으로 찾아보기'}
        </ActionButton>
      </form>
    </section>
  );
}
