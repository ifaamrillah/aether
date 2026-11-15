import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { StateIntegrityError } from "./state/errors.js";
import type { ApprovalRecord, ApprovalDecisionSignature } from "./state/types.js";

export interface TrustedApproverIdentity {
  id: string;
  public_key_pem: string;
  roles: string[];
  active: boolean;
}

export interface ApprovalTrustStore {
  schema_version: 1;
  identities: TrustedApproverIdentity[];
}

export interface ApprovalSigner {
  key_id: string;
  private_key_pem: string;
}

export interface ApprovalDecisionPolicy {
  require_signature?: boolean;
  allowed_approvers?: string[];
  required_roles?: string[];
  prevent_self_approval?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new StateIntegrityError("Invalid approval trust store: " + message);
}

function validateEd25519PublicKey(pem: string) {
  let key;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    throw new StateIntegrityError("Trusted approver public key is not valid PEM.", { cause: error });
  }
  if (key.asymmetricKeyType !== "ed25519") invalid("approver keys must use Ed25519.");
  return key;
}

export async function loadApprovalTrustStore(projectRoot: string): Promise<ApprovalTrustStore> {
  const root = await realpath(projectRoot);
  const segments = [".aether", "trust", "approvers.json"];
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      throw new StateIntegrityError(
        "Trusted approver registry is missing or unreadable at .aether/trust/approvers.json.",
        { cause: error },
      );
    }
    if (details.isSymbolicLink()) invalid("registry path must not traverse symbolic links.");
    if (index < segments.length - 1 && !details.isDirectory()) invalid("registry parent path is not a directory.");
    if (index === segments.length - 1 && !details.isFile()) invalid("registry must be a regular file.");
  }
  const actual = await realpath(current);
  const rel = relative(root, actual);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) invalid("registry resolves outside the project root.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(actual, "utf8")) as unknown;
  } catch (error) {
    throw new StateIntegrityError("Trusted approver registry contains invalid JSON.", { cause: error });
  }
  if (!isPlainObject(parsed) || parsed.schema_version !== 1 || !Array.isArray(parsed.identities)) {
    invalid("expected schema_version 1 and an identities array.");
  }
  const seen = new Set<string>();
  const identities: TrustedApproverIdentity[] = [];
  for (const raw of parsed.identities) {
    if (!isPlainObject(raw) || typeof raw.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw.id) ||
        typeof raw.public_key_pem !== "string" || !raw.public_key_pem.includes("BEGIN PUBLIC KEY") ||
        !Array.isArray(raw.roles) || raw.roles.length === 0 ||
        !raw.roles.every((role) => typeof role === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(role)) ||
        typeof raw.active !== "boolean") {
      invalid("each identity requires a valid id, Ed25519 public_key_pem, non-empty roles, and active flag.");
    }
    if (seen.has(raw.id)) invalid('duplicate identity "' + raw.id + '".');
    seen.add(raw.id);
    if (new Set(raw.roles).size !== raw.roles.length) invalid('identity "' + raw.id + '" has duplicate roles.');
    validateEd25519PublicKey(raw.public_key_pem);
    identities.push({
      id: raw.id,
      public_key_pem: raw.public_key_pem,
      roles: [...raw.roles] as string[],
      active: raw.active,
    });
  }
  return { schema_version: 1, identities };
}

