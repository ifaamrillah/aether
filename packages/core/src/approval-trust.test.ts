import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalDecisionSigningPayload,
  loadApprovalTrustStore,
  signApprovalDecision,
  verifyApprovalDecisionSignature,
} from "./approval-trust.js";
import type { ApprovalRecord } from "./state/types.js";

let projectRoot: string;
let pair: { privateKey: string; publicKey: string };

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "aether-approval-trust-"));
  await mkdir(join(projectRoot, ".aether", "trust"), { recursive: true });
  pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(
    join(projectRoot, ".aether", "trust", "approvers.json"),
    JSON.stringify({
      schema_version: 1,
      identities: [{
        id: "release-maintainer",
        public_key_pem: pair.publicKey,
        roles: ["maintainer", "security"],
        active: true,
      }],
    }),
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function createDecision(requestedBy = "system"): ApprovalRecord {
  const action = {
    id: "stage-run_123-protected-change",
    type: "workflow.stage.execute",
    target: "protected-change",
    risk: "high" as const,
    requested_by: requestedBy,
    context: {
      run_id: "run_123",
      workflow_id: "release",
      workflow_version: 1,
      stage_id: "protected-change",
      scope: { read_paths: ["src/**"], write_paths: ["src/**"] },
      acceptance_criteria: ["Review changes"],
    },
  };
  return {
    schema_version: 1,
    id: "approval_123",
    action,
    status: "approved",
    requested_at: "2026-11-15T01:00:00.000Z",
    requested_by: requestedBy,
    decided_at: "2026-11-15T01:05:00.000Z",
    decided_by: "release-maintainer",
    decision_reason: "Reviewed the protected change.",
    policy_version: "aether-approval-v1",
    action_digest: createHash("sha256").update(JSON.stringify(action)).digest("hex"),
  };
}

describe("trusted approver identity and signed decisions", () => {
  it("loads a project trust registry and verifies an Ed25519 approval", async () => {
    const trustStore = await loadApprovalTrustStore(projectRoot);
    const approval = createDecision();
    const signature = signApprovalDecision(
      approval,
      { key_id: "release-maintainer", private_key_pem: pair.privateKey },
      trustStore,
      { require_signature: true, required_roles: ["maintainer", "security"] },
    );

    expect(signature.algorithm).toBe("ed25519");
    expect(signature.key_id).toBe("release-maintainer");
    expect(signature.roles).toEqual(["maintainer", "security"]);
    expect(signature.signature.length).toBeGreaterThan(40);
    expect(approvalDecisionSigningPayload(approval).toString("utf8")).toContain("approval_123");
    verifyApprovalDecisionSignature(approval, trustStore, true);
  });

  it("detects tampered decisions and refuses unsigned required approvals", async () => {
    const trustStore = await loadApprovalTrustStore(projectRoot);
    const approval = createDecision();
    signApprovalDecision(
      approval,
      { key_id: "release-maintainer", private_key_pem: pair.privateKey },
      trustStore,
      { require_signature: true },
    );

    approval.decision_reason = "Changed after signing.";
    expect(() => verifyApprovalDecisionSignature(approval, trustStore, true))
      .toThrow(/signature verification failed/i);

    const forgedRoles = { ...createDecision(), decision_signature: { ...approval.decision_signature!, roles: ["admin"] } };
    expect(() => verifyApprovalDecisionSignature(forgedRoles, trustStore, true))
      .toThrow(/signature verification failed|role snapshot/i);

    const unsigned = createDecision();
    expect(() => verifyApprovalDecisionSignature(unsigned, trustStore, true))
      .toThrow(/requires a signed approval decision/i);
  });

  it("enforces trusted identity, role, key binding, and self-approval policy", async () => {
    const trustStore = await loadApprovalTrustStore(projectRoot);
    const unknownIdentity = createDecision();
    unknownIdentity.decided_by = "unknown-reviewer";
    expect(() => signApprovalDecision(
      unknownIdentity,
      { key_id: "unknown-reviewer", private_key_pem: pair.privateKey },
      trustStore,
    )).toThrow(/not an active trusted approver/i);

    expect(() => signApprovalDecision(
      createDecision(),
      { key_id: "release-maintainer", private_key_pem: pair.privateKey },
      trustStore,
      { required_roles: ["release-admin"] },
    )).toThrow(/does not hold every role/i);

    const otherPair = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(() => signApprovalDecision(
      createDecision(),
      { key_id: "release-maintainer", private_key_pem: otherPair.privateKey },
      trustStore,
    )).toThrow(/does not match the trusted public key/i);

    expect(() => signApprovalDecision(
      createDecision("release-maintainer"),
      { key_id: "release-maintainer", private_key_pem: pair.privateKey },
      trustStore,
    )).toThrow(/cannot approve their own/i);
  });
});
