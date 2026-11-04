// 2번 AI 물품 등록 화면. 명세: docs/specs/0002-item-registration.md
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORY_VALUES,
  IMAGE_CONTENT_TYPES,
  ListingSchema,
  MAX_LISTING_IMAGES,
  UploadedImageSchema,
  listDataSchema,
  type Category,
  type Listing,
  type PatchListingBody,
} from '@sb/contracts';
import { api, formatKrw, idPath, type ActionScope } from '../../lib/api.js';
import { useAction, usePlaces } from '../../lib/hooks.js';
import { categories } from '../../lib/presentation.js';
import { ActionButton, ErrorNotice, Loading } from '../../components/ui.js';
import { PeriodFields } from '../../components/PeriodFields.js';

const statusText: Record<Listing['status'], string> = {
  DRAFT: '작성 중',
  PUBLISHED: '게시됨',
  INACTIVE: '비활성',
};

/** 휴대폰 원본 사진을 긴 변 1280px JPEG로 줄인다. */
async function shrink(file: File): Promise<{ contentType: string; dataBase64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { contentType: 'image/jpeg', dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export function ListingsPage() {
  const query = useQuery({
    queryKey: ['listings', 'mine'],
    queryFn: ({ signal }) =>
      api.get('/listings?mine=true&limit=50', listDataSchema(ListingSchema), signal),
  });
  return (
    <section>
      <p className="eyebrow">빌려주기</p>
      <h1>내 물품</h1>
      <p>사진 한 장이면 AI가 등록글 초안을 써 드려요. 확인하고 고친 뒤 게시하세요.</p>
      <Link className="button" to="/listings/new">
        사진으로 등록하기
      </Link>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : !query.data.items.length ? (
        <p className="field-hint">아직 등록한 물품이 없어요.</p>
      ) : (
        <ul className="listing-list">
          {query.data.items.map((l) => (
            <li key={l.id} className="content-card">
              <Link to={`/listings/${l.id}`} className="listing-row">
                <img src={`/api/v1/images/${l.imageIds[0]}`} alt="" />
                <span>
                  <strong>{l.title || '제목 없음'}</strong>
                  <span className="field-hint">
                    {statusText[l.status]}
                    {l.dailyRateKrw ? ` · 하루 ${formatKrw(l.dailyRateKrw)}` : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NewListingPage() {
  const navigate = useNavigate();
  const action = useAction();
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const previews = files.map((f) => URL.createObjectURL(f));
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)));
  const create = (scope: ActionScope) =>
    (async () => {
      const imageIds: string[] = [];
      for (const file of files) {
        const body = await shrink(file);
        const image = await api.execute(
          scope.command('/images', 'POST', body),
          UploadedImageSchema,
        );
        imageIds.push(image.id);
      }
      const listing = await api.execute(
        scope.command('/listings', 'POST', {
          imageIds,
          ...(notes.trim() ? { userNotes: notes.trim() } : {}),
        }),
        ListingSchema,
      );
      navigate(`/listings/${listing.id}`, { replace: true });
    })();
  return (
    <section>
      <p className="eyebrow">빌려주기</p>
      <h1>사진으로 등록</h1>
      <label>
        물건 사진 (최대 {MAX_LISTING_IMAGES}장)
        <input
          type="file"
          accept={IMAGE_CONTENT_TYPES.join(',')}
          multiple
          onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, MAX_LISTING_IMAGES))}
          disabled={action.pending}
        />
      </label>
      {!!previews.length && (
        <div className="listing-photos">
          {previews.map((src) => (
            <img key={src} src={src} alt="선택한 사진" />
          ))}
        </div>
      )}
      <label>
        메모 (선택)
        <textarea
          value={notes}
          maxLength={500}
          placeholder="예: 충전기 포함, 1년 사용"
          onChange={(e) => setNotes(e.target.value)}
          disabled={action.pending}
        />
      </label>
      <ErrorNotice action={action} />
      {action.pending && <Loading>사진을 올리고 AI가 초안을 쓰고 있어요.</Loading>}
      <ActionButton isDisabled={!files.length || action.pending} onPress={() => action.run(create)}>
        AI 초안 만들기
      </ActionButton>
    </section>
  );
}

type Form = Pick<
  Listing,
  | 'title'
  | 'category'
  | 'description'
  | 'dailyRateKrw'
  | 'placeId'
  | 'availableFrom'
  | 'availableTo'
>;
const formOf = (l: Listing): Form => ({
  title: l.title,
  category: l.category,
  description: l.description,
  dailyRateKrw: l.dailyRateKrw,
  placeId: l.placeId,
  availableFrom: l.availableFrom,
  availableTo: l.availableTo,
});

export function ListingEditPage() {
  const { listingId = '' } = useParams();
  const client = useQueryClient();
  const places = usePlaces();
  const action = useAction();
  const query = useQuery({
    queryKey: ['listing', listingId],
    queryFn: ({ signal }) => api.get(`/listings/${idPath(listingId)}`, ListingSchema, signal),
  });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (query.data) setForm(formOf(query.data));
  }, [query.data]);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const l = query.data;
  if (!form) return <Loading />;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  const patchBody = (): PatchListingBody => ({
    expectedVersion: l.version,
    ...(form.title.trim() ? { title: form.title.trim() } : {}),
    ...(form.category ? { category: form.category } : {}),
    description: form.description.trim(),
    ...(form.dailyRateKrw ? { dailyRateKrw: form.dailyRateKrw } : {}),
    ...(form.placeId ? { placeId: form.placeId } : {}),
    availableFrom: form.availableFrom,
    availableTo: form.availableTo,
  });
  const done = (next: Listing) => {
    client.setQueryData(['listing', listingId], next);
    void client.invalidateQueries({ queryKey: ['listings'] });
  };
  const id = idPath(l.id);
  const save = (scope: ActionScope) =>
    api.execute(scope.command(`/listings/${id}`, 'PATCH', patchBody()), ListingSchema).then(done);
  const publish = (scope: ActionScope) =>
    (async () => {
      const saved = await api.execute(
        scope.command(`/listings/${id}`, 'PATCH', patchBody()),
        ListingSchema,
      );
      done(
        await api.execute(
          scope.command(`/listings/${id}/publish`, 'POST', { expectedVersion: saved.version }),
          ListingSchema,
        ),
      );
    })();
  const deactivate = (scope: ActionScope) =>
    api
      .execute(
        scope.command(`/listings/${id}/deactivate`, 'POST', { expectedVersion: l.version }),
        ListingSchema,
      )
      .then(done);

  return (
    <section>
      <p className="eyebrow">빌려주기 · {statusText[l.status]}</p>
      <h1>등록글 확인</h1>
      <div className="listing-photos">
        {l.imageIds.map((imageId) => (
          <img key={imageId} src={`/api/v1/images/${imageId}`} alt="등록한 사진" />
        ))}
      </div>
      {l.aiStatus === 'FAILED' ? (
        <p role="status" className="content-card">
          AI가 사진을 분석하지 못했어요. 내용을 직접 입력해 주세요.
        </p>
      ) : (
        <p className="field-hint">✦ AI가 사진을 보고 쓴 초안이에요. 사실과 다르면 고쳐 주세요.</p>
      )}
      {!!l.unknowns.length && (
        <div className="content-card">
          <h2>사진만으로는 알 수 없어요</h2>
          <ul>
            {l.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <p className="field-hint">직접 확인한 내용을 설명에 적어 주세요.</p>
        </div>
      )}
      <label>
        제목
        <input
          value={form.title}
          maxLength={120}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <label>
        분류
        <select
          value={form.category ?? ''}
          onChange={(e) => set({ category: (e.target.value || null) as Category | null })}
        >
          <option value="">선택</option>
          {CATEGORY_VALUES.map((c) => (
            <option key={c} value={c}>
              {categories[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        설명
        <textarea
          value={form.description}
          maxLength={2000}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <label>
        하루 대여료 (원)
        <input
          type="number"
          inputMode="numeric"
          min={100}
          max={1_000_000}
          step={100}
          value={form.dailyRateKrw ?? ''}
          onChange={(e) =>
            set({ dailyRateKrw: e.target.value ? Math.round(Number(e.target.value)) : null })
          }
        />
      </label>
      <label>
        주고받을 장소
        <select
          value={form.placeId ?? ''}
          onChange={(e) => set({ placeId: e.target.value || null })}
        >
          <option value="">선택</option>
          {places.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">대여 가능 기간 (비워 두면 언제나 가능)</p>
      <PeriodFields
        startAt={form.availableFrom}
        endAt={form.availableTo}
        onChange={(availableFrom, availableTo) => set({ availableFrom, availableTo })}
      />
      <ErrorNotice action={action} />
      <ActionButton secondary isDisabled={action.pending} onPress={() => action.run(save)}>
        저장
      </ActionButton>
      {l.status !== 'PUBLISHED' ? (
        <ActionButton isDisabled={action.pending} onPress={() => action.run(publish)}>
          {l.status === 'INACTIVE' ? '다시 게시하기' : '확인하고 게시하기'}
        </ActionButton>
      ) : (
        <ActionButton secondary isDisabled={action.pending} onPress={() => action.run(deactivate)}>
          비활성화
        </ActionButton>
      )}
    </section>
  );
}