export function approvalDecisionSigningPayload(record: ApprovalRecord): Buffer {
  if (!record.decided_at || !record.decided_by || !record.decision_signature) {
    throw new StateIntegrityError("An approval decision must be populated before it can be signed.");
  }
  const payload = {
    schema_version: 1,
    approval_id: record.id,
    action_digest: record.action_digest,
    policy_version: record.policy_version,
    status: record.status,
    decided_by: record.decided_by,
    decided_at: record.decided_at,
    decision_reason: record.decision_reason ?? null,
    key_id: record.decision_signature.key_id,
    roles: [...record.decision_signature.roles].sort(),
    algorithm: "ed25519",
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export function signApprovalDecision(
  record: ApprovalRecord,
  signer: ApprovalSigner,
  trustStore: ApprovalTrustStore,
  policy: ApprovalDecisionPolicy = {},
): ApprovalDecisionSignature {
  if (record.decided_by !== signer.key_id) throw new StateIntegrityError("The signing identity must match the decision identity.");
  const identity = trustStore.identities.find((item) => item.id === signer.key_id);
  if (!identity || !identity.active) {
    throw new StateIntegrityError("The signing identity is not an active trusted approver.");
  }
  if (policy.allowed_approvers && !policy.allowed_approvers.includes(identity.id)) {
    throw new StateIntegrityError("The signing identity is not allowed by this stage approval policy.");
  }
  if (policy.required_roles?.some((role) => !identity.roles.includes(role))) {
    throw new StateIntegrityError("The signing identity does not hold every role required by this stage approval policy.");
  }
  if (policy.prevent_self_approval !== false && record.requested_by === identity.id) {
    throw new StateIntegrityError("The requester cannot approve their own stage action.");
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(signer.private_key_pem);
  } catch (error) {
    throw new StateIntegrityError("The approver private key is not valid PEM.", { cause: error });
  }
  if (privateKey.asymmetricKeyType !== "ed25519") invalid("the approver private key must use Ed25519.");
  const derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const trustedPublic = validateEd25519PublicKey(identity.public_key_pem).export({ type: "spki", format: "der" });
  if (!Buffer.from(derivedPublic).equals(Buffer.from(trustedPublic))) {
    throw new StateIntegrityError('The private key does not match the trusted public key for "' + identity.id + '".');
  }
  const signature: ApprovalDecisionSignature = {
    algorithm: "ed25519",
    key_id: identity.id,
    roles: [...identity.roles].sort(),
    signature: "",
  };
  record.decision_signature = signature;
  signature.signature = sign(null, approvalDecisionSigningPayload(record), privateKey).toString("base64");
  return signature;
}

export function verifyApprovalDecisionSignature(
  record: ApprovalRecord,
  trustStore: ApprovalTrustStore,
  required = false,
  policy: ApprovalDecisionPolicy = {},
): void {
  const signature = record.decision_signature;
  if (!signature) {
    if (required) throw new StateIntegrityError("This stage requires a signed approval decision.");
    return;
  }
  if (signature.algorithm !== "ed25519" || typeof signature.key_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(signature.key_id) ||
      typeof signature.signature !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature.signature) ||
      !Array.isArray(signature.roles) || signature.roles.length === 0 ||
      !signature.roles.every((role) => typeof role === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(role)) ||
      new Set(signature.roles).size !== signature.roles.length ||
      signature.key_id !== record.decided_by || !["approved", "rejected"].includes(record.status)) {
    throw new StateIntegrityError("Approval decision signature metadata is malformed or does not match the decision identity.");
  }
  const identity = trustStore.identities.find((item) => item.id === signature.key_id);
  if (!identity) {
    throw new StateIntegrityError("The signer public key is not present in the trusted approver registry.");
  }
  if (JSON.stringify([...identity.roles].sort()) !== JSON.stringify([...signature.roles].sort())) {
    throw new StateIntegrityError("Signed role snapshot does not match the immutable trusted identity roles.");
  }
  if (policy.allowed_approvers && !policy.allowed_approvers.includes(identity.id)) {
    throw new StateIntegrityError("The signed identity is not allowed by this stage approval policy.");
  }
  if (policy.required_roles?.some((role) => !signature.roles.includes(role))) {
    throw new StateIntegrityError("The signed identity did not hold every role required by this stage approval policy.");
  }
  if (policy.prevent_self_approval !== false && record.requested_by === identity.id) {
    throw new StateIntegrityError("The requester cannot approve their own stage action.");
  }
  const valid = verify(
    null,
    approvalDecisionSigningPayload(record),
    validateEd25519PublicKey(identity.public_key_pem),
    Buffer.from(signature.signature, "base64"),
  );
  if (!valid) throw new StateIntegrityError("Approval decision signature verification failed.");
}

export function getApprovalTrustStoreDigest(store: ApprovalTrustStore): string {
  const normalized = [...store.identities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((identity) => ({
      id: identity.id,
      public_key_sha256: createHash("sha256").update(identity.public_key_pem).digest("hex"),
      roles: [...identity.roles].sort(),
      active: identity.active,
    }));
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}
