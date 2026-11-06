import { z } from 'zod';
import * as enums from './enums.js';
import * as primitives from './primitives.js';
import * as entities from './entities.js';
import * as ai from './ai.js';
import * as http from './http.js';
import * as listing from './listing.js';
import * as intake from './intake.js';
import * as reservation from './reservation.js';
import * as policy from './policy.js';

const namedSchemas = {
  ...enums,
  ...primitives,
  ...entities,
  ...ai,
  ...http,
  ...listing,
  ...intake,
  ...reservation,
  ...policy,
};
const schemas: Record<string, z.ZodType> = {};
for (const [name, schema] of Object.entries(namedSchemas)) {
  if (name.endsWith('Schema') && schema instanceof z.ZodType) schemas[name.slice(0, -6)] = schema;
}

const responses = {
  DemoSession: http.successEnvelopeSchema(http.DemoSessionDataSchema),
  Places: http.successEnvelopeSchema(http.listDataSchema(entities.PlaceSchema)),
  Items: http.successEnvelopeSchema(http.listDataSchema(entities.ItemSummarySchema)),
  Item: http.successEnvelopeSchema(entities.ItemSchema),
  RequestView: http.successEnvelopeSchema(http.RequestViewSchema),
  SearchAccepted: http.successEnvelopeSchema(http.SearchAcceptedDataSchema),
  Candidates: http.successEnvelopeSchema(http.listDataSchema(entities.CandidateSchema)),
  PricingQuote: http.successEnvelopeSchema(entities.PricingQuoteSchema),
  NegotiationDetail: http.successEnvelopeSchema(http.NegotiationDetailSchema),
  OwnerCard: http.successEnvelopeSchema(entities.OwnerCardSchema),
  Withdraw: http.successEnvelopeSchema(http.WithdrawDataSchema),
  SelectOffer: http.successEnvelopeSchema(http.SelectOfferDataSchema),
  PaymentPreview: http.successEnvelopeSchema(entities.PaymentPreviewSchema),
  Inbox: http.successEnvelopeSchema(http.listDataSchema(http.InboxItemSchema)),
  Sync: http.successEnvelopeSchema(http.SyncDataSchema),
  VoiceSession: http.successEnvelopeSchema(http.VoiceSessionDataSchema),
  VoiceState: http.successEnvelopeSchema(http.VoiceStateDataSchema),
  VoiceCompletionAudio: http.successEnvelopeSchema(http.VoiceCompletionAudioDataSchema),
  TaskAccepted: http.successEnvelopeSchema(http.TaskAcceptedDataSchema),
  AgentTaskDetail: http.successEnvelopeSchema(ai.AgentTaskDetailSchema),
  UploadedImage: http.successEnvelopeSchema(listing.UploadedImageSchema),
  Listing: http.successEnvelopeSchema(listing.ListingSchema),
  Listings: http.successEnvelopeSchema(http.listDataSchema(listing.ListingSchema)),
  IntakeApproval: http.successEnvelopeSchema(intake.IntakeApprovalSchema),
  Catalog: http.successEnvelopeSchema(http.listDataSchema(reservation.CatalogItemSchema)),
  CatalogItemDetail: http.successEnvelopeSchema(reservation.CatalogItemDetailSchema),
  ItemAvailability: http.successEnvelopeSchema(reservation.ItemAvailabilitySchema),
  ReservationView: http.successEnvelopeSchema(reservation.ReservationViewSchema),
  Reservations: http.successEnvelopeSchema(http.listDataSchema(reservation.ReservationViewSchema)),
  WaitlistEntry: http.successEnvelopeSchema(reservation.WaitlistEntrySchema),
  WaitlistEntries: http.successEnvelopeSchema(http.listDataSchema(reservation.WaitlistEntrySchema)),
  Notifications: http.successEnvelopeSchema(reservation.NotificationListSchema),
  ReadNotifications: http.successEnvelopeSchema(reservation.ReadNotificationsDataSchema),
  HandoverView: http.successEnvelopeSchema(reservation.HandoverViewSchema),
  PolicyMatch: http.successEnvelopeSchema(policy.PolicyMatchSchema),
};
for (const [name, schema] of Object.entries(responses)) schemas[`${name}Response`] = schema;

