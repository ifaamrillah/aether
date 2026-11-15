import { createHash, createPublicKey, verify } from "node:crypto";
import type { ApprovalDecisionReceipt, ApprovalRecord } from "../state/types.js";

export interface TrustedApproverKey {
  key_id: string;
  issuer: string;
  subject: string;
  algorithm: "Ed25519";
  public_key_pem: string;
  roles: string[];
  status: "active" | "revoked";
}

export interface TrustedApproverStore {
  schema_version: 1;
  keys: TrustedApproverKey[];
}

export interface ApprovalAuthorizer {
  authorize(
    value: unknown,
    approval: ApprovalRecord,
    requiredRoles?: readonly string[],
  ): VerifiedApprovalIdentity;
}

export interface VerifiedApprovalIdentity {
  issuer: string;
  subject: string;
  key_id: string;
  roles: string[];
  decision: "approved" | "rejected";
  issued_at: string;
  expires_at: string;
  receipt_digest: string;
}

export interface ApprovalAuthorizationOptions {
  clock?: () => Date;
  max_clock_skew_ms?: number;
  max_receipt_lifetime_ms?: number;
}

export class ApprovalAuthorizationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApprovalAuthorizationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApprovalAuthorizationError("Trusted approver " + field + " must be a non-empty string.");
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ApprovalAuthorizationError("Signed data contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (!isPlainObject(value)) throw new ApprovalAuthorizationError("Signed data must contain only plain JSON values.");
  const entries = Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalize(value[key]));
  return "{" + entries.join(",") + "}";
}

export function canonicalizeApprovalDecision(
  receipt: Omit<ApprovalDecisionReceipt, "signature">,
): string {
  return canonicalize(receipt);
}

function assertReceiptShape(value: unknown): asserts value is ApprovalDecisionReceipt {
  if (!isPlainObject(value)) throw new ApprovalAuthorizationError("Approval decision receipt must be a JSON object.");
  const allowed = new Set([
    "schema_version", "approval_id", "action_digest", "decision", "issuer",
    "subject", "key_id", "issued_at", "expires_at", "reason", "signature",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ApprovalAuthorizationError("Approval decision receipt contains an unknown field: " + key);
  }
  if (value.schema_version !== 1) throw new ApprovalAuthorizationError("Unsupported approval decision schema version.");
  for (const field of ["approval_id", "action_digest", "issuer", "subject", "key_id", "issued_at", "expires_at", "signature"]) {
    assertNonEmptyString(value[field], field);
  }
  if (!/^[a-f0-9]{64}$/.test(value.action_digest as string)) throw new ApprovalAuthorizationError("Approval action digest must be a SHA-256 hex digest.");
  if (value.decision !== "approved" && value.decision !== "rejected") throw new ApprovalAuthorizationError("Approval decision must be approved or rejected.");
  if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.trim().length === 0)) throw new ApprovalAuthorizationError("Approval decision reason must be a non-empty string when supplied.");
  if (value.decision === "rejected" && typeof value.reason !== "string") throw new ApprovalAuthorizationError("A rejection receipt must include a non-empty reason.");
  if (!/^[A-Za-z0-9_-]+$/.test(value.signature as string)) throw new ApprovalAuthorizationError("Approval signature must use base64url encoding.");
}

function validateTrustedStore(value: unknown): asserts value is TrustedApproverStore {
  if (!isPlainObject(value) || value.schema_version !== 1 || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new ApprovalAuthorizationError("Trusted approver store must use schema version 1 and contain a keys array.");
  }
  const seen = new Set<string>();
  for (const [index, item] of value.keys.entries()) {
    if (!isPlainObject(item)) throw new ApprovalAuthorizationError("Trusted approver key at index " + index + " must be an object.");
    for (const field of ["key_id", "issuer", "subject", "public_key_pem"]) assertNonEmptyString(item[field], field);
    if (item.algorithm !== "Ed25519") throw new ApprovalAuthorizationError("Only Ed25519 trusted approver keys are supported.");
    if (item.status !== "active" && item.status !== "revoked") throw new ApprovalAuthorizationError("Trusted approver key status must be active or revoked.");
    if (!Array.isArray(item.roles) || item.roles.length === 0 || item.roles.some((role) => typeof role !== "string" || !role.trim())) {
      throw new ApprovalAuthorizationError("Trusted approver key roles must be a non-empty array of non-empty strings.");
    }
    if (new Set(item.roles).size !== item.roles.length) throw new ApprovalAuthorizationError("Trusted approver key roles must be unique.");
    if (seen.has(item.key_id as string)) throw new ApprovalAuthorizationError("Trusted approver key ids must be unique.");
    seen.add(item.key_id as string);
    try {
      const key = createPublicKey(item.public_key_pem as string);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("key is not Ed25519");
    } catch (error) {
      throw new ApprovalAuthorizationError("Trusted approver public key at index " + index + " is invalid.", { cause: error });
    }
  }
}

