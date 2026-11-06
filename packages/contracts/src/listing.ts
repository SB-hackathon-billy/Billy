// 2번 AI 물품 등록 계약. 명세: docs/specs/0002-item-registration.md
import { z } from 'zod';
import { CategorySchema } from './enums.js';
import { IdSchema, KrwSchema, UtcDateTimeSchema, VersionSchema, textSchema } from './primitives.js';
import { PaginationQuerySchema } from './http.js';

export const LISTING_STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'INACTIVE'] as const;
export const ListingStatusSchema = z.enum(LISTING_STATUS_VALUES);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_LISTING_IMAGES = 5;
/**
 * 빌려주기 등록에서 고를 수 있는 주고받을 장소: 캠퍼스 거점만(기획서 v2 3장 ②).
 * ponytail: 거점 목록을 상수로 둔다. 거점이 데이터로 늘어나면 Place에 종류 필드를 둔다.
 * 이 거점이 하나도 없는 DB(기본 테스트 fixture)는 기존 장소를 그대로 쓴다.
 */
export const CAMPUS_HUB_PLACE_IDS: readonly string[] = [
  'place-korea',
  'place-kookmin',
  'place-dongduk',
  'place-seokyeong',
  'place-sungshin',
  'place-hansung',
];

export const ImageUploadBodySchema = z
  .object({
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    dataBase64: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4),
  })
  .strict();
export const UploadedImageSchema = z.object({ id: IdSchema, url: z.string() }).strict();
export type UploadedImage = z.infer<typeof UploadedImageSchema>;

/** AI가 사진에서 만든 초안. 사람이 확인하기 전까지 게시되지 않는다. */
export const AiListingDraftSchema = z
  .object({
    title: z.string().trim().max(120),
    category: CategorySchema,
    description: z.string().trim().max(2_000),
    unknowns: z.array(z.string().trim().max(200)).max(10),
  })
  .strict();
export type AiListingDraft = z.infer<typeof AiListingDraftSchema>;

export const ListingSchema = z
  .object({
    id: IdSchema,
    ownerId: IdSchema,
    status: ListingStatusSchema,
    version: VersionSchema,
    imageIds: z.array(IdSchema).min(1).max(MAX_LISTING_IMAGES),
    aiStatus: z.enum(['DONE', 'FAILED']),
    title: z.string().max(120),
    category: CategorySchema.nullable(),
    description: z.string().max(2_000),
    unknowns: z.array(z.string().max(200)).max(10),
    dailyRateKrw: KrwSchema.nullable(),
    placeId: IdSchema.nullable(),
    availableFrom: UtcDateTimeSchema.nullable(),
    availableTo: UtcDateTimeSchema.nullable(),
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type Listing = z.infer<typeof ListingSchema>;

export const CreateListingBodySchema = z
  .object({
    imageIds: z.array(IdSchema).min(1).max(MAX_LISTING_IMAGES),
    userNotes: z.string().trim().max(500).optional(),
  })
  .strict();
export const PatchListingBodySchema = z
  .object({
    expectedVersion: VersionSchema,
    title: textSchema(120).optional(),
    category: CategorySchema.optional(),
    description: z.string().trim().max(2_000).optional(),
    dailyRateKrw: KrwSchema.max(1_000_000).optional(),
    placeId: IdSchema.optional(),
    availableFrom: UtcDateTimeSchema.nullable().optional(),
    availableTo: UtcDateTimeSchema.nullable().optional(),
  })
  .strict();
export type PatchListingBody = z.infer<typeof PatchListingBodySchema>;
export const ListingVersionBodySchema = z.object({ expectedVersion: VersionSchema }).strict();
export const ListingsQuerySchema = PaginationQuerySchema.extend({
  mine: z.enum(['true', 'false']).optional(),
  category: CategorySchema.optional(),
});
