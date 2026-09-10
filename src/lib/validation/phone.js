import { z } from "zod";

export const PHONE_VALIDATION_MESSAGE = "Phone number must be exactly 11 digits.";
export const PHONE_PATTERN = /^\d{11}$/;

export const sanitizePhoneInput = (value) => value.replace(/\D/g, "").slice(0, 11);

export const phoneInputProps = {
  type: "tel",
  inputMode: "numeric",
  maxLength: 11,
  pattern: "\\d{11}",
  title: PHONE_VALIDATION_MESSAGE,
};

export const requiredPhoneSchema = z.string().trim().regex(PHONE_PATTERN, PHONE_VALIDATION_MESSAGE);

export const optionalPhoneSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  requiredPhoneSchema.optional(),
);

export const nullablePhoneSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  requiredPhoneSchema.nullable().optional(),
);
