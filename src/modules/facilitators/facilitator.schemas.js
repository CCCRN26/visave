import { z } from "zod";

const optionalUuid = z.string().uuid().nullable().optional();
const phone = z.string().trim().min(7).max(30).regex(/^[+0-9() -]+$/).optional();

export const facilitatorListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  projectId: optionalUuid,
  stateId: optionalUuid,
  lgaId: optionalUuid,
});

export const createFacilitatorSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone,
  staffCode: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  password: z.string().min(12).max(128),
  projectId: z.string().uuid(),
  stateId: z.string().uuid(),
  lgaId: optionalUuid,
  groupIds: z.array(z.string().uuid()).max(100).default([]),
}).strict();

export const updateFacilitatorSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone,
  staffCode: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()).optional(),
  projectId: z.string().uuid().optional(),
  stateId: z.string().uuid().optional(),
  lgaId: optionalUuid,
}).strict();

export const assignGroupsSchema = z.object({ groupIds: z.array(z.string().uuid()).max(100), reassignmentReason: z.string().trim().min(5).max(1000).optional() }).strict();
export const deactivateFacilitatorSchema = z.object({ replacementFacilitatorId: optionalUuid }).strict();
export const emptyFacilitatorSchema = z.object({}).strict();