export class Ed25519ApprovalAuthorizer {
  private readonly keys: Map<string, TrustedApproverKey>;
  private readonly clock: () => Date;
  private readonly maxClockSkewMs: number;
  private readonly maxReceiptLifetimeMs: number;

  constructor(store: TrustedApproverStore, options: ApprovalAuthorizationOptions = {}) {
    validateTrustedStore(store);
    this.keys = new Map(store.keys.map((entry) => [entry.key_id, { ...entry, roles: [...entry.roles] }]));
    this.clock = options.clock ?? (() => new Date());
    this.maxClockSkewMs = options.max_clock_skew_ms ?? 60_000;
    this.maxReceiptLifetimeMs = options.max_receipt_lifetime_ms ?? 15 * 60_000;
    if (!Number.isSafeInteger(this.maxClockSkewMs) || this.maxClockSkewMs < 0 ||
        !Number.isSafeInteger(this.maxReceiptLifetimeMs) || this.maxReceiptLifetimeMs < 1) {
      throw new ApprovalAuthorizationError("Approval authorization time limits are invalid.");
    }
  }

  authorize(
    value: unknown,
    approval: ApprovalRecord,
    requiredRoles: readonly string[] = ["approver"],
  ): VerifiedApprovalIdentity {
    assertReceiptShape(value);
    const receipt = value;
    if (receipt.approval_id !== approval.id || receipt.action_digest !== approval.action_digest) {
      throw new ApprovalAuthorizationError("Approval receipt does not match the pending approval id and action digest.");
    }
    if (requiredRoles.length === 0 || requiredRoles.some((role) => !role.trim())) {
      throw new ApprovalAuthorizationError("At least one valid role must be required for an approval decision.");
    }
    const key = this.keys.get(receipt.key_id);
    if (!key || key.status !== "active") {
      throw new ApprovalAuthorizationError("Approval signing key is unknown or revoked.");
    }
    if (key.issuer !== receipt.issuer || key.subject !== receipt.subject) {
      throw new ApprovalAuthorizationError("Approval receipt issuer or subject does not match the trusted key identity.");
    }
    const grantedRoles = key.roles.filter((role) => requiredRoles.includes(role));
    if (grantedRoles.length === 0) {
      throw new ApprovalAuthorizationError("Trusted approver does not hold a role required by this workflow stage.");
    }

    const issuedAt = Date.parse(receipt.issued_at);
    const expiresAt = Date.parse(receipt.expires_at);
    const requestedAt = Date.parse(approval.requested_at);
    const now = this.clock().getTime();
    if (![issuedAt, expiresAt, requestedAt, now].every(Number.isFinite)) {
      throw new ApprovalAuthorizationError("Approval request or receipt timestamps are invalid.");
    }
    if (issuedAt < requestedAt - this.maxClockSkewMs || issuedAt > now + this.maxClockSkewMs) {
      throw new ApprovalAuthorizationError("Approval receipt was issued outside the allowed request and clock window.");
    }
    if (expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > this.maxReceiptLifetimeMs) {
      throw new ApprovalAuthorizationError("Approval receipt has expired or exceeds the maximum receipt lifetime.");
    }
    const unsigned = {
      schema_version: receipt.schema_version,
      approval_id: receipt.approval_id,
      action_digest: receipt.action_digest,
      decision: receipt.decision,
      issuer: receipt.issuer,
      subject: receipt.subject,
      key_id: receipt.key_id,
      issued_at: receipt.issued_at,
      expires_at: receipt.expires_at,
      ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
    };
    const signature = Buffer.from(receipt.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== receipt.signature) {
      throw new ApprovalAuthorizationError("Approval signature is malformed.");
    }
    let validSignature = false;
    try {
      validSignature = verify(null, Buffer.from(canonicalizeApprovalDecision(unsigned), "utf8"), createPublicKey(key.public_key_pem), signature);
    } catch (error) {
      throw new ApprovalAuthorizationError("Approval signature could not be verified.", { cause: error });
    }
    if (!validSignature) {
      throw new ApprovalAuthorizationError("Approval signature is invalid.");
    }
    const receiptDigest = createHash("sha256")
      .update(canonicalize({ ...unsigned, signature: receipt.signature }), "utf8")
      .digest("hex");
    return {
      issuer: receipt.issuer,
      subject: receipt.subject,
      key_id: receipt.key_id,
      roles: grantedRoles,
      decision: receipt.decision,
      issued_at: receipt.issued_at,
      expires_at: receipt.expires_at,
      receipt_digest: receiptDigest,
    };
  }
}