type Operation = {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  operationId: string;
  summary: string;
  status: 200 | 201 | 202 | 204;
  response?: keyof typeof responses;
  body?: string;
  query?: string;
  public?: boolean;
  sse?: boolean;
  binary?: boolean;
  /** Stateless computation: the Idempotency-Key is checked but the result is not replayed. */
  recomputed?: boolean;
};
/** The method/path pairs in COMMON_CONTRACT §6.1. */
export const API_OPERATIONS: readonly Operation[] = [
  {
    method: 'post',
    path: '/demo-sessions',
    operationId: 'createDemoSession',
    summary: '데모 아이디 진입',
    status: 201,
    response: 'DemoSession',
    body: 'DemoSessionBody',
    public: true,
  },
  {
    method: 'get',
    path: '/me',
    operationId: 'getMe',
    summary: '현재 데모 세션',
    status: 200,
    response: 'DemoSession',
  },
  {
    method: 'delete',
    path: '/demo-sessions/current',
    operationId: 'deleteDemoSession',
    summary: '세션·SSE·음성 종료',
    status: 204,
  },
  {
    method: 'get',
    path: '/places',
    operationId: 'listPlaces',
    summary: '가상 만남 장소 목록',
    status: 200,
    response: 'Places',
    public: true,
  },
  {
    method: 'get',
    path: '/items',
    operationId: 'listItems',
    summary: '공공·주민 물품 요약 목록',
    status: 200,
    response: 'Items',
    query: 'ItemsQuery',
    public: true,
  },
  {
    method: 'get',
    path: '/items/{id}',
    operationId: 'getItem',
    summary: '공개 seed 물품 상세',
    status: 200,
    response: 'Item',
    public: true,
  },
  {
    method: 'post',
    path: '/requests',
    operationId: 'createRequest',
    summary: '확인 전 요청 초안 생성',
    status: 201,
    response: 'RequestView',
    body: 'CreateRequestBody',
  },
  {
    method: 'patch',
    path: '/requests/{id}/draft',
    operationId: 'replaceDraft',
    summary: '요구 초안 전체 대체',
    status: 200,
    response: 'RequestView',
    body: 'PatchDraftBody',
  },
  {
    method: 'post',
    path: '/requests/{id}/search',
    operationId: 'searchRequest',
    summary: '사용자 확인 후 검색 접수',
    status: 202,
    response: 'SearchAccepted',
    body: 'SearchRequestBody',
  },
  {
    method: 'get',
    path: '/requests/{id}',
    operationId: 'getRequest',
    summary: '요청자 전체 projection',
    status: 200,
    response: 'RequestView',
  },
  {
    method: 'get',
    path: '/requests/{id}/candidates',
    operationId: 'listCandidates',
    summary: '요청자의 검색 결과 목록',
    status: 200,
    response: 'Candidates',
  },
  {
    method: 'post',
    path: '/requests/{id}/submit',
    operationId: 'submitCandidates',
    summary: '후보 1–3개 원자적 전송',
    status: 201,
    response: 'RequestView',
    body: 'SubmitRequestBody',
  },
  {
    method: 'post',
    path: '/requests/{id}/cancel',
    operationId: 'cancelRequest',
    summary: '선택 전 전체 취소',
    status: 200,
    response: 'RequestView',
    body: 'CancelRequestBody',
  },
  {
    method: 'post',
    path: '/price-quotes',
    operationId: 'createPriceQuote',
    summary: '서버 계산 가격 quote',
    status: 200,
    response: 'PricingQuote',
    body: 'PriceQuoteBody',
  },
  {
    method: 'get',
    path: '/negotiations/{id}',
    operationId: 'getNegotiation',
    summary: '권한에 맞는 분기 또는 OwnerCard',
    status: 200,
    response: 'NegotiationDetail',
  },
  {
    method: 'post',
    path: '/negotiations/{id}/owner-response',
    operationId: 'respondAsOwner',
    summary: '소유자의 승인·거절·조건 변경',
    status: 200,
    response: 'OwnerCard',
    body: 'OwnerResponseBody',
  },
  {
    method: 'post',
    path: '/negotiations/{id}/requester-counter',
    operationId: 'counterAsRequester',
    summary: '요청자의 전체 조건 변경',
    status: 200,
    response: 'RequestView',
    body: 'RequesterCounterBody',
  },
  {
    method: 'post',
    path: '/negotiations/{id}/withdraw',
    operationId: 'withdrawNegotiation',
    summary: '분기 철회',
    status: 200,
    response: 'Withdraw',
    body: 'WithdrawBody',
  },
  {
    method: 'post',
    path: '/requests/{id}/select',
    operationId: 'selectOffer',
    summary: '정확한 최신 Offer 하나 선택',
    status: 200,
    response: 'SelectOffer',
    body: 'SelectOfferBody',
  },
  {
    method: 'get',
    path: '/requests/{id}/payment-preview',
    operationId: 'getPaymentPreview',
    summary: '실제 청구 없는 결제 미리보기',
    status: 200,
    response: 'PaymentPreview',
  },
  {
    method: 'get',
    path: '/inbox',
    operationId: 'getInbox',
    summary: '빌리기·빌려주기 요청함',
    status: 200,
    response: 'Inbox',
    query: 'InboxQuery',
  },
  {
    method: 'get',
    path: '/sync',
    operationId: 'sync',
    summary: '동일 스냅샷의 사용자 데이터와 event cursor',
    status: 200,
    response: 'Sync',
  },
  {
    method: 'get',
    path: '/events',
    operationId: 'events',
    summary: '사용자별 SSE 무효화 신호',
    status: 200,
    query: 'EventsQuery',
    sse: true,
  },
  {
    method: 'post',
    path: '/voice-sessions',
    operationId: 'createVoiceSession',
    summary: '기존 요청에 실시간 음성 연결',
    status: 201,
    response: 'VoiceSession',
    body: 'VoiceSessionBody',
  },
  {
    method: 'delete',
    path: '/voice-sessions/{id}',
    operationId: 'deleteVoiceSession',
    summary: '현재 세션의 음성 연결 종료',
    status: 204,
  },
  {
    method: 'get',
    path: '/voice-sessions/{id}',
    operationId: 'getVoiceState',
    summary: '현재 음성 세션의 발화 완료 상태',
    status: 200,
    response: 'VoiceState',
  },
  {
    method: 'get',
    path: '/voice-sessions/{id}/completion-audio',
    operationId: 'getVoiceCompletionAudio',
    summary: '최신 수집 완료 안내의 일시적 음성 구간',
    status: 200,
    response: 'VoiceCompletionAudio',
    query: 'VoiceCompletionAudioQuery',
  },
  {
    method: 'post',
    path: '/voice-sessions/{id}/respond',
    operationId: 'respondVoice',
    summary: '발화 완료와 재생 준비 확인 후 상담 재개',
    status: 204,
    body: 'VoiceRespondBody',
  },
  {
    method: 'post',
    path: '/voice-sessions/{id}/finish',
    operationId: 'finishVoice',
    summary: '통화 종료 후 신청서 저장과 물품 조회 접수',
    status: 202,
    response: 'TaskAccepted',
    body: 'FinishVoiceBody',
  },
  {
    method: 'post',
    path: '/agent-turns',
    operationId: 'createAgentTurn',
    summary: '텍스트 대체 입력의 AI 작업 접수',
    status: 202,
    response: 'TaskAccepted',
    body: 'AgentTurnBody',
  },
  {
    method: 'get',
    path: '/tasks/{id}',
    operationId: 'getTask',
    summary: '허용된 작업과 결과 조회',
    status: 200,
    response: 'AgentTaskDetail',
  },
  // 2번 AI 물품 등록. 명세: docs/specs/0002-item-registration.md
  {
    method: 'post',
    path: '/images',
    operationId: 'uploadImage',
    summary: '물품 사진 업로드(base64, 5MB 이하)',
    status: 201,
    response: 'UploadedImage',
    body: 'ImageUploadBody',
  },
  {
    method: 'get',
    path: '/images/{id}',
    operationId: 'getImage',
    summary: '물품 사진 바이트',
    status: 200,
    binary: true,
  },
  {
    method: 'post',
    path: '/listings',
    operationId: 'createListing',
    summary: '사진으로 AI 등록 초안 생성(DRAFT)',
    status: 201,
    response: 'Listing',
    body: 'CreateListingBody',
  },
  {
    method: 'get',
    path: '/listings',
    operationId: 'listListings',
    summary: 'mine=true면 내 전체, 아니면 게시 물품만',
    status: 200,
    response: 'Listings',
    query: 'ListingsQuery',
  },
  {
    method: 'get',
    path: '/listings/{id}',
    operationId: 'getListing',
    summary: '게시 물품 또는 내 물품 상세',
    status: 200,
    response: 'Listing',
  },
  {
    method: 'patch',
    path: '/listings/{id}',
    operationId: 'patchListing',
    summary: '등록글 수정(게시 중이면 게시 조건 재검사)',
    status: 200,
    response: 'Listing',
    body: 'PatchListingBody',
  },
  {
    method: 'post',
    path: '/listings/{id}/publish',
    operationId: 'publishListing',
    summary: '사람 확인 후 게시',
    status: 200,
    response: 'Listing',
    body: 'ListingVersionBody',
  },
  {
    method: 'post',
    path: '/listings/{id}/deactivate',
    operationId: 'deactivateListing',
    summary: '게시 물품 비활성화',
    status: 200,
    response: 'Listing',
    body: 'ListingVersionBody',
  },
  {
    method: 'post',
    path: '/intake-approvals',
    operationId: 'createIntakeApproval',
    summary: '사람이 승인한 통화 신청서로 예약 신청 도구 실행(백그라운드 재시도)',
    status: 202,
    response: 'IntakeApproval',
    body: 'CreateIntakeApprovalBody',
  },
  {
    method: 'get',
    path: '/intake-approvals/{id}',
    operationId: 'getIntakeApproval',
    summary: '예약 신청 도구 실행 상태',
    status: 200,
    response: 'IntakeApproval',
  },
  {
    method: 'post',
    path: '/policy-matches',
    operationId: 'matchPolicies',
    summary: '통화 발화의 대여 상황으로 신청완료 화면에 안내할 센터 정책 선택(저장 없음)',
    status: 200,
    response: 'PolicyMatch',
    body: 'PolicyMatchBody',
    recomputed: true,
  },
  {
    method: 'get',
    path: '/catalog',
    operationId: 'listCatalog',
    summary: '활성 물품 목록·검색·분류/출처 필터, 기간을 주면 가용성·총액 포함',
    status: 200,
    response: 'Catalog',
    query: 'CatalogQuery',
  },
  {
    method: 'get',
    path: '/catalog/{id}',
    operationId: 'getCatalogItem',
    summary: '물품 상세: 설명·점유 기간·대기 수',
    status: 200,
    response: 'CatalogItemDetail',
  },
  {
    method: 'get',
    path: '/catalog/{id}/availability',
    operationId: 'getItemAvailability',
    summary: '기간별 가용 여부·사유·총액·대기 가능 여부',
    status: 200,
    response: 'ItemAvailability',
    query: 'ItemAvailabilityQuery',
  },
  {
    method: 'post',
    path: '/reservations',
    operationId: 'createReservation',
    summary: '바로 신청(PENDING) 또는 결제 미리보기 확정(requestId·negotiationId, CONFIRMED)',
    status: 201,
    response: 'ReservationView',
    body: 'CreateReservationBody',
  },
  {
    method: 'get',
    path: '/reservations',
    operationId: 'listReservations',
    summary: '내 신청(REQUESTER) 또는 내 물품에 온 신청(OWNER)',
    status: 200,
    response: 'Reservations',
    query: 'ReservationsQuery',
  },
  {
    method: 'get',
    path: '/reservations/{id}',
    operationId: 'getReservation',
    summary: '예약 상세와 응답 이력',
    status: 200,
    response: 'ReservationView',
  },
  {
    method: 'post',
    path: '/reservations/{id}/respond',
    operationId: 'respondReservation',
    summary: '주민 소유자 승인(기간 점유)·거절',
    status: 200,
    response: 'ReservationView',
    body: 'RespondReservationBody',
  },
  {
    method: 'post',
    path: '/reservations/{id}/cancel',
    operationId: 'cancelReservation',
    summary: '요청자 취소(PENDING 또는 시작 전 CONFIRMED)',
    status: 200,
    response: 'ReservationView',
    body: 'ReservationVersionBody',
  },
  {
    method: 'post',
    path: '/waitlist-entries',
    operationId: 'createWaitlistEntry',
    summary: '점유된 기간 대기 등록(중복 대기 차단)',
    status: 201,
    response: 'WaitlistEntry',
    body: 'CreateWaitlistEntryBody',
  },
  {
    method: 'get',
    path: '/waitlist-entries',
    operationId: 'listWaitlistEntries',
    summary: '내 대기 목록과 순번·우선권',
    status: 200,
    response: 'WaitlistEntries',
    query: 'WaitlistQuery',
  },
  {
    method: 'delete',
    path: '/waitlist-entries/{id}',
    operationId: 'cancelWaitlistEntry',
    summary: '대기 취소(우선권이면 다음 순위로)',
    status: 200,
    response: 'WaitlistEntry',
  },
  {
    method: 'get',
    path: '/notifications',
    operationId: 'listNotifications',
    summary: '앱 내 알림(최신순)과 읽지 않은 수',
    status: 200,
    response: 'Notifications',
    query: 'NotificationsQuery',
  },
  {
    method: 'post',
    path: '/notifications/read',
    operationId: 'readNotifications',
    summary: '알림 읽음 처리(선택 또는 전체)',
    status: 200,
    response: 'ReadNotifications',
    body: 'ReadNotificationsBody',
  },
  {
    method: 'get',
    path: '/handovers/{code}',
    operationId: 'getHandover',
    summary: '거점 관리자: 인계 코드로 예약·인계 단계 조회(명세 0007)',
    status: 200,
    response: 'HandoverView',
  },
  {
    method: 'post',
    path: '/handovers/{code}/pickup',
    operationId: 'recordPickup',
    summary: '거점 관리자: 대여 전 사진과 함께 인계 기록',
    status: 200,
    response: 'HandoverView',
    body: 'HandoverPhotoBody',
  },
  {
    method: 'post',
    path: '/handovers/{code}/return',
    operationId: 'recordReturn',
    summary: '거점 관리자: 반납 사진 기록과 AI 비교 후보(판정 아님)',
    status: 200,
    response: 'HandoverView',
    body: 'HandoverPhotoBody',
  },
  {
    method: 'post',
    path: '/handovers/{code}/inspect',
    operationId: 'recordInspection',
    summary: '거점 관리자: 반납 최종 판정(문제 없음·파손)',
    status: 200,
    response: 'HandoverView',
    body: 'InspectBody',
  },
];
export function buildOpenApi() {
  const componentSchemas = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      const { $schema: _dialect, ...definition } = z.toJSONSchema(schema, {
        target: 'draft-2020-12',
        io: 'input',
      });
      return [name, definition];
    }),
  );
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of API_OPERATIONS) {
    const mutation = operation.method !== 'get';
    const parameters: Record<string, unknown>[] = [];
    if (operation.path.includes('{id}'))
      parameters.push({ name: 'id', in: 'path', required: true, schema: ref('Id') });
    if (operation.path.includes('{code}'))
      parameters.push({ name: 'code', in: 'path', required: true, schema: ref('HandoverCode') });
    if (mutation && !operation.public)
      parameters.push(
        {
          name: 'X-CSRF-Token',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 512 },
        },
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 128 },
          description: operation.recomputed
            ? '전역 요청 검사용 필수 헤더. 이 경로는 결과를 저장하지 않아 같은 키로도 다시 계산합니다.'
            : '24시간 동안 같은 세션·실제 경로·body에 최초 결과를 재현합니다.',
        },
      );
    if (operation.query) {
      const query = componentSchemas[operation.query];
      if (!query) throw new Error(`Unknown query schema ${operation.query}`);
      for (const [name, schema] of Object.entries(query.properties ?? {}))
        parameters.push({
          name,
          in: 'query',
          required: query.required?.includes(name) ?? false,
          schema,
        });
    }
    if (operation.sse)
      parameters.push({
        name: 'Last-Event-ID',
        in: 'header',
        required: false,
        schema: ref('EventCursor'),
        description: 'after query보다 우선합니다.',
      });
    const errorResponses = Object.fromEntries(
      [...new Set(Object.values(enums.ERROR_HTTP_STATUS))].map((status) => [
        String(status),
        {
          description: Object.entries(enums.ERROR_HTTP_STATUS)
            .filter(([, value]) => value === status)
            .map(([code]) => code)
            .join(' / '),
          content: { 'application/json': { schema: ref('ErrorEnvelope') } },
        },
      ]),
    );
    const success =
      operation.status === 204
        ? { description: '종료됨. 응답 body 없음' }
        : operation.binary
          ? {
              description: '이미지 바이트',
              content: { 'image/*': { schema: { type: 'string', format: 'binary' } } },
            }
          : operation.sse
            ? {
                description:
                  'SseEvent JSON, heartbeat는 Heartbeat JSON이며 id가 없습니다. 업무 데이터는 REST로 다시 조회합니다.',
                content: { 'text/event-stream': { schema: { type: 'string' } } },
                'x-event-schemas': { persistent: ref('SseEvent'), heartbeat: ref('Heartbeat') },
              }
            : {
                description: '성공',
                content: { 'application/json': { schema: ref(`${operation.response}Response`) } },
              };
    paths[operation.path] ??= {};
    paths[operation.path]![operation.method] = {
      operationId: operation.operationId,
      summary: operation.summary,
      security: operation.public ? [] : [{ demoSession: [] }],
      parameters,
      ...(operation.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: ref(operation.body) } },
            },
          }
        : {}),
      responses: { [operation.status]: success, ...errorResponses },
    };
  }
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: '성북 공유대여 MVP',
      version: enums.CONTRACT_VERSION,
      description:
        '데모 세션은 인증이 아닙니다. 실제 결제와 기관 예약은 이루어지지 않으며, 예약은 앱 안의 데모 상태입니다.',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      securitySchemes: {
        demoSession: { type: 'apiKey', in: 'cookie', name: 'demo_session' },
      },
      schemas: componentSchemas,
    },
  };
}
