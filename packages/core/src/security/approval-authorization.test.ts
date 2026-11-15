import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApprovalAuthorizationError,
  Ed25519ApprovalAuthorizer,
  canonicalizeApprovalDecision,
} from "./approval-authorization.js";
import type { ApprovalRecord } from "../state/types.js";

const now = "2026-11-15T01:01:00.000Z";
const requestedAt = "2026-11-15T01:00:00.000Z";
const keyPair = generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

function createApproval(requestedBy = "author"): ApprovalRecord {
  return {
    schema_version: 1,
    id: "approval_123",
    action: {
      id: "stage-run_123-protected-change",
      type: "workflow.stage.execute",
      target: "protected-change",
      risk: "high",
      requested_by: requestedBy,
      context: { run_id: "run_123", stage_id: "protected-change" },
    },
    status: "pending",
    requested_at: requestedAt,
    requested_by: requestedBy,
    policy_version: "aether-approval-v1",
    action_digest: "a".repeat(64),
  };
}

function createReceipt(
  approval: ApprovalRecord,
  overrides: Partial<{ decision: "approved" | "rejected"; issuer: string; subject: string; key_id: string; issued_at: string; expires_at: string; reason: string }> = {},
) {
  const unsigned = {
    schema_version: 1 as const,
    approval_id: approval.id,
    action_digest: approval.action_digest,
    decision: overrides.decision ?? "approved" as const,
    issuer: overrides.issuer ?? "https://identity.example.test",
    subject: overrides.subject ?? "reviewer@example.test",
    key_id: overrides.key_id ?? "maintainer-key",
    issued_at: overrides.issued_at ?? "2026-11-15T01:00:30.000Z",
    expires_at: overrides.expires_at ?? "2026-11-15T01:05:30.000Z",
    ...(overrides.reason === undefined ? {} : { reason: overrides.reason }),
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalizeApprovalDecision(unsigned)), keyPair.privateKey).toString("base64url"),
  };
}

function authorizer(roles = ["approver"], status: "active" | "revoked" = "active") {
  return new Ed25519ApprovalAuthorizer(
    {
      schema_version: 1,
      keys: [{
        key_id: "maintainer-key",
        issuer: "https://identity.example.test",
        subject: "reviewer@example.test",
        algorithm: "Ed25519",
        public_key_pem: publicKeyPem,
        roles,
        status,
      }],
    },
    { clock: () => new Date(now) },
  );
}

describe("Ed25519 approval authorization", () => {
  it("verifies the signature and resolves roles from the trusted key registry", () => {
    const approval = createApproval();
    const result = authorizer(["approver", "release-manager"]).authorize(
      createReceipt(approval), approval, ["release-manager"],
    );
    expect(result.subject).toBe("reviewer@example.test");
    expect(result.roles).toEqual(["release-manager"]);
    expect(result.decision).toBe("approved");
    expect(result.receipt_digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects receipt tampering and approval action substitution", () => {
    const approval = createApproval();
    const receipt = createReceipt(approval);
    expect(() => authorizer().authorize({ ...receipt, subject: "attacker@example.test" }, approval))
      .toThrow(ApprovalAuthorizationError);
    expect(() => authorizer().authorize(createReceipt({ ...approval, action_digest: "b".repeat(64) }), approval))
      .toThrow(ApprovalAuthorizationError);
  });

  it("rejects revoked keys and identities without the configured role", () => {
    const approval = createApproval();
    expect(() => authorizer(["approver"], "revoked").authorize(createReceipt(approval), approval))
      .toThrow(/unknown or revoked/);
    expect(() => authorizer(["viewer"]).authorize(createReceipt(approval), approval))
      .toThrow(/required by this workflow/);
  });

  it("rejects expired, stale, and excessively long-lived receipts", () => {
    const approval = createApproval();
    expect(() => authorizer().authorize(createReceipt(approval, { expires_at: "2026-11-15T01:00:59.000Z" }), approval))
      .toThrow(/expired/);
    expect(() => authorizer().authorize(createReceipt(approval, { issued_at: "2026-11-15T00:58:59.000Z" }), approval))
      .toThrow(/request and clock window/);
    expect(() => authorizer().authorize(createReceipt(approval, { expires_at: "2026-11-15T02:00:30.000Z" }), approval))
      .toThrow(/maximum receipt lifetime/);
  });

  it("requires a reason for rejection and rejects unknown receipt fields", () => {
    const approval = createApproval();
    const rejected = createReceipt(approval, { decision: "rejected", reason: "Change the scope." });
    expect(authorizer().authorize(rejected, approval).decision).toBe("rejected");
    const invalid = { ...createReceipt(approval), role: "admin" };
    expect(() => authorizer().authorize(invalid, approval)).toThrow(/unknown field/);
  });

  it("fails closed on malformed trusted key registries", () => {
    expect(() => new Ed25519ApprovalAuthorizer({
      schema_version: 1,
      keys: [{
        key_id: "broken", issuer: "https://identity.example.test", subject: "someone",
        algorithm: "Ed25519", public_key_pem: "not a key", roles: ["approver"], status: "active",
      }],
    })).toThrow(ApprovalAuthorizationError);
  });
});
